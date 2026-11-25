import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ClientModule, ModuleProps } from "../../core/types";
import { clp } from "../../core/api";
import "./reportes.css";

// Isla "reportes": lee /api/m/reportes/{diario,semanal,mensual}. Requiere la isla contabilidad (datos).

type Tipo = "diario" | "semanal" | "mensual";
const C_ING = "#2E8B5E"; // ingresos (validado contra blanco junto a C_EGR: CVD ΔE 9,4)
const C_EGR = "#E08A2E"; // gastos

interface Totales { ingresos: number; egresos: number; propinas: number; resultado: number; ventas_sin_boleta: number; dias_con_venta: number; promedio_diario: number }
interface Reporte {
  tipo: Tipo;
  periodo: { desde: string; hasta: string; etiqueta: string };
  anterior: { desde: string; hasta: string; etiqueta: string };
  nota_comparacion: string | null;
  anterior_incompleto: boolean;
  totales: Totales; totales_anterior: Totales;
  variacion: Record<"ingresos" | "egresos" | "propinas" | "resultado" | "promedio_diario", number | null>;
  margen: number | null;
  por_medio: { medio: string; label: string; monto: number; sin_boleta: number; pct: number; variacion: number | null }[];
  por_categoria: { categoria: string; label: string; monto: number; movimientos: number; pct: number; variacion: number | null }[];
  top_proveedores: { proveedor: string; monto: number; compras: number }[];
  top_dias: { fecha: string; ingresos: number; etiqueta: string }[];
  propinas_por_garzon: { garzon: string; monto: number; dias: number }[];
  serie: { fecha: string; dia: string; etiqueta: string; ingresos: number; egresos: number; propinas: number }[];
  por_dia_semana: { dia: string; promedio: number }[];
}

