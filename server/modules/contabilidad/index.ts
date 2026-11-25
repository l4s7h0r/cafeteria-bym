import type { Database } from "bun:sqlite";
import type { Ctx, ServerModule } from "../../core/types.ts";
import { HttpError } from "../../core/router.ts";
import { CATEGORIAS, CATEGORIA_LABEL, MEDIOS, MEDIO_LABEL, esFecha, hoy, inicioMes } from "./catalogo.ts";
import { seedContabilidad } from "./seed.ts";

// Isla "contabilidad": ingresos (ventas por medio de pago), egresos (por categoría) y propinas (con reparto por garzón).

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contabilidad_ingresos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      fecha TEXT NOT NULL,                    -- YYYY-MM-DD
      monto INTEGER NOT NULL CHECK (monto > 0),
      medio TEXT NOT NULL CHECK (medio IN ('efectivo','debito','credito','transferencia')),
      con_boleta INTEGER NOT NULL DEFAULT 1,
      descripcion TEXT,
      creado_en TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS contabilidad_ingresos_tf ON contabilidad_ingresos (tenant_id, fecha);

    CREATE TABLE IF NOT EXISTS contabilidad_egresos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      fecha TEXT NOT NULL,
      monto INTEGER NOT NULL CHECK (monto > 0),
      categoria TEXT NOT NULL CHECK (categoria IN ('insumos','sueldos','arriendo','servicios','mantencion','otros')),
      proveedor TEXT,
      descripcion TEXT,
      con_documento INTEGER NOT NULL DEFAULT 1,  -- boleta o factura del gasto
      creado_en TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS contabilidad_egresos_tf ON contabilidad_egresos (tenant_id, fecha);

    -- Propina de un día (o de un turno) y su reparto entre garzones
    CREATE TABLE IF NOT EXISTS contabilidad_propinas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      fecha TEXT NOT NULL,
      total INTEGER NOT NULL CHECK (total > 0),
      modo TEXT NOT NULL DEFAULT 'igual' CHECK (modo IN ('igual','manual')),
      nota TEXT,
      creado_en TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS contabilidad_propinas_tf ON contabilidad_propinas (tenant_id, fecha);
    CREATE TABLE IF NOT EXISTS contabilidad_propinas_reparto (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      propina_id INTEGER NOT NULL REFERENCES contabilidad_propinas(id) ON DELETE CASCADE,
      garzon TEXT NOT NULL,
      monto INTEGER NOT NULL CHECK (monto >= 0)
    );
    CREATE INDEX IF NOT EXISTS contabilidad_reparto_p ON contabilidad_propinas_reparto (tenant_id, propina_id);
  `);
}

// ---------- helpers ----------
const bad = (msg: string) => new HttpError(400, msg);

function rango(ctx: Ctx) {
  const q = ctx.url.searchParams;
  const desde = q.get("desde") || inicioMes();
  const hasta = q.get("hasta") || hoy();
  if (!esFecha(desde) || !esFecha(hasta)) throw bad("Fechas inválidas (usa YYYY-MM-DD)");
  if (desde > hasta) throw bad("La fecha 'desde' es posterior a 'hasta'");
  return { desde, hasta };
}

function monto(v: unknown, campo = "monto") {
  const n = typeof v === "string" ? Number(v.replace(/[^\d]/g, "")) : Number(v);
  if (!Number.isFinite(n) || n <= 0) throw bad(`El ${campo} debe ser mayor a cero`);
  if (n > 1_000_000_000) throw bad(`El ${campo} es demasiado alto`);
  return Math.round(n);
}

const texto = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const fechaBody = (v: unknown) => {
  const f = v ?? hoy();
  if (!esFecha(f)) throw bad("Fecha inválida (usa YYYY-MM-DD)");
  return f;
};
const idParam = (ctx: Ctx) => {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) throw bad("Id inválido");
  return id;
};

function listarPropinas(db: Database, tenantId: number, desde: string, hasta: string) {
  const dias = db.query(
    "SELECT id, fecha, total, modo, nota FROM contabilidad_propinas WHERE tenant_id = ? AND fecha BETWEEN ? AND ? ORDER BY fecha DESC, id DESC",
  ).all(tenantId, desde, hasta) as { id: number; fecha: string; total: number; modo: string; nota: string | null }[];
  const rep = db.query(
    `SELECT r.propina_id, r.garzon, r.monto FROM contabilidad_propinas_reparto r
     JOIN contabilidad_propinas p ON p.id = r.propina_id
     WHERE r.tenant_id = ? AND p.fecha BETWEEN ? AND ? ORDER BY r.id`,
  ).all(tenantId, desde, hasta) as { propina_id: number; garzon: string; monto: number }[];
  const porId = new Map<number, { garzon: string; monto: number }[]>();
  for (const r of rep) (porId.get(r.propina_id) ?? porId.set(r.propina_id, []).get(r.propina_id)!).push({ garzon: r.garzon, monto: r.monto });
  const porGarzon = new Map<string, { monto: number; dias: number }>();
  for (const r of rep) {
    const g = porGarzon.get(r.garzon) ?? { monto: 0, dias: 0 };
    g.monto += r.monto; g.dias += 1;
    porGarzon.set(r.garzon, g);
  }
  return {
    desde, hasta,
    total: dias.reduce((a, d) => a + d.total, 0),
    dias: dias.map((d) => ({ ...d, reparto: porId.get(d.id) ?? [] })),
    por_garzon: [...porGarzon].map(([garzon, g]) => ({ garzon, ...g })).sort((a, b) => b.monto - a.monto),
  };
}

// ---------- rutas ----------
const mod: ServerModule = {
  id: "contabilidad",
  migrate,
  seed: seedContabilidad,
  routes: [
    {
      method: "GET", path: "/catalogo",
      handler: () => ({
        medios: MEDIOS.map((id) => ({ id, label: MEDIO_LABEL[id] })),
        categorias: CATEGORIAS.map((id) => ({ id, label: CATEGORIA_LABEL[id] })),
      }),
    },

    // Ingresos
    {
      method: "GET", path: "/ingresos",
      handler: (ctx) => {
        const { desde, hasta } = rango(ctx);
        return ctx.db.query(
          "SELECT id, fecha, monto, medio, con_boleta, descripcion, creado_en FROM contabilidad_ingresos WHERE tenant_id = ? AND fecha BETWEEN ? AND ? ORDER BY fecha DESC, id DESC",
        ).all(ctx.tenant.id, desde, hasta);
      },
    },
    {
      method: "POST", path: "/ingresos",
      handler: async (ctx) => {
        const b = await ctx.body<any>().catch(() => ({}));
        if (!MEDIOS.includes(b.medio)) throw bad("Medio de pago inválido");
        return ctx.db.query(
          "INSERT INTO contabilidad_ingresos (tenant_id, fecha, monto, medio, con_boleta, descripcion) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
        ).get(ctx.tenant.id, fechaBody(b.fecha), monto(b.monto), b.medio, b.con_boleta === false || b.con_boleta === 0 ? 0 : 1, texto(b.descripcion));
      },
    },
    {
      method: "DELETE", path: "/ingresos/:id",
      handler: (ctx) => {
        const r = ctx.db.run("DELETE FROM contabilidad_ingresos WHERE id = ? AND tenant_id = ?", [idParam(ctx), ctx.tenant.id]);
        if (!r.changes) throw new HttpError(404, "Ingreso no encontrado");
        return { ok: true };
      },
    },

    // Egresos
    {
      method: "GET", path: "/egresos",
      handler: (ctx) => {
        const { desde, hasta } = rango(ctx);
        return ctx.db.query(
          "SELECT id, fecha, monto, categoria, proveedor, descripcion, con_documento, creado_en FROM contabilidad_egresos WHERE tenant_id = ? AND fecha BETWEEN ? AND ? ORDER BY fecha DESC, id DESC",
        ).all(ctx.tenant.id, desde, hasta);
      },
    },
    {
      method: "POST", path: "/egresos",
      handler: async (ctx) => {
        const b = await ctx.body<any>().catch(() => ({}));
        if (!CATEGORIAS.includes(b.categoria)) throw bad("Categoría inválida");
        return ctx.db.query(
          "INSERT INTO contabilidad_egresos (tenant_id, fecha, monto, categoria, proveedor, descripcion, con_documento) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *",
        ).get(ctx.tenant.id, fechaBody(b.fecha), monto(b.monto), b.categoria, texto(b.proveedor, 80), texto(b.descripcion), b.con_documento === false || b.con_documento === 0 ? 0 : 1);
      },
    },
    {
      method: "DELETE", path: "/egresos/:id",
      handler: (ctx) => {
        const r = ctx.db.run("DELETE FROM contabilidad_egresos WHERE id = ? AND tenant_id = ?", [idParam(ctx), ctx.tenant.id]);
        if (!r.changes) throw new HttpError(404, "Egreso no encontrado");
        return { ok: true };
      },
    },

    // Ingresos y egresos juntos, para la lista "últimos movimientos"
    {
      method: "GET", path: "/movimientos",
      handler: (ctx) => {
        const { desde, hasta } = rango(ctx);
        const limit = Math.min(500, Math.max(1, Number(ctx.url.searchParams.get("limit")) || 50));
        return ctx.db.query(
          `SELECT * FROM (
             SELECT 'ingreso' AS tipo, id, fecha, monto, medio AS clase, NULL AS proveedor, descripcion, con_boleta AS con_documento, creado_en
               FROM contabilidad_ingresos WHERE tenant_id = ?1 AND fecha BETWEEN ?2 AND ?3
             UNION ALL
             SELECT 'egreso', id, fecha, monto, categoria, proveedor, descripcion, con_documento, creado_en
               FROM contabilidad_egresos WHERE tenant_id = ?1 AND fecha BETWEEN ?2 AND ?3
           ) ORDER BY fecha DESC, creado_en DESC, id DESC LIMIT ?4`,
        ).all(ctx.tenant.id, desde, hasta, limit);
      },
    },

    // Propinas
    { method: "GET", path: "/propinas", handler: (ctx) => { const { desde, hasta } = rango(ctx); return listarPropinas(ctx.db, ctx.tenant.id, desde, hasta); } },
    {
      method: "POST", path: "/propinas",
      // body: { fecha, total, garzones: string[] }  → partes iguales
      //    o: { fecha, reparto: [{ garzon, monto }] } → reparto manual (total = suma)
      handler: async (ctx) => {
        const b = await ctx.body<any>().catch(() => ({}));
        const fecha = fechaBody(b.fecha);
        let reparto: { garzon: string; monto: number }[];
        let total: number;
        let modo: "igual" | "manual";
        if (Array.isArray(b.reparto) && b.reparto.length) {
          modo = "manual";
          reparto = b.reparto.map((r: any) => {
            const g = texto(r?.garzon, 40);
            if (!g) throw bad("Cada parte del reparto necesita el nombre del garzón");
            const m = Math.round(Number(r?.monto));
            if (!Number.isFinite(m) || m < 0) throw bad(`Monto inválido para ${g}`);
            return { garzon: g, monto: m };
          });
          total = reparto.reduce((a, r) => a + r.monto, 0);
          if (total <= 0) throw bad("El total de propinas debe ser mayor a cero");
          if (b.total != null && monto(b.total, "total") !== total) throw bad("La suma del reparto no calza con el total");
        } else {
          modo = "igual";
          total = monto(b.total, "total");
          const gs: string[] = [...new Set<string>((Array.isArray(b.garzones) ? b.garzones : []).map((g: unknown) => texto(g, 40)).filter(Boolean) as string[])];
          if (!gs.length) throw bad("Indica al menos un garzón para repartir");
          const parte = Math.floor(total / gs.length / 10) * 10;
          reparto = gs.map((garzon, i) => ({ garzon, monto: i === 0 ? total - parte * (gs.length - 1) : parte }));
        }
        const tx = ctx.db.transaction(() => {
          const { id } = ctx.db.query(
            "INSERT INTO contabilidad_propinas (tenant_id, fecha, total, modo, nota) VALUES (?, ?, ?, ?, ?) RETURNING id",
          ).get(ctx.tenant.id, fecha, total, modo, texto(b.nota)) as { id: number };
          const ins = ctx.db.query("INSERT INTO contabilidad_propinas_reparto (tenant_id, propina_id, garzon, monto) VALUES (?, ?, ?, ?)");
          for (const r of reparto) ins.run(ctx.tenant.id, id, r.garzon, r.monto);
          return id;
        });
        const id = tx();
        return { id, fecha, total, modo, nota: texto(b.nota), reparto };
      },
    },
    {
      method: "DELETE", path: "/propinas/:id",
      handler: (ctx) => {
        const r = ctx.db.run("DELETE FROM contabilidad_propinas WHERE id = ? AND tenant_id = ?", [idParam(ctx), ctx.tenant.id]);
        if (!r.changes) throw new HttpError(404, "Propina no encontrada");
        return { ok: true };
      },
    },
    {
      method: "GET", path: "/garzones",
      handler: (ctx) =>
        (ctx.db.query(
          `SELECT garzon, MAX(p.fecha) AS ultima FROM contabilidad_propinas_reparto r JOIN contabilidad_propinas p ON p.id = r.propina_id
           WHERE r.tenant_id = ? GROUP BY garzon ORDER BY ultima DESC, garzon LIMIT 30`,
        ).all(ctx.tenant.id) as { garzon: string }[]).map((r) => r.garzon),
    },

    // Resumen del periodo
    {
      method: "GET", path: "/resumen",
      handler: (ctx) => {
        const { desde, hasta } = rango(ctx);
        const t = ctx.tenant.id;
        const one = <T,>(sql: string) => ctx.db.query(sql).get(t, desde, hasta) as T;
        const ing = one<{ total: number; sin_boleta: number; n_sin: number }>(
          "SELECT COALESCE(SUM(monto),0) total, COALESCE(SUM(CASE WHEN con_boleta=0 THEN monto END),0) sin_boleta, COUNT(CASE WHEN con_boleta=0 THEN 1 END) n_sin FROM contabilidad_ingresos WHERE tenant_id=? AND fecha BETWEEN ? AND ?");
        const egr = one<{ total: number; sin_doc: number; n_sin: number }>(
          "SELECT COALESCE(SUM(monto),0) total, COALESCE(SUM(CASE WHEN con_documento=0 THEN monto END),0) sin_doc, COUNT(CASE WHEN con_documento=0 THEN 1 END) n_sin FROM contabilidad_egresos WHERE tenant_id=? AND fecha BETWEEN ? AND ?");
        const pro = one<{ total: number }>("SELECT COALESCE(SUM(total),0) total FROM contabilidad_propinas WHERE tenant_id=? AND fecha BETWEEN ? AND ?");
        const porMedio = ctx.db.query("SELECT medio, SUM(monto) monto FROM contabilidad_ingresos WHERE tenant_id=? AND fecha BETWEEN ? AND ? GROUP BY medio").all(t, desde, hasta) as { medio: string; monto: number }[];
        const porCat = ctx.db.query("SELECT categoria, SUM(monto) monto FROM contabilidad_egresos WHERE tenant_id=? AND fecha BETWEEN ? AND ? GROUP BY categoria").all(t, desde, hasta) as { categoria: string; monto: number }[];
        // IVA débito estimado: 19% incluido en las ventas con boleta
        const ivaVentas = Math.round(((ing.total - ing.sin_boleta) * 19) / 119);
        return {
          desde, hasta,
          ingresos: ing.total, egresos: egr.total, propinas: pro.total, resultado: ing.total - egr.total,
          ventas_sin_boleta: { monto: ing.sin_boleta, cantidad: ing.n_sin },
          gastos_sin_documento: { monto: egr.sin_doc, cantidad: egr.n_sin },
          iva_ventas_estimado: ivaVentas,
          por_medio: MEDIOS.map((m) => ({ medio: m, label: MEDIO_LABEL[m], monto: porMedio.find((x) => x.medio === m)?.monto ?? 0 })),
          por_categoria: CATEGORIAS.map((c) => ({ categoria: c, label: CATEGORIA_LABEL[c], monto: porCat.find((x) => x.categoria === c)?.monto ?? 0 }))
            .sort((a, b) => b.monto - a.monto),
        };
      },
    },
  ],
};
export default mod;
