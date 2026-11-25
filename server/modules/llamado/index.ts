import type { Database } from "bun:sqlite";
import type { ServerModule, Tenant } from "../../core/types.ts";
import { HttpError } from "../../core/router.ts";
import { qrSvg } from "./qr.ts";

// Isla "llamado": el comensal escanea el QR de su mesa (/p/:slug/mesa/:mesa) y llama al garzón.
// Tablas propias: llamado_mesas (lista simple, independiente de la isla reservas), llamado_llamados.

export const TIPOS = ["garzon", "cuenta", "otro"] as const;
export type TipoLlamado = (typeof TIPOS)[number];
export const TIPO_LABEL: Record<TipoLlamado, string> = { garzon: "Llamar al garzón", cuenta: "Pedir la cuenta", otro: "Otro" };
export const ESTADOS = ["pendiente", "atendiendo", "cerrado"] as const;
export type EstadoLlamado = (typeof ESTADOS)[number];

const ANTI_SPAM_SEG = 20; // mismo tipo en la misma mesa

interface MesaL { id: number; codigo: string; nombre: string; zona: string; activa: number }
interface Llamado {
  id: number; mesa_codigo: string; mesa_nombre: string; tipo: TipoLlamado; nota: string | null;
  estado: EstadoLlamado; creado_en: string; atendido_en: string | null; cerrado_en: string | null; canal: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
// Mismo formato que datetime('now','localtime') de SQLite
const fmtLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const ahora = () => fmtLocal(new Date());

const mesaPorCodigo = (db: Database, tid: number, codigo: string) =>
  db.query("SELECT * FROM llamado_mesas WHERE tenant_id = ? AND codigo = ? AND activa = 1").get(tid, String(codigo).trim().toLowerCase()) as MesaL | null;

const segundos = (desde: string, hasta?: string) =>
  Math.max(0, Math.round((new Date((hasta ?? ahora()).replace(" ", "T")).getTime() - new Date(desde.replace(" ", "T")).getTime()) / 1000));

function conEspera(rows: Llamado[]) {
  return rows.map((l) => ({
    ...l,
    tipo_label: TIPO_LABEL[l.tipo] ?? l.tipo,
    espera_seg: segundos(l.creado_en, l.estado === "cerrado" ? l.cerrado_en ?? undefined : undefined),
    respuesta_seg: l.atendido_en ? segundos(l.creado_en, l.atendido_en) : null,
  }));
}

// ---------- seed ----------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const NOTAS_OTRO = ["Falta servilletas", "Nos pueden traer agua, por favor", "La mesa quedó mojada", "Se puede subir un poco la música", "Necesitamos un plato extra", "Falta azúcar", "¿Tienen endulzante?", "Se cayó un vaso, perdón"];
const NOTAS_CUENTA = ["Pagamos con débito", "Dividido en dos, por favor", "Con boleta a nombre de la empresa", null, null];

function seed(db: Database, tenant: Tenant) {
  const r = rng(tenant.id * 104729 + 31);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const tid = tenant.id;

  const insM = db.query("INSERT INTO llamado_mesas (tenant_id, codigo, nombre, zona) VALUES (?, ?, ?, ?)");
  const nSalon = 6 + Math.floor(r() * 5), nTerraza = 2 + Math.floor(r() * 4);
  const mesas: { codigo: string; nombre: string }[] = [];
  for (let i = 1; i <= nSalon; i++) { mesas.push({ codigo: String(i), nombre: `Mesa ${i}` }); insM.run(tid, String(i), `Mesa ${i}`, "Salón"); }
  for (let i = 1; i <= nTerraza; i++) { const c = `t${i}`; mesas.push({ codigo: c, nombre: `Terraza ${i}` }); insM.run(tid, c, `Terraza ${i}`, "Terraza"); }
  if (r() < 0.7) { mesas.push({ codigo: "barra", nombre: "Barra" }); insM.run(tid, "barra", "Barra", "Barra"); }

  const insL = db.query(`INSERT INTO llamado_llamados (tenant_id, mesa_codigo, mesa_nombre, tipo, nota, estado, canal, creado_en, atendido_en, cerrado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const fmt = fmtLocal;
  const factor = 0.7 + r() * 0.8;
  const hoy = new Date();

  const tx = db.transaction(() => {
    for (let off = -60; off <= 0; off++) {
      const d = new Date(hoy); d.setDate(d.getDate() + off);
      const base = d.getDay() === 0 ? 8 : d.getDay() === 6 ? 22 : 14;
      const cant = Math.max(0, Math.round((base + (r() - 0.5) * 8) * factor));
      for (let k = 0; k < cant; k++) {
        const mesa = pick(mesas);
        const tipo: TipoLlamado = r() < 0.5 ? "garzon" : r() < 0.82 ? "cuenta" : "otro";
        const hora = 9 + Math.floor(r() * 12);
        const creado = new Date(d); creado.setHours(hora, Math.floor(r() * 60), Math.floor(r() * 60), 0);
        if (creado > hoy) continue;
        const respSeg = Math.round(20 + r() * 240);
        const cierreSeg = respSeg + Math.round(30 + r() * 300);
        const estado: EstadoLlamado = "cerrado";
        const atendido = fmt(new Date(creado.getTime() + respSeg * 1000));
        const cerrado = fmt(new Date(creado.getTime() + cierreSeg * 1000));
        const nota = tipo === "otro" ? pick(NOTAS_OTRO) : tipo === "cuenta" ? pick(NOTAS_CUENTA) : null;
        insL.run(tid, mesa.codigo, mesa.nombre, tipo, nota, estado, r() < 0.9 ? "qr" : "web", fmt(creado), atendido, cerrado);
      }
    }
    // Cola en vivo: unos cuantos llamados abiertos en los últimos minutos
    const abiertos = 2 + Math.floor(r() * 3);
    for (let k = 0; k < abiertos; k++) {
      const mesa = pick(mesas);
      const tipo: TipoLlamado = r() < 0.5 ? "garzon" : r() < 0.82 ? "cuenta" : "otro";
      const creado = new Date(hoy.getTime() - Math.round((30 + r() * 600) * 1000));
      const atendiendo = r() < 0.35;
      const nota = tipo === "otro" ? pick(NOTAS_OTRO) : tipo === "cuenta" ? pick(NOTAS_CUENTA) : null;
      insL.run(tid, mesa.codigo, mesa.nombre, tipo, nota, atendiendo ? "atendiendo" : "pendiente", r() < 0.9 ? "qr" : "web",
        fmt(creado), atendiendo ? fmt(new Date(creado.getTime() + 25000)) : null, null);
    }
  });
  tx();
}

// ---------- módulo ----------
const mod: ServerModule = {
  id: "llamado",
  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS llamado_mesas (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL,
        codigo TEXT NOT NULL,          -- va en la URL del QR: /p/:slug/mesa/:codigo
        nombre TEXT NOT NULL, zona TEXT NOT NULL DEFAULT 'Salón', activa INTEGER NOT NULL DEFAULT 1,
        UNIQUE (tenant_id, codigo)
      );
      CREATE TABLE IF NOT EXISTS llamado_llamados (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL,
        mesa_codigo TEXT NOT NULL, mesa_nombre TEXT NOT NULL,
        tipo TEXT NOT NULL,            -- garzon | cuenta | otro
        nota TEXT,
        estado TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | atendiendo | cerrado
        canal TEXT NOT NULL DEFAULT 'qr',          -- qr | web
        creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        atendido_en TEXT, cerrado_en TEXT
      );
      CREATE INDEX IF NOT EXISTS llamado_llamados_t ON llamado_llamados(tenant_id, estado, creado_en);
    `);
  },
  seed,
  routes: [
    // ----- interno -----
    { method: "GET", path: "/mesas", handler: ({ db, tenant }) => db.query("SELECT * FROM llamado_mesas WHERE tenant_id = ? AND activa = 1 ORDER BY zona, id").all(tenant.id) },
    {
      method: "POST", path: "/mesas", handler: async (ctx) => {
        const b = await ctx.body();
        const nombre = String(b?.nombre ?? "").trim();
        const codigo = String(b?.codigo ?? nombre).trim().toLowerCase().replace(/[^a-z0-9ñ-]+/g, "-").replace(/^-|-$/g, "");
        if (!nombre || !codigo) throw new HttpError(400, "Falta el nombre de la mesa");
        const ya = ctx.db.query("SELECT id FROM llamado_mesas WHERE tenant_id = ? AND codigo = ?").get(ctx.tenant.id, codigo);
        if (ya) throw new HttpError(409, "Ya existe una mesa con ese código");
        return ctx.db.query("INSERT INTO llamado_mesas (tenant_id, codigo, nombre, zona) VALUES (?, ?, ?, ?) RETURNING *")
          .get(ctx.tenant.id, codigo, nombre, String(b?.zona ?? "Salón").trim() || "Salón");
      },
    },
    {
      method: "DELETE", path: "/mesas/:id", handler: ({ db, tenant, params }) => {
        db.query("UPDATE llamado_mesas SET activa = 0 WHERE id = ? AND tenant_id = ?").run(Number(params.id), tenant.id);
        return { ok: true };
      },
    },
    {
      // Cola en vivo (polling cada 3 s desde la UI)
      method: "GET", path: "/cola", handler: ({ db, tenant }) => {
        const abiertos = db.query(`SELECT * FROM llamado_llamados WHERE tenant_id = ? AND estado IN ('pendiente','atendiendo') ORDER BY creado_en`).all(tenant.id) as Llamado[];
        const cerrados = db.query(`SELECT * FROM llamado_llamados WHERE tenant_id = ? AND estado = 'cerrado' AND date(creado_en) = date('now','localtime') ORDER BY creado_en DESC LIMIT 15`).all(tenant.id) as Llamado[];
        const hoyRows = db.query(`SELECT tipo, COUNT(*) AS n FROM llamado_llamados WHERE tenant_id = ? AND date(creado_en) = date('now','localtime') GROUP BY tipo`).all(tenant.id) as { tipo: TipoLlamado; n: number }[];
        const resp = conEspera(cerrados).map((l) => l.respuesta_seg).filter((x): x is number => x !== null);
        return {
          ahora: ahora(),
          abiertos: conEspera(abiertos),
          cerrados: conEspera(cerrados),
          hoy: {
            total: hoyRows.reduce((a, x) => a + x.n, 0),
            porTipo: Object.fromEntries(TIPOS.map((t) => [t, hoyRows.find((x) => x.tipo === t)?.n ?? 0])),
            promedio_respuesta_seg: resp.length ? Math.round(resp.reduce((a, b) => a + b, 0) / resp.length) : null,
          },
        };
      },
    },
    {
      // atender / cerrar / reabrir
      method: "PATCH", path: "/llamados/:id", handler: async (ctx) => {
        const b = await ctx.body();
        const accion = String(b?.accion ?? "");
        const l = ctx.db.query("SELECT * FROM llamado_llamados WHERE id = ? AND tenant_id = ?").get(Number(ctx.params.id), ctx.tenant.id) as Llamado | null;
        if (!l) throw new HttpError(404, "Llamado no existe");
        if (accion === "atender") ctx.db.query("UPDATE llamado_llamados SET estado = 'atendiendo', atendido_en = COALESCE(atendido_en, ?) WHERE id = ?").run(ahora(), l.id);
        else if (accion === "cerrar") ctx.db.query("UPDATE llamado_llamados SET estado = 'cerrado', atendido_en = COALESCE(atendido_en, ?), cerrado_en = ? WHERE id = ?").run(ahora(), ahora(), l.id);
        else if (accion === "reabrir") ctx.db.query("UPDATE llamado_llamados SET estado = 'pendiente', atendido_en = NULL, cerrado_en = NULL WHERE id = ?").run(l.id);
        else throw new HttpError(400, "Acción inválida (atender | cerrar | reabrir)");
        return { ok: true, accion };
      },
    },
    {
      // QR de una mesa como SVG (para la vista de impresión). `base` = origen público del sitio.
      method: "GET", path: "/qr/:mesa", handler: ({ db, tenant, params, url }) => {
        const mesa = mesaPorCodigo(db, tenant.id, params.mesa);
        if (!mesa) throw new HttpError(404, "Mesa no existe");
        const base = (url.searchParams.get("base") ?? `http://localhost:5173`).replace(/\/$/, "");
        const destino = `${base}/p/${tenant.slug}/mesa/${encodeURIComponent(mesa.codigo)}`;
        const svg = qrSvg(destino, Number(url.searchParams.get("escala") ?? 5));
        return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store" } });
      },
    },
    {
      // Historial para la vista interna
      method: "GET", path: "/historial", handler: ({ db, tenant, url }) => {
        const dias = Math.max(1, Math.min(60, Number(url.searchParams.get("dias") ?? 7) || 7));
        return db.query(`SELECT date(creado_en) AS fecha, COUNT(*) AS total,
            SUM(tipo = 'garzon') AS garzon, SUM(tipo = 'cuenta') AS cuenta, SUM(tipo = 'otro') AS otro
          FROM llamado_llamados WHERE tenant_id = ? AND date(creado_en) >= date('now','localtime', ?) GROUP BY fecha ORDER BY fecha DESC`)
          .all(tenant.id, `-${dias - 1} days`);
      },
    },

    // ----- público (QR de la mesa) -----
    {
      method: "GET", path: "/public/mesa/:mesa", public: true, handler: ({ db, tenant, params }) => {
        const mesa = mesaPorCodigo(db, tenant.id, params.mesa);
        if (!mesa) throw new HttpError(404, "Esta mesa no existe. Revisa el código del QR.");
        const abierto = db.query(`SELECT * FROM llamado_llamados WHERE tenant_id = ? AND mesa_codigo = ? AND estado IN ('pendiente','atendiendo') ORDER BY creado_en DESC LIMIT 1`)
          .get(tenant.id, mesa.codigo) as Llamado | null;
        return {
          local: tenant.nombre, mesa: { codigo: mesa.codigo, nombre: mesa.nombre, zona: mesa.zona },
          opciones: TIPOS.map((t) => ({ tipo: t, label: TIPO_LABEL[t] })),
          activo: abierto ? conEspera([abierto])[0] : null,
        };
      },
    },
    {
      method: "POST", path: "/public/mesa/:mesa", public: true, handler: async (ctx) => {
        const b = await ctx.body();
        const mesa = mesaPorCodigo(ctx.db, ctx.tenant.id, ctx.params.mesa);
        if (!mesa) throw new HttpError(404, "Esta mesa no existe. Revisa el código del QR.");
        const tipo = String(b?.tipo ?? "") as TipoLlamado;
        if (!TIPOS.includes(tipo)) throw new HttpError(400, "Elige una opción");
        const nota = b?.nota ? String(b.nota).trim().slice(0, 240) : null;
        if (tipo === "otro" && !nota) throw new HttpError(400, "Cuéntanos qué necesitas");
        const reciente = ctx.db.query(`SELECT id FROM llamado_llamados WHERE tenant_id = ? AND mesa_codigo = ? AND tipo = ? AND estado IN ('pendiente','atendiendo')
          AND creado_en >= datetime('now','localtime',?)`).get(ctx.tenant.id, mesa.codigo, tipo, `-${ANTI_SPAM_SEG} seconds`) as { id: number } | null;
        if (reciente) return { ok: true, id: reciente.id, repetido: true, mensaje: "Ya avisamos. Un garzón viene en camino." };
        const ins = ctx.db.query(`INSERT INTO llamado_llamados (tenant_id, mesa_codigo, mesa_nombre, tipo, nota, estado, canal, creado_en)
          VALUES (?, ?, ?, ?, ?, 'pendiente', ?, ?) RETURNING id`)
          .get(ctx.tenant.id, mesa.codigo, mesa.nombre, tipo, nota, ctx.url.searchParams.get("canal") === "web" ? "web" : "qr", ahora()) as { id: number };
        return { ok: true, id: ins.id, repetido: false, mensaje: tipo === "cuenta" ? "Listo, te llevamos la cuenta." : "Listo, un garzón va a tu mesa." };
      },
    },
    {
      // Para que la página de la mesa muestre el estado de su llamado
      method: "GET", path: "/public/llamados/:id", public: true, handler: ({ db, tenant, params }) => {
        const l = db.query("SELECT * FROM llamado_llamados WHERE id = ? AND tenant_id = ?").get(Number(params.id), tenant.id) as Llamado | null;
        if (!l) throw new HttpError(404, "No existe");
        return conEspera([l])[0];
      },
    },
  ],
};
export default mod;