// ---------- fechas ----------
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const lunes = (s: string) => addDays(s, -((parse(s).getDay() + 6) % 7));
const addMes = (m: string, n: number) => { const [y, mm] = m.split("-").map(Number); const d = new Date(y, mm - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const hoy = () => ymd(new Date());

// ---------- formato ----------
const pctTxt = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`;
function compacto(n: number) {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toLocaleString("es-CL", { maximumFractionDigits: 1 })} M`;
  if (a >= 1_000) return `$${Math.round(n / 1_000).toLocaleString("es-CL")} mil`;
  return clp(n);
}

// Variación: el color dice si es bueno o malo (en gastos, subir es malo); la flecha, el sentido.
function Var({ v, subirEsBueno = true, prefijo }: { v: number | null; subirEsBueno?: boolean; prefijo?: string }) {
  if (v === null) return <span className="rp-var flat">sin dato anterior</span>;
  if (Math.abs(v) < 0.5) return <span className="rp-var flat">= sin cambio</span>;
  const bueno = v > 0 === subirEsBueno;
  return <span className={`rp-var ${bueno ? "up" : "down"}`} title={prefijo}>{v > 0 ? "▲" : "▼"} {pctTxt(v)}</span>;
}

// =====================================================================
function Pantalla({ tenant, api }: ModuleProps) {
  const [tipo, setTipo] = useState<Tipo>("semanal");
  const [fecha, setFecha] = useState(hoy());
  const [semana, setSemana] = useState(lunes(hoy()));
  const [mes, setMes] = useState(hoy().slice(0, 7));
  const [r, setR] = useState<Reporte | null>(null);
  const [err, setErr] = useState("");
  const [cargando, setCargando] = useState(false);

  const query = tipo === "diario" ? `/diario?fecha=${fecha}` : tipo === "semanal" ? `/semanal?desde=${semana}` : `/mensual?mes=${mes}`;
  useEffect(() => {
    let vivo = true;
    setCargando(true); setErr("");
    api.get<Reporte>(query)
      .then((x) => { if (vivo) setR(x); })
      .catch((e) => { if (vivo) { setErr(e.message); setR(null); } })
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.slug, query]);

  const h = hoy();
  const puedeAvanzar = tipo === "diario" ? fecha < h : tipo === "semanal" ? addDays(semana, 7) <= h : addMes(mes, 1) <= h.slice(0, 7);
  function mover(n: number) {
    if (tipo === "diario") setFecha((f) => addDays(f, n));
    else if (tipo === "semanal") setSemana((s) => addDays(s, 7 * n));
    else setMes((m) => addMes(m, n));
  }

  return (
    <div className="stack">
      <div className="between">
        <h2 className="display" style={{ fontSize: 22 }}>Reportes</h2>
        <span className="muted">{tenant.nombre}</span>
      </div>
      <div className="rp-seg" role="tablist">
        {(["diario", "semanal", "mensual"] as Tipo[]).map((t) => (
          <button key={t} aria-pressed={tipo === t} onClick={() => setTipo(t)}>{t === "diario" ? "Día" : t === "semanal" ? "Semana" : "Mes"}</button>
        ))}
      </div>
      <div className="rp-nav">
        <button onClick={() => mover(-1)} aria-label="Periodo anterior">‹</button>
        <div className="t">
          <b>{r && r.tipo === tipo ? r.periodo.etiqueta[0].toUpperCase() + r.periodo.etiqueta.slice(1) : "…"}</b>
          <span className="muted">{r?.nota_comparacion ?? ""}</span>
        </div>
        <button onClick={() => mover(1)} disabled={!puedeAvanzar} aria-label="Periodo siguiente">›</button>
      </div>

      {err && <div className="card" style={{ color: "var(--rojo)" }}>{err}</div>}
      {!r && !err && <div className="card muted">Cargando…</div>}
      {r && (
        <div className="stack" style={{ opacity: cargando ? 0.55 : 1, transition: "opacity .15s" }}>
          {r.anterior_incompleto && <div className="chip warn" style={{ whiteSpace: "normal" }}>Ojo: el periodo anterior tiene pocos días con datos; las variaciones pueden exagerar.</div>}
          <Kpis r={r} />
          <Grafico r={r} />
          <div className="rp-cols">
            <Medios r={r} />
            <Categorias r={r} />
            {r.tipo !== "diario" && <DiaSemana r={r} />}
            <TopDias r={r} />
            <Proveedores r={r} />
            <Propinas r={r} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- KPIs ----------
function Kpis({ r }: { r: Reporte }) {
  const t = r.totales, a = r.totales_anterior, v = r.variacion;
  return (
    <div className="rp-tiles">
      <div className="rp-tile dark">
        <span className="lbl">Ingresos menos gastos{r.margen !== null && ` · margen ${r.margen.toLocaleString("es-CL")}%`}</span>
        <span className="val" style={t.resultado < 0 ? { color: "#FF9B8A" } : undefined}>{clp(t.resultado)}</span>
        <Var v={v.resultado} />
        <span className="ant">Antes: {clp(a.resultado)}</span>
      </div>
      <div className="rp-tile">
        <span className="lbl"><i className="rp-dot" style={{ background: C_ING }} />Ingresos</span>
        <span className="val">{clp(t.ingresos)}</span>
        <Var v={v.ingresos} />
        <span className="ant">Antes: {clp(a.ingresos)}</span>
      </div>
      <div className="rp-tile">
        <span className="lbl"><i className="rp-dot" style={{ background: C_EGR }} />Gastos</span>
        <span className="val">{clp(t.egresos)}</span>
        <Var v={v.egresos} subirEsBueno={false} />
        <span className="ant">Antes: {clp(a.egresos)}</span>
      </div>
      <div className="rp-tile">
        <span className="lbl">🤝 Propinas</span>
        <span className="val">{clp(t.propinas)}</span>
        <Var v={v.propinas} />
        <span className="ant">Para el equipo, no suman a ventas</span>
      </div>
      <div className="rp-tile">
        <span className="lbl">{r.tipo === "diario" ? "Sin boleta" : "Venta promedio por día"}</span>
        <span className="val">{r.tipo === "diario" ? clp(t.ventas_sin_boleta) : clp(t.promedio_diario)}</span>
        {r.tipo === "diario" ? <span className="ant">{t.ingresos ? Math.round((t.ventas_sin_boleta / t.ingresos) * 100) : 0}% de lo vendido</span> : <Var v={v.promedio_diario} />}
        <span className="ant">{r.tipo === "diario" ? "Ventas sin documento" : `${t.dias_con_venta} días con venta`}</span>
      </div>
    </div>
  );
}

// ---------- Gráfico de barras (ingresos vs gastos) ----------
interface Bucket { label: string; sub: string; ingresos: number; egresos: number; destacado?: boolean }
function buckets(r: Reporte): Bucket[] {
  if (r.tipo !== "mensual") return r.serie.map((d) => ({ label: d.dia, sub: d.etiqueta, ingresos: d.ingresos, egresos: d.egresos, destacado: r.tipo === "diario" && d.fecha === r.periodo.desde }));
  // Mes: semana a semana (lunes a domingo)
  const out: Bucket[] = [];
  let actual: Bucket | null = null, ini = "";
  for (const d of r.serie) {
    if (!actual || parse(d.fecha).getDay() === 1) {
      actual = { label: "", sub: "", ingresos: 0, egresos: 0 };
      ini = d.fecha;
      out.push(actual);
    }
    actual.ingresos += d.ingresos; actual.egresos += d.egresos;
    const a = parse(ini).getDate(), b = parse(d.fecha).getDate();
    actual.label = a === b ? `${a}` : `${a}–${b}`;
    actual.sub = `Del ${a} al ${b}`;
  }
  return out;
}

function Grafico({ r }: { r: Reporte }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  const [sel, setSel] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setSel(null), [r.periodo.desde, r.tipo]);

  const bs = buckets(r);
  const H = 170, top = 10, bottom = 24, left = 44;
  const ih = H - top - bottom, iw = w - left - 4;
  const max = Math.max(1, ...bs.flatMap((b) => [b.ingresos, b.egresos]));
  const paso = escala(max);
  const ymax = paso * Math.ceil(max / paso);
  const y = (v: number) => top + ih - (v / ymax) * ih;
  const slot = iw / bs.length;
  const bw = Math.max(3, Math.min(22, (slot - 8) / 2));
  const barra = (x: number, v: number, color: string, k: string) => {
    if (v <= 0) return null;
    const hgt = Math.max(2, top + ih - y(v)), rad = Math.min(4, bw / 2, hgt);
    const y0 = top + ih;
    return <path key={k} fill={color} d={`M${x},${y0} V${y0 - hgt + rad} Q${x},${y0 - hgt} ${x + rad},${y0 - hgt} H${x + bw - rad} Q${x + bw},${y0 - hgt} ${x + bw},${y0 - hgt + rad} V${y0} Z`} />;
  };
  const titulo = r.tipo === "mensual" ? "Semana a semana" : r.tipo === "semanal" ? "Día a día" : "Últimos 7 días";
  const s = sel !== null ? bs[sel] : null;

  return (
    <section className="card stack">
      <div className="between"><h3 className="rp-h2">{titulo}</h3>
        <div className="rp-legend"><span><i className="rp-dot" style={{ background: C_ING }} />Ingresos</span><span><i className="rp-dot" style={{ background: C_EGR }} />Gastos</span></div>
      </div>
      <div ref={ref}>
        <svg className="rp-chart" width={w} height={H} role="img" aria-label={`${titulo}: ingresos y gastos`}>
          {[0, 0.5, 1].map((f) => {
            const v = ymax * f;
            return (
              <g key={f}>
                <line x1={left} x2={w - 4} y1={y(v)} y2={y(v)} stroke={f === 0 ? "#C9D0CB" : "#EEF0EC"} />
                <text x={left - 6} y={y(v) + 4} textAnchor="end">{v === 0 ? "$0" : compacto(v)}</text>
              </g>
            );
          })}
          {bs.map((b, i) => {
            const cx = left + slot * i + slot / 2;
            const x1 = cx - bw - 1, x2 = cx + 1;
            return (
              <g key={i}>
                <rect className={`hit ${sel === i ? "on" : ""}`} x={left + slot * i} y={top} width={slot} height={ih} rx={6}
                  onMouseEnter={() => setSel(i)} onClick={() => setSel(i)}>
                  <title>{`${b.sub}: ingresos ${clp(b.ingresos)}, gastos ${clp(b.egresos)}`}</title>
                </rect>
                {barra(x1, b.ingresos, C_ING, "i")}
                {barra(x2, b.egresos, C_EGR, "e")}
                {(bs.length <= 10 || i % 2 === 0) && (
                  <text x={cx} y={H - 6} textAnchor="middle" style={b.destacado ? { fontWeight: 700, fill: "var(--texto)" } : undefined}>{b.label}</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="rp-detalle" aria-live="polite">
        {s ? <>
          <b style={{ textTransform: "capitalize" }}>{s.sub}</b>
          <span>Ingresos <b>{clp(s.ingresos)}</b></span>
          <span>Gastos <b>{clp(s.egresos)}</b></span>
          <span>Diferencia <b>{clp(s.ingresos - s.egresos)}</b></span>
        </> : <span className="muted">Toca una barra para ver el detalle.{r.tipo === "mensual" && " Los sueldos y el arriendo se ven en la semana en que se pagaron."}</span>}
      </div>
    </section>
  );
}
function escala(max: number) {
  const raw = max / 2;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

// ---------- Desgloses ----------
function Medios({ r }: { r: Reporte }) {
  const max = Math.max(1, ...r.por_medio.map((m) => m.monto));
  return (
    <section className="card stack">
      <div className="between"><h3 className="rp-h2">Ventas por medio de pago</h3><span className="muted">{clp(r.totales.ingresos)}</span></div>
      {r.totales.ingresos === 0 ? <div className="rp-empty">Sin ventas en este periodo.</div> : r.por_medio.map((m) => (
        <div key={m.medio} className="rp-row" title={`${m.label}: ${clp(m.monto)}`}>
          <div className="between"><span>{m.label} <span className="muted">{Math.round(m.pct)}%</span></span><span><b>{clp(m.monto)}</b></span></div>
          <div className="rp-bar"><i style={{ width: `${(m.monto / max) * 100}%` }} /></div>
          <div className="between"><span className="muted">{m.sin_boleta > 0 ? `${clp(m.sin_boleta)} sin boleta` : ""}</span><Var v={m.variacion} /></div>
        </div>
      ))}
    </section>
  );
}

function Categorias({ r }: { r: Reporte }) {
  const cats = r.por_categoria.filter((c) => c.monto > 0);
  const max = Math.max(1, ...cats.map((c) => c.monto));
  return (
    <section className="card stack">
      <div className="between"><h3 className="rp-h2">¿En qué se va la plata?</h3><span className="muted">{clp(r.totales.egresos)}</span></div>
      {cats.length === 0 ? <div className="rp-empty">Sin gastos en este periodo.</div> : cats.map((c) => (
        <div key={c.categoria} className="rp-row" title={`${c.label}: ${clp(c.monto)} en ${c.movimientos} movimientos`}>
          <div className="between"><span>{c.label} <span className="muted">{Math.round(c.pct)}%</span></span><span><b>{clp(c.monto)}</b></span></div>
          <div className="rp-bar"><i style={{ width: `${(c.monto / max) * 100}%`, background: C_EGR }} /></div>
          <div className="between"><span className="muted">{c.movimientos} {c.movimientos === 1 ? "movimiento" : "movimientos"}</span><Var v={c.variacion} subirEsBueno={false} /></div>
        </div>
      ))}
    </section>
  );
}

function DiaSemana({ r }: { r: Reporte }) {
  const dias = r.por_dia_semana;
  const max = Math.max(1, ...dias.map((d) => d.promedio));
  const mejor = dias.reduce((a, b) => (b.promedio > a.promedio ? b : a), dias[0]);
  return (
    <section className="card stack">
      <div className="between"><h3 className="rp-h2">¿Qué día se vende más?</h3><span className="muted">promedio</span></div>
      {mejor && mejor.promedio > 0 && <p className="muted">El mejor día es el <b style={{ color: "var(--texto)" }}>{mejor.dia}</b>, con {clp(mejor.promedio)} en promedio.</p>}
      {dias.map((d) => (
        <div key={d.dia} className="rp-row" title={`${d.dia}: ${clp(d.promedio)} promedio`}>
          <div className="between"><span style={{ textTransform: "capitalize" }}>{d.dia}</span><span><b>{d.promedio ? clp(d.promedio) : "—"}</b></span></div>
          <div className="rp-bar"><i style={{ width: `${(d.promedio / max) * 100}%`, opacity: d === mejor ? 1 : 0.6 }} /></div>
        </div>
      ))}
    </section>
  );
}

function TopDias({ r }: { r: Reporte }) {
  return (
    <section className="card stack">
      <div className="between"><h3 className="rp-h2">Mejores días</h3><span className="muted">{r.tipo === "diario" ? "últimos 30 días" : "del periodo"}</span></div>
      {r.top_dias.length === 0 ? <div className="rp-empty">Sin ventas registradas.</div> : (
        <ol className="rp-list">
          {r.top_dias.map((d, i) => (
            <li key={d.fecha}>
              <span className={`rp-rank ${i === 0 ? "r1" : ""}`}>{i + 1}</span>
              <span className="rp-grow"><span className="rp-name">{d.etiqueta[0].toUpperCase() + d.etiqueta.slice(1)}</span>{d.fecha === r.periodo.desde && r.tipo === "diario" && <span className="muted">el día que estás viendo</span>}</span>
              <span className="rp-amount">{clp(d.ingresos)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Proveedores({ r }: { r: Reporte }) {
  return (
    <section className="card stack">
      <h3 className="rp-h2">A quién le pagas más</h3>
      {r.top_proveedores.length === 0 ? <div className="rp-empty">Sin gastos con proveedor en este periodo.</div> : (
        <ol className="rp-list">
          {r.top_proveedores.map((p, i) => (
            <li key={p.proveedor}>
              <span className="rp-rank">{i + 1}</span>
              <span className="rp-grow"><span className="rp-name">{p.proveedor}</span><span className="muted">{p.compras} {p.compras === 1 ? "pago" : "pagos"}</span></span>
              <span className="rp-amount">{clp(p.monto)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Propinas({ r }: { r: Reporte }) {
  const max = Math.max(1, ...r.propinas_por_garzon.map((g) => g.monto));
  return (
    <section className="card stack">
      <div className="between"><h3 className="rp-h2">Propinas por garzón</h3><span className="muted">{clp(r.totales.propinas)}</span></div>
      {r.propinas_por_garzon.length === 0 ? <div className="rp-empty">Sin propinas en este periodo.</div> : r.propinas_por_garzon.map((g) => (
        <div key={g.garzon} className="rp-row">
          <div className="between"><span>{g.garzon} <span className="muted">{g.dias} {g.dias === 1 ? "día" : "días"}</span></span><span><b>{clp(g.monto)}</b></span></div>
          <div className="rp-bar"><i style={{ width: `${(g.monto / max) * 100}%`, background: "var(--mostaza)" }} /></div>
        </div>
      ))}
    </section>
  );
}

const mod: ClientModule = { id: "reportes", label: "Reportes", icon: "📊", Component: Pantalla };
export default mod;
