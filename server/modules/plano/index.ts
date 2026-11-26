import type { Database } from "bun:sqlite";
import type { ServerModule, Tenant } from "../../core/types.ts";
import { HttpError } from "../../core/router.ts";
import { normalizarPlano, type ElementoPlano, type Plano } from "../../../shared/plano.ts";

// Isla "plano": el dueño dibuja la forma del local y ubica mesas y elementos como están en la realidad.
// El plano lo usan otras islas en sus páginas públicas (reservar → elegir mesa, QR → "estás aquí")
// a través de GET /api/m/plano/public/plano. Si el cliente no tiene esta isla, esas páginas siguen sin mapa.
// Lee en modo solo lectura las tablas de reservas (reservas_mesas, reservas_reservas) y llamado
// (llamado_mesas, llamado_llamados) para vincular mesas y mostrar el estado en vivo. No escribe en ellas.
// Tabla propia: plano_planos (un plano por cliente, guardado como JSON).

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (h: string) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };

// Lectura tolerante de tablas de otras islas (pueden no existir)
function leer<T>(db: Database, sql: string, ...args: any[]): T[] {
  try { return db.query(sql).all(...args) as T[]; } catch { return []; }
}

function obtener(db: Database, tid: number): Plano | null {
  const row = db.query("SELECT datos, actualizado_en FROM plano_planos WHERE tenant_id = ?").get(tid) as { datos: string; actualizado_en: string } | null;
  if (!row) return null;
  try { return { ...JSON.parse(row.datos), actualizado_en: row.actualizado_en }; } catch { return null; }
}

function guardar(db: Database, tid: number, p: Plano) {
  const { actualizado_en: _, ...datos } = p;
  db.query(`INSERT INTO plano_planos (tenant_id, datos, actualizado_en) VALUES (?, ?, datetime('now','localtime'))
    ON CONFLICT (tenant_id) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en`).run(tid, JSON.stringify(datos));
}

// Plano en blanco: rectángulo de 12 x 8 m con la entrada abajo
export function planoVacio(): Plano {
  return {
    ancho: 14, alto: 10, contorno: [[1, 1], [13, 1], [13, 9], [1, 9]],
    elementos: [{ id: "puerta", tipo: "puerta", nombre: "Entrada", x: 7, y: 9, w: 1.6, h: 0.25, rot: 0 }],
  };
}

// ---------- plano de ejemplo armado desde las mesas que ya existen en reservas y llamado ----------
interface MesaR { id: number; nombre: string; capacidad: number; zona: string }
interface MesaL { codigo: string; nombre: string; zona: string }

function formaPara(cap: number): { forma: "redonda" | "cuadrada" | "rect"; w: number; h: number } {
  if (cap <= 2) return { forma: "redonda", w: 0.8, h: 0.8 };
  if (cap <= 4) return { forma: "cuadrada", w: 1, h: 1 };
  if (cap <= 6) return { forma: "rect", w: 1.8, h: 0.9 };
  return { forma: "rect", w: 2.6, h: 1 };
}

