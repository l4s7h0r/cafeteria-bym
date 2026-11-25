import type { Database } from "bun:sqlite";
import type { Ctx, ServerModule } from "../../core/types.ts";
import { HttpError } from "../../core/router.ts";

// Isla "reportes": resumen diario, semanal y mensual.
// Depende de "contabilidad": lee sus tablas (contabilidad_ingresos, contabilidad_egresos, contabilidad_propinas,
// contabilidad_propinas_reparto) SOLO en lectura. No importa código de esa isla.

const MEDIOS: Record<string, string> = { efectivo: "Efectivo", debito: "Débito", credito: "Crédito", transferencia: "Transferencia" };
const CATEGORIAS: Record<string, string> = {
  insumos: "Insumos", sueldos: "Sueldos", arriendo: "Arriendo", servicios: "Servicios básicos", mantencion: "Mantención", otros: "Otros",
};
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// ---------- fechas (locales, YYYY-MM-DD) ----------
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
const hoy = () => ymd(new Date());
const esFecha = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parse(s)) === s;
const etiquetaDia = (s: string) => { const d = parse(s); return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`; };
const corto = (s: string) => { const d = parse(s); return `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`; };
const lunesDe = (s: string) => { const d = parse(s); return addDays(s, -((d.getDay() + 6) % 7)); };
const bad = (m: string) => new HttpError(400, m);

interface Periodo { desde: string; hasta: string; etiqueta: string }
interface Totales { ingresos: number; egresos: number; propinas: number; resultado: number; ventas_sin_boleta: number; dias_con_venta: number; promedio_diario: number }

function requiereContabilidad(db: Database) {
  const n = (db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('contabilidad_ingresos','contabilidad_egresos','contabilidad_propinas')").get() as { n: number }).n;
  if (n < 3) throw new HttpError(409, "Reportes necesita la isla de contabilidad instalada");
}

function totales(db: Database, t: number, desde: string, hasta: string): Totales {
  const ing = db.query(
    "SELECT COALESCE(SUM(monto),0) total, COALESCE(SUM(CASE WHEN con_boleta=0 THEN monto END),0) sin, COUNT(DISTINCT fecha) dias FROM contabilidad_ingresos WHERE tenant_id=? AND fecha BETWEEN ? AND ?",
  ).get(t, desde, hasta) as { total: number; sin: number; dias: number };
  const egr = (db.query("SELECT COALESCE(SUM(monto),0) total FROM contabilidad_egresos WHERE tenant_id=? AND fecha BETWEEN ? AND ?").get(t, desde, hasta) as { total: number }).total;
  const pro = (db.query("SELECT COALESCE(SUM(total),0) total FROM contabilidad_propinas WHERE tenant_id=? AND fecha BETWEEN ? AND ?").get(t, desde, hasta) as { total: number }).total;
  return {
    ingresos: ing.total, egresos: egr, propinas: pro, resultado: ing.total - egr,
    ventas_sin_boleta: ing.sin, dias_con_venta: ing.dias, promedio_diario: ing.dias ? Math.round(ing.total / ing.dias) : 0,
  };
}

const variacion = (act: number, ant: number) => (ant === 0 ? null : Math.round(((act - ant) / Math.abs(ant)) * 1000) / 10);

function serie(db: Database, t: number, desde: string, hasta: string) {
  const q = (sql: string) => new Map((db.query(sql).all(t, desde, hasta) as { fecha: string; m: number }[]).map((r) => [r.fecha, r.m]));
  const ing = q("SELECT fecha, SUM(monto) m FROM contabilidad_ingresos WHERE tenant_id=? AND fecha BETWEEN ? AND ? GROUP BY fecha");
  const egr = q("SELECT fecha, SUM(monto) m FROM contabilidad_egresos WHERE tenant_id=? AND fecha BETWEEN ? AND ? GROUP BY fecha");
  const pro = q("SELECT fecha, SUM(total) m FROM contabilidad_propinas WHERE tenant_id=? AND fecha BETWEEN ? AND ? GROUP BY fecha");
  const out = [];
  for (let f = desde; f <= hasta; f = addDays(f, 1)) {
    const d = parse(f);
    out.push({ fecha: f, dia: DIAS[d.getDay()].slice(0, 3), etiqueta: corto(f), ingresos: ing.get(f) ?? 0, egresos: egr.get(f) ?? 0, propinas: pro.get(f) ?? 0 });
  }
  return out;
}

function reporte(ctx: Ctx, tipo: "diario" | "semanal" | "mensual", p: Periodo, ant: Periodo, extra: { nota?: string; topDesde?: string } = {}) {
  requiereContabilidad(ctx.db);
  const db = ctx.db, t = ctx.tenant.id;
  const act = totales(db, t, p.desde, p.hasta);
  const prev = totales(db, t, ant.desde, ant.hasta);

  const pct = (m: number, tot: number) => (tot ? Math.round((m / tot) * 1000) / 10 : 0);
  const medios = db.query("SELECT medio, SUM(monto) m, SUM(CASE WHEN con_boleta=0 THEN monto ELSE 0 END) sin FROM contabilidad_ingresos WHERE tenant_id=? AND fecha BETWEEN ? AND ? GROUP BY medio").all(t, p.desde, p.hasta) as { medio: string; m: number; sin: number }[];
  const mediosAnt = db.query("SELECT medio, SUM(monto) m FROM contabilidad_ingresos WHERE tenant_id=? AND fecha BETWEEN ? AND ? GROUP BY medio").all(t, ant.desde, ant.hasta) as { medio: string; m: number }[];
  const cats = db.query("SELECT categoria, SUM(monto) m, COUNT(*) n FROM contabilidad_egresos WHERE tenant_id=? AND fecha BETWEEN ? AND ? GROUP BY categoria").all(t, p.desde, p.hasta) as { categoria: string; m: number; n: number }[];
  const catsAnt = db.query("SELECT categoria, SUM(monto) m FROM contabilidad_egresos WHERE tenant_id=? AND fecha BETWEEN ? AND ? GROUP BY categoria").all(t, ant.desde, ant.hasta) as { categoria: string; m: number }[];

  const por_medio = Object.entries(MEDIOS).map(([medio, label]) => {
    const r = medios.find((x) => x.medio === medio);
    const monto = r?.m ?? 0;
    return { medio, label, monto, sin_boleta: r?.sin ?? 0, pct: pct(monto, act.ingresos), variacion: variacion(monto, mediosAnt.find((x) => x.medio === medio)?.m ?? 0) };
  });
  const por_categoria = Object.entries(CATEGORIAS).map(([categoria, label]) => {
    const r = cats.find((x) => x.categoria === categoria);
    const monto = r?.m ?? 0;
    return { categoria, label, monto, movimientos: r?.n ?? 0, pct: pct(monto, act.egresos), variacion: variacion(monto, catsAnt.find((x) => x.categoria === categoria)?.m ?? 0) };
  }).sort((a, b) => b.monto - a.monto);

  const top_proveedores = db.query(
    "SELECT proveedor, SUM(monto) monto, COUNT(*) compras FROM contabilidad_egresos WHERE tenant_id=? AND fecha BETWEEN ? AND ? AND proveedor IS NOT NULL GROUP BY proveedor ORDER BY monto DESC LIMIT 5",
  ).all(t, p.desde, p.hasta);

  // Top días por venta (en el diario se mira el último mes para dar contexto)
  const topDesde = extra.topDesde ?? p.desde;
  const top_dias = (db.query(
    "SELECT fecha, SUM(monto) ingresos FROM contabilidad_ingresos WHERE tenant_id=? AND fecha BETWEEN ? AND ? GROUP BY fecha ORDER BY ingresos DESC LIMIT 5",
  ).all(t, topDesde, p.hasta) as { fecha: string; ingresos: number }[]).map((r) => ({ ...r, etiqueta: etiquetaDia(r.fecha) }));

  const propinas_por_garzon = db.query(
    `SELECT r.garzon, SUM(r.monto) monto, COUNT(*) dias FROM contabilidad_propinas_reparto r JOIN contabilidad_propinas p ON p.id = r.propina_id
     WHERE r.tenant_id=? AND p.fecha BETWEEN ? AND ? GROUP BY r.garzon ORDER BY monto DESC`,
  ).all(t, p.desde, p.hasta);

  // Serie: en el diario, los 7 días que terminan en la fecha; si no, el periodo completo
  const s = serie(db, t, tipo === "diario" ? addDays(p.desde, -6) : p.desde, p.hasta);

  // Promedio de venta por día de la semana (solo días con venta)
  const porDow = new Map<number, { suma: number; n: number }>();
  for (const d of tipo === "diario" ? [] : s) {
    if (!d.ingresos) continue;
    const k = parse(d.fecha).getDay();
    const x = porDow.get(k) ?? { suma: 0, n: 0 };
    x.suma += d.ingresos; x.n++;
    porDow.set(k, x);
  }
  const por_dia_semana = [1, 2, 3, 4, 5, 6, 0].map((k) => ({ dia: DIAS[k], promedio: porDow.has(k) ? Math.round(porDow.get(k)!.suma / porDow.get(k)!.n) : 0 }));

  return {
    tipo, periodo: p, anterior: ant, nota_comparacion: extra.nota ?? null,
    // true si el periodo anterior tiene muchos menos días con datos (p. ej. antes de empezar a usar el sistema)
    anterior_incompleto: prev.dias_con_venta < Math.max(1, act.dias_con_venta) * 0.6,
    totales: act, totales_anterior: prev,
    variacion: {
      ingresos: variacion(act.ingresos, prev.ingresos), egresos: variacion(act.egresos, prev.egresos),
      propinas: variacion(act.propinas, prev.propinas), resultado: variacion(act.resultado, prev.resultado),
      promedio_diario: variacion(act.promedio_diario, prev.promedio_diario),
    },
    margen: act.ingresos ? Math.round((act.resultado / act.ingresos) * 1000) / 10 : null,
    por_medio, por_categoria, top_proveedores, top_dias, propinas_por_garzon, serie: s,
    por_dia_semana: tipo === "diario" ? [] : por_dia_semana,
  };
}

const mod: ServerModule = {
  id: "reportes",
  migrate(_db) {}, // no tiene tablas propias
  routes: [
    {
      // /diario?fecha=YYYY-MM-DD — compara con el mismo día de la semana anterior
      method: "GET", path: "/diario",
      handler: (ctx) => {
        const fecha = ctx.url.searchParams.get("fecha") || hoy();
        if (!esFecha(fecha)) throw bad("Fecha inválida (usa YYYY-MM-DD)");
        const antF = addDays(fecha, -7);
        return reporte(ctx, "diario",
          { desde: fecha, hasta: fecha, etiqueta: etiquetaDia(fecha) },
          { desde: antF, hasta: antF, etiqueta: etiquetaDia(antF) },
          { nota: `Comparado con el ${etiquetaDia(antF)} (mismo día de la semana anterior)`, topDesde: addDays(fecha, -29) });
      },
    },
    {
      // /semanal?desde=YYYY-MM-DD — 7 días desde esa fecha (por defecto, el lunes de esta semana)
      method: "GET", path: "/semanal",
      handler: (ctx) => {
        const q = ctx.url.searchParams.get("desde");
        const desde = q || lunesDe(hoy());
        if (!esFecha(desde)) throw bad("Fecha inválida (usa YYYY-MM-DD)");
        const hasta = addDays(desde, 6);
        const corte = hasta > hoy() && desde <= hoy() ? hoy() : hasta; // semana en curso: comparar los mismos días
        const n = diffDays(desde, corte);
        const antD = addDays(desde, -7);
        const ant = { desde: antD, hasta: addDays(antD, n), etiqueta: `Semana del ${corto(antD)}` };
        return reporte(ctx, "semanal",
          { desde, hasta: corte, etiqueta: `Semana del ${corto(desde)} al ${corto(hasta)}` }, ant,
          { nota: corte < hasta ? `Semana en curso: comparada con los mismos ${n + 1} días de la semana anterior` : "Comparada con la semana anterior" });
      },
    },
    {
      // /mensual?mes=YYYY-MM — mes calendario; el mes en curso se compara con los mismos días del mes anterior
      method: "GET", path: "/mensual",
      handler: (ctx) => {
        const mes = ctx.url.searchParams.get("mes") || hoy().slice(0, 7);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw bad("Mes inválido (usa YYYY-MM)");
        const [y, m] = mes.split("-").map(Number);
        const desde = `${mes}-01`;
        const hasta = ymd(new Date(y, m, 0));
        const corte = hasta > hoy() && desde <= hoy() ? hoy() : hasta;
        const antDesde = ymd(new Date(y, m - 2, 1));
        const antFin = ymd(new Date(y, m - 1, 0));
        const dia = parse(corte).getDate();
        const antHasta = corte < hasta ? (addDays(antDesde, dia - 1) < antFin ? addDays(antDesde, dia - 1) : antFin) : antFin;
        const nombre = (yy: number, mm: number) => `${MESES[mm]} ${yy}`;
        const antMes = new Date(y, m - 2, 1);
        return reporte(ctx, "mensual",
          { desde, hasta: corte, etiqueta: nombre(y, m - 1) },
          { desde: antDesde, hasta: antHasta, etiqueta: nombre(antMes.getFullYear(), antMes.getMonth()) },
          { nota: corte < hasta ? `Mes en curso: comparado con el 1 al ${parse(antHasta).getDate()} de ${MESES[antMes.getMonth()]}` : `Comparado con ${nombre(antMes.getFullYear(), antMes.getMonth())}` });
      },
    },
  ],
};
export default mod;