export function planoDesdeMesas(reservas: MesaR[], llamado: MesaL[]): Plano {
  const el: ElementoPlano[] = [
    { id: "cocina", tipo: "cocina", nombre: "Cocina", x: 2.2, y: 1.8, w: 3.2, h: 2.4, rot: 0 },
    { id: "bano", tipo: "bano", nombre: "Baño", x: 4.6, y: 1.5, w: 1.6, h: 1.8, rot: 0 },
    { id: "barra", tipo: "barra", nombre: "Barra", x: 7.6, y: 1.2, w: 3.6, h: 0.8, rot: 0 },
    { id: "caja", tipo: "caja", nombre: "Caja", x: 10.2, y: 1.2, w: 1.2, h: 0.8, rot: 0 },
    { id: "puerta", tipo: "puerta", nombre: "Entrada", x: 7, y: 8.6, w: 1.6, h: 0.25, rot: 0 },
    { id: "ventana1", tipo: "ventana", nombre: "Ventana", x: 3.2, y: 8.6, w: 2.6, h: 0.15, rot: 0 },
    { id: "ventana2", tipo: "ventana", nombre: "Ventana", x: 11, y: 8.6, w: 2.6, h: 0.15, rot: 0 },
    { id: "planta1", tipo: "planta", nombre: "Planta", x: 13.9, y: 3.1, w: 0.6, h: 0.6, rot: 0 },
    { id: "planta2", tipo: "planta", nombre: "Planta", x: 1.1, y: 8, w: 0.6, h: 0.6, rot: 0 },
    { id: "terraza", tipo: "terraza", nombre: "Terraza", x: 7.5, y: 10.4, w: 13, h: 2.6, rot: 0 },
  ];
  const zonaDe = (z: string) => (/terraza/i.test(z) ? "Terraza" : /barra/i.test(z) ? "Barra" : "Salón");
  const qrPorZona: Record<string, MesaL[]> = { Salón: [], Terraza: [], Barra: [] };
  for (const m of llamado) qrPorZona[zonaDe(m.zona)].push(m);
  const porZona: Record<string, { nombre: string; capacidad: number; reserva_mesa_id: number | null; qr: MesaL | null }[]> = { Salón: [], Terraza: [], Barra: [] };
  for (const m of reservas) porZona[zonaDe(m.zona)].push({ nombre: m.nombre, capacidad: m.capacidad, reserva_mesa_id: m.id, qr: qrPorZona[zonaDe(m.zona)].shift() ?? null });
  // Mesas que sólo existen en llamado (QR sin mesa de reservas). Si el nombre choca con otra mesa, se omite: el dueño la ubica a mano.
  const nombres = new Set(reservas.map((m) => m.nombre.toLowerCase()));
  for (const z of Object.keys(qrPorZona)) for (const q of qrPorZona[z]) {
    if (nombres.has(q.nombre.toLowerCase())) continue;
    nombres.add(q.nombre.toLowerCase());
    porZona[z].push({ nombre: q.nombre, capacidad: z === "Barra" ? 2 : 4, reserva_mesa_id: null, qr: q });
  }

  const fila = (lista: typeof porZona.Salón, y: number, x0: number, x1: number, zona: string) => {
    lista.forEach((m, i) => {
      const f = zona === "Barra" ? { forma: "redonda" as const, w: 0.6, h: 0.6 } : formaPara(m.capacidad);
      const x = lista.length === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (lista.length - 1);
      el.push({ id: `m${el.length + 1}`, tipo: "mesa", nombre: m.nombre, x: Math.round(x * 10) / 10, y, w: f.w, h: f.h, rot: 0, forma: f.forma,
        capacidad: m.capacidad, zona, reserva_mesa_id: m.reserva_mesa_id, qr_codigo: m.qr?.codigo ?? null });
    });
  };
  const salon = porZona.Salón;
  const porFila = Math.ceil(salon.length / 2);
  fila(salon.slice(0, porFila), 4.4, 2, 12.4, "Salón");
  fila(salon.slice(porFila), 6.8, 2, 12.4, "Salón");
  fila(porZona.Barra, 2.3, 6.4, 8.8, "Barra");
  fila(porZona.Terraza, 10.4, 2, 13, "Terraza");
  return { ancho: 15, alto: 12, contorno: [[0.6, 0.6], [11.2, 0.6], [11.2, 2.4], [14.4, 2.4], [14.4, 8.6], [0.6, 8.6]], elementos: el };
}

function vinculables(db: Database, tid: number) {
  return {
    reservas: leer<MesaR>(db, "SELECT id, nombre, capacidad, zona FROM reservas_mesas WHERE tenant_id = ? AND activa = 1 ORDER BY zona, id", tid),
    llamado: leer<MesaL>(db, "SELECT codigo, nombre, zona FROM llamado_mesas WHERE tenant_id = ? AND activa = 1 ORDER BY zona, id", tid),
  };
}

function seed(db: Database, tenant: Tenant) {
  const v = vinculables(db, tenant.id);
  guardar(db, tenant.id, v.reservas.length || v.llamado.length ? planoDesdeMesas(v.reservas, v.llamado) : planoVacio());
}

// ---------- estado en vivo de cada mesa ----------
type EstadoMesa = "libre" | "reservada" | "ocupada" | "llamando";
function estadoVivo(db: Database, tid: number, plano: Plano) {
  const ahora = new Date();
  const fecha = ymd(ahora);
  const minAhora = ahora.getHours() * 60 + ahora.getMinutes();
  const reservas = leer<{ mesa_id: number; nombre: string; hora: string; duracion_min: number; estado: string; personas: number }>(db,
    "SELECT mesa_id, nombre, hora, duracion_min, estado, personas FROM reservas_reservas WHERE tenant_id = ? AND fecha = ? AND estado IN ('pendiente','confirmada','sentada') AND mesa_id IS NOT NULL ORDER BY hora", tid, fecha);
  const llamados = leer<{ mesa_codigo: string; tipo: string; nota: string | null; creado_en: string; estado: string }>(db,
    "SELECT mesa_codigo, tipo, nota, creado_en, estado FROM llamado_llamados WHERE tenant_id = ? AND estado IN ('pendiente','atendiendo') ORDER BY creado_en", tid);
  const out: Record<string, { estado: EstadoMesa; detalle: string[] }> = {};
  for (const e of plano.elementos) {
    if (e.tipo !== "mesa") continue;
    const detalle: string[] = [];
    let estado: EstadoMesa = "libre";
    const delaMesa = e.reserva_mesa_id ? reservas.filter((r) => r.mesa_id === e.reserva_mesa_id) : [];
    const actual = delaMesa.find((r) => r.estado === "sentada" || (toMin(r.hora) <= minAhora && minAhora < toMin(r.hora) + r.duracion_min));
    const proxima = delaMesa.find((r) => r !== actual && toMin(r.hora) > minAhora && toMin(r.hora) - minAhora <= 120);
    if (actual) { estado = actual.estado === "sentada" ? "ocupada" : "reservada"; detalle.push(`${actual.estado === "sentada" ? "Sentados" : "Reserva"}: ${actual.nombre} (${actual.personas}p, ${actual.hora})`); }
    else if (proxima) { estado = "reservada"; detalle.push(`Próxima reserva ${proxima.hora}: ${proxima.nombre} (${proxima.personas}p)`); }
    const ll = e.qr_codigo ? llamados.filter((l) => l.mesa_codigo === e.qr_codigo) : [];
    if (ll.length) { estado = "llamando"; for (const l of ll) detalle.push(`${l.tipo === "cuenta" ? "Pide la cuenta" : l.tipo === "garzon" ? "Llama al garzón" : l.nota ?? "Otro"} · ${l.creado_en.slice(11, 16)}${l.estado === "atendiendo" ? " (en atención)" : ""}`); }
    out[e.id] = { estado, detalle };
  }
  return out;
}

const mod: ServerModule = {
  id: "plano",
  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS plano_planos (
        tenant_id INTEGER PRIMARY KEY,
        datos TEXT NOT NULL,           -- JSON con el formato de shared/plano.ts
        actualizado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
    `);
  },
  seed,
  routes: [
    {
      method: "GET", path: "/plano", handler: ({ db, tenant }) => ({ plano: obtener(db, tenant.id) ?? planoVacio(), vinculables: vinculables(db, tenant.id) }),
    },
    {
      method: "PUT", path: "/plano", handler: async (ctx) => {
        let p: Plano;
        try { p = normalizarPlano(await ctx.body()); } catch (e: any) { throw new HttpError(400, e.message); }
        guardar(ctx.db, ctx.tenant.id, p);
        return { ok: true, plano: obtener(ctx.db, ctx.tenant.id) };
      },
    },
    {
      // Propuesta automática desde las mesas de reservas y llamado (no guarda: el dueño la revisa y guarda)
      method: "GET", path: "/sugerido", handler: ({ db, tenant }) => { const v = vinculables(db, tenant.id); return planoDesdeMesas(v.reservas, v.llamado); },
    },
    {
      method: "GET", path: "/vivo", handler: ({ db, tenant }) => {
        const p = obtener(db, tenant.id) ?? planoVacio();
        return { ahora: new Date().toISOString(), estados: estadoVivo(db, tenant.id, p) };
      },
    },
    // ----- público: lo usan las páginas de reservar y del QR de la mesa -----
    {
      method: "GET", path: "/public/plano", public: true, handler: ({ db, tenant }) => {
        const p = obtener(db, tenant.id);
        if (!p || !p.elementos.some((e) => e.tipo === "mesa")) throw new HttpError(404, "Este local todavía no tiene plano");
        return { local: tenant.nombre, plano: p };
      },
    },
  ],
};
export default mod;
