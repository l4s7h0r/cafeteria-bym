import type { Database } from "bun:sqlite";
import type { Ctx, ServerModule, Tenant } from "../../core/types.ts";
import { HttpError } from "../../core/router.ts";

// Isla "reservas": mesas del local y reservas (agenda interna + página pública para el cliente final).
// Tablas: reservas_mesas, reservas_reservas.

export const ESTADOS = ["pendiente", "confirmada", "sentada", "cancelada", "no_llego"] as const;
export type EstadoReserva = (typeof ESTADOS)[number];
const ACTIVOS: EstadoReserva[] = ["pendiente", "confirmada", "sentada"]; // ocupan mesa

// Horario de reservas (prototipo: fijo para todos los locales)
export const HORARIO = { apertura: "09:00", ultimaReserva: "20:00", intervaloMin: 30, duracionMin: 90, maxPersonas: 12, diasAdelante: 30 };

// ---------- utilidades ----------
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoy = () => ymd(new Date());
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const toMin = (h: string) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
const toHora = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^\d{2}:\d{2}$/;

export function slots(): string[] {
  const out: string[] = [];
  for (let m = toMin(HORARIO.apertura); m <= toMin(HORARIO.ultimaReserva); m += HORARIO.intervaloMin) out.push(toHora(m));
  return out;
}

interface Mesa { id: number; nombre: string; capacidad: number; zona: string; activa: number }
interface Reserva {
  id: number; mesa_id: number | null; nombre: string; telefono: string; email: string | null; personas: number;
  fecha: string; hora: string; duracion_min: number; estado: EstadoReserva; nota: string | null; origen: string; codigo: string; creado_en: string;
}

const mesasActivas = (db: Database, tid: number) =>
  db.query("SELECT id, nombre, capacidad, zona, activa FROM reservas_mesas WHERE tenant_id = ? AND activa = 1 ORDER BY capacidad, nombre").all(tid) as Mesa[];

const reservasDelDia = (db: Database, tid: number, fecha: string) =>
  db.query(`SELECT r.*, m.nombre AS mesa_nombre, m.zona AS mesa_zona FROM reservas_reservas r
            LEFT JOIN reservas_mesas m ON m.id = r.mesa_id
            WHERE r.tenant_id = ? AND r.fecha = ? ORDER BY r.hora, r.id`).all(tid, fecha) as (Reserva & { mesa_nombre: string | null; mesa_zona: string | null })[];

const solapa = (a: number, aDur: number, b: number, bDur: number) => a < b + bDur && b < a + aDur;

// Mesa libre más chica que acomode a `personas` en ese horario.
function asignarMesa(db: Database, tid: number, fecha: string, hora: string, personas: number, excluirReserva?: number): Mesa | null {
  const ocupadas = new Set<number>();
  const ini = toMin(hora);
  for (const r of reservasDelDia(db, tid, fecha)) {
    if (r.id === excluirReserva || !r.mesa_id || !ACTIVOS.includes(r.estado)) continue;
    if (solapa(ini, HORARIO.duracionMin, toMin(r.hora), r.duracion_min)) ocupadas.add(r.mesa_id);
  }
  return mesasActivas(db, tid).find((m) => m.capacidad >= personas && !ocupadas.has(m.id)) ?? null;
}

// Mesas libres en una hora puntual (para que el cliente elija su mesa en el plano)
function mesasLibres(db: Database, tid: number, fecha: string, hora: string, excluirReserva?: number) {
  const ocupadas = new Set<number>();
  const ini = toMin(hora);
  for (const r of reservasDelDia(db, tid, fecha)) {
    if (r.id === excluirReserva || !r.mesa_id || !ACTIVOS.includes(r.estado)) continue;
    if (solapa(ini, HORARIO.duracionMin, toMin(r.hora), r.duracion_min)) ocupadas.add(r.mesa_id);
  }
  return mesasActivas(db, tid).map((m) => ({ ...m, libre: !ocupadas.has(m.id) }));
}

function disponibilidad(db: Database, tid: number, fecha: string, personas: number) {
  const ahora = new Date();
  const minAhora = fecha === hoy() ? ahora.getHours() * 60 + ahora.getMinutes() + 30 : -1; // 30 min de anticipación
  return slots().map((hora) => {
    const pasada = toMin(hora) < minAhora;
    const mesa = pasada ? null : asignarMesa(db, tid, fecha, hora, personas);
    return { hora, disponible: !!mesa };
  });
}

// Ocupación por franja: mesas tomadas / mesas totales (reservas activas o ya sentadas).
function ocupacion(db: Database, tid: number, fecha: string) {
  const mesas = mesasActivas(db, tid);
  const res = reservasDelDia(db, tid, fecha).filter((r) => ACTIVOS.includes(r.estado) && r.mesa_id);
  const franjas = slots().map((hora) => {
    const ini = toMin(hora);
    const usadas = new Set(res.filter((r) => solapa(ini, HORARIO.intervaloMin, toMin(r.hora), r.duracion_min)).map((r) => r.mesa_id));
    return { hora, mesas: usadas.size, pct: mesas.length ? Math.round((usadas.size / mesas.length) * 100) : 0 };
  });
  const promedio = franjas.length ? Math.round(franjas.reduce((a, f) => a + f.pct, 0) / franjas.length) : 0;
  const peak = franjas.reduce((a, f) => (f.pct > a.pct ? f : a), franjas[0] ?? { hora: "", mesas: 0, pct: 0 });
  return { totalMesas: mesas.length, franjas, promedio, peak };
}

const codigoReserva = () => Math.random().toString(36).slice(2, 7).toUpperCase();

function validarDatos(b: any, publico: boolean) {
  const nombre = String(b?.nombre ?? "").trim();
  const telefono = String(b?.telefono ?? "").trim();
  const personas = Number(b?.personas);
  const fecha = String(b?.fecha ?? "");
  const hora = String(b?.hora ?? "");
  if (nombre.length < 2) throw new HttpError(400, "Ingresa el nombre de la reserva");
  if (publico && telefono.replace(/\D/g, "").length < 8) throw new HttpError(400, "Ingresa un teléfono válido");
  if (!Number.isInteger(personas) || personas < 1 || personas > HORARIO.maxPersonas) throw new HttpError(400, `Las reservas son de 1 a ${HORARIO.maxPersonas} personas`);
  if (!FECHA_RE.test(fecha)) throw new HttpError(400, "Fecha inválida");
  if (!HORA_RE.test(hora) || !slots().includes(hora)) throw new HttpError(400, "Horario fuera de atención");
  if (publico) {
    if (fecha < hoy()) throw new HttpError(400, "La fecha ya pasó");
    if (fecha > ymd(addDays(new Date(), HORARIO.diasAdelante))) throw new HttpError(400, `Se puede reservar hasta ${HORARIO.diasAdelante} días antes`);
  }
  return {
    nombre: nombre.slice(0, 80), telefono: telefono.slice(0, 30), personas, fecha, hora,
    email: b?.email ? String(b.email).trim().slice(0, 120) : null,
    nota: b?.nota ? String(b.nota).trim().slice(0, 300) : null,
  };
}

function crearReserva(ctx: Ctx, b: any, publico: boolean) {
  const d = validarDatos(b, publico);
  const tid = ctx.tenant.id;
  let mesaId: number | null = null;
  if (!publico && b?.mesa_id) {
    const m = ctx.db.query("SELECT id FROM reservas_mesas WHERE id = ? AND tenant_id = ?").get(Number(b.mesa_id), tid) as { id: number } | null;
    if (!m) throw new HttpError(400, "Mesa no existe");
    mesaId = m.id;
  } else if (publico && b?.mesa_id) {
    // El cliente eligió su mesa en el plano del local
    const m = mesasLibres(ctx.db, tid, d.fecha, d.hora).find((x) => x.id === Number(b.mesa_id));
    if (!m) throw new HttpError(400, "Esa mesa no existe");
    if (m.capacidad < d.personas) throw new HttpError(409, `${m.nombre} es para ${m.capacidad} personas. Elige otra mesa.`);
    if (!m.libre) throw new HttpError(409, `${m.nombre} ya está tomada a esa hora. Elige otra o deja que te asignemos una.`);
    mesaId = m.id;
  } else {
    const m = asignarMesa(ctx.db, tid, d.fecha, d.hora, d.personas);
    if (!m && publico) throw new HttpError(409, "No quedan mesas para ese horario. Prueba otra hora.");
    mesaId = m?.id ?? null;
  }
  const estado: EstadoReserva = publico ? "pendiente" : (ESTADOS.includes(b?.estado) ? b.estado : "confirmada");
  const codigo = codigoReserva();
  const r = ctx.db.query(`INSERT INTO reservas_reservas (tenant_id, mesa_id, nombre, telefono, email, personas, fecha, hora, duracion_min, estado, nota, origen, codigo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .get(tid, mesaId, d.nombre, d.telefono, d.email, d.personas, d.fecha, d.hora, HORARIO.duracionMin, estado, d.nota, publico ? "web" : (b?.origen ?? "interno"), codigo) as { id: number };
  const mesa = mesaId ? (ctx.db.query("SELECT nombre, zona FROM reservas_mesas WHERE id = ?").get(mesaId) as { nombre: string; zona: string }) : null;
  return { id: r.id, codigo, estado, fecha: d.fecha, hora: d.hora, personas: d.personas, nombre: d.nombre, mesa_id: mesaId, mesa: mesa?.nombre ?? null, zona: mesa?.zona ?? null };
}

// ---------- seed ----------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const NOMBRES = ["Camila", "Valentina", "Francisca", "Javiera", "Catalina", "Constanza", "Fernanda", "Josefa", "Antonia", "Isidora", "Daniela", "Macarena", "Benjamín", "Matías", "Vicente", "Tomás", "Joaquín", "Agustín", "Sebastián", "Cristóbal", "Felipe", "Diego", "Nicolás", "Ignacio", "Rodrigo", "Patricio", "Carolina", "Paulina", "Marcela", "Claudio"];
const APELLIDOS = ["González", "Muñoz", "Rojas", "Díaz", "Pérez", "Soto", "Contreras", "Silva", "Martínez", "Sepúlveda", "Morales", "Rodríguez", "López", "Fuentes", "Hernández", "Torres", "Araya", "Flores", "Espinoza", "Valenzuela", "Castillo", "Tapia", "Reyes", "Gutiérrez", "Castro", "Pizarro", "Álvarez", "Vásquez", "Sánchez", "Fernández"];
const NOTAS = ["Cumpleaños, traen torta", "Silla de bebé, por favor", "Prefiere terraza", "Reunión de trabajo", "Alérgico a los frutos secos", "Llegan 10 min tarde", "Mesa tranquila si se puede", "Aniversario"];

function seed(db: Database, tenant: Tenant) {
  const r = rng(tenant.id * 7919 + 101);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const tid = tenant.id;

  // Mesas: salón, terraza y barra (cantidad varía por local)
  const insM = db.query("INSERT INTO reservas_mesas (tenant_id, nombre, capacidad, zona) VALUES (?, ?, ?, ?)");
  const nSalon = 5 + Math.floor(r() * 4), nTerraza = 2 + Math.floor(r() * 4), nBarra = Math.floor(r() * 3);
  let n = 1;
  for (let i = 0; i < nSalon; i++) insM.run(tid, `Mesa ${n++}`, pick([2, 2, 4, 4, 4, 6]), "Salón");
  for (let i = 0; i < nTerraza; i++) insM.run(tid, `Mesa ${n++}`, pick([2, 4, 4]), "Terraza");
  for (let i = 0; i < nBarra; i++) insM.run(tid, `Barra ${i + 1}`, 2, "Barra");
  if (r() < 0.6) insM.run(tid, "Mesa grande", 8 + Math.floor(r() * 3) * 2, "Salón");

  const insR = db.query(`INSERT INTO reservas_reservas (tenant_id, mesa_id, nombre, telefono, email, personas, fecha, hora, duracion_min, estado, nota, origen, codigo, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const horas = slots();
  const pesoHora = (h: string) => { const m = toMin(h); return m >= toMin("12:30") && m <= toMin("14:30") ? 3 : m >= toMin("17:00") && m <= toMin("19:00") ? 2.5 : m < toMin("10:30") ? 1.5 : 1; };
  const elegirHora = () => { const tot = horas.reduce((a, h) => a + pesoHora(h), 0); let x = r() * tot; for (const h of horas) { x -= pesoHora(h); if (x <= 0) return h; } return horas[horas.length - 1]; };
  const factorLocal = 0.7 + r() * 0.7;
  const hoyStr = hoy();
  const ahoraMin = new Date().getHours() * 60 + new Date().getMinutes();

  const tx = db.transaction(() => {
    for (let off = -60; off <= 14; off++) {
      const d = addDays(new Date(), off);
      const fecha = ymd(d);
      const dow = d.getDay();
      const base = dow === 0 ? 6 : dow === 6 ? 13 : dow === 5 ? 10 : 7;
      const cant = Math.max(1, Math.round((base + (r() - 0.5) * 4) * factorLocal * (off > 7 ? 0.55 : off > 0 ? 0.85 : 1)));
      for (let k = 0; k < cant; k++) {
        const hora = elegirHora();
        const personas = pick([2, 2, 2, 3, 4, 4, 4, 5, 6, 2, 8]);
        const mesa = asignarMesa(db, tid, fecha, hora, personas);
        if (!mesa) continue;
        let estado: EstadoReserva;
        const x = r();
        if (fecha < hoyStr || (fecha === hoyStr && toMin(hora) + HORARIO.duracionMin < ahoraMin)) estado = x < 0.8 ? "sentada" : x < 0.9 ? "no_llego" : "cancelada";
        else if (fecha === hoyStr && toMin(hora) <= ahoraMin) estado = x < 0.85 ? "sentada" : "no_llego";
        else estado = x < 0.55 ? "confirmada" : x < 0.93 ? "pendiente" : "cancelada";
        const nom = `${pick(NOMBRES)} ${pick(APELLIDOS)}`;
        const tel = `+56 9 ${Math.floor(1000 + r() * 9000)} ${Math.floor(1000 + r() * 9000)}`;
        const origen = r() < 0.55 ? "web" : r() < 0.6 ? "telefono" : "interno";
        const creado = ymd(addDays(d, -Math.floor(1 + r() * 6))) + ` ${pad(9 + Math.floor(r() * 10))}:${pad(Math.floor(r() * 60))}:00`;
        insR.run(tid, mesa.id, nom, tel, null, personas, fecha, hora, HORARIO.duracionMin, estado, r() < 0.18 ? pick(NOTAS) : null, origen,
          Math.floor(r() * 36 ** 5).toString(36).toUpperCase().padStart(5, "0"), creado);
      }
    }
  });
  tx();
}

// ---------- módulo ----------
const mod: ServerModule = {
  id: "reservas",
  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reservas_mesas (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL,
        nombre TEXT NOT NULL, capacidad INTEGER NOT NULL DEFAULT 4, zona TEXT NOT NULL DEFAULT 'Salón',
        activa INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS reservas_mesas_t ON reservas_mesas(tenant_id);
      CREATE TABLE IF NOT EXISTS reservas_reservas (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL,
        mesa_id INTEGER REFERENCES reservas_mesas(id) ON DELETE SET NULL,
        nombre TEXT NOT NULL, telefono TEXT NOT NULL DEFAULT '', email TEXT, personas INTEGER NOT NULL,
        fecha TEXT NOT NULL, hora TEXT NOT NULL, duracion_min INTEGER NOT NULL DEFAULT 90,
        estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | confirmada | sentada | cancelada | no_llego
        nota TEXT, origen TEXT NOT NULL DEFAULT 'interno', -- web | telefono | interno
        codigo TEXT NOT NULL, creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS reservas_reservas_tf ON reservas_reservas(tenant_id, fecha);
    `);
  },
  seed,
  routes: [
    // ----- interno -----
    { method: "GET", path: "/config", handler: () => ({ ...HORARIO, slots: slots(), estados: ESTADOS }) },
    { method: "GET", path: "/mesas", handler: ({ db, tenant }) => db.query("SELECT * FROM reservas_mesas WHERE tenant_id = ? AND activa = 1 ORDER BY zona, id").all(tenant.id) },
    {
      method: "POST", path: "/mesas", handler: async (ctx) => {
        const b = await ctx.body();
        const nombre = String(b?.nombre ?? "").trim(); const capacidad = Number(b?.capacidad ?? 4);
        if (!nombre) throw new HttpError(400, "Falta el nombre de la mesa");
        if (!(capacidad >= 1 && capacidad <= 20)) throw new HttpError(400, "Capacidad inválida");
        return ctx.db.query("INSERT INTO reservas_mesas (tenant_id, nombre, capacidad, zona) VALUES (?, ?, ?, ?) RETURNING *").get(ctx.tenant.id, nombre, capacidad, String(b?.zona ?? "Salón").trim() || "Salón");
      },
    },
    {
      method: "PATCH", path: "/mesas/:id", handler: async (ctx) => {
        const b = await ctx.body();
        const m = ctx.db.query("SELECT * FROM reservas_mesas WHERE id = ? AND tenant_id = ?").get(Number(ctx.params.id), ctx.tenant.id) as Mesa | null;
        if (!m) throw new HttpError(404, "Mesa no existe");
        ctx.db.query("UPDATE reservas_mesas SET nombre = ?, capacidad = ?, zona = ? WHERE id = ?")
          .run(String(b?.nombre ?? m.nombre), Number(b?.capacidad ?? m.capacidad), String(b?.zona ?? m.zona), m.id);
        return { ok: true };
      },
    },
    {
      method: "DELETE", path: "/mesas/:id", handler: ({ db, tenant, params }) => {
        db.query("UPDATE reservas_mesas SET activa = 0 WHERE id = ? AND tenant_id = ?").run(Number(params.id), tenant.id);
        return { ok: true };
      },
    },
    {
      // Agenda del día: reservas + resumen + ocupación por franja
      method: "GET", path: "/dia", handler: ({ db, tenant, url }) => {
        const fecha = url.searchParams.get("fecha") ?? hoy();
        if (!FECHA_RE.test(fecha)) throw new HttpError(400, "Fecha inválida");
        const reservas = reservasDelDia(db, tenant.id, fecha);
        const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, reservas.filter((r) => r.estado === e).length]));
        const vigentes = reservas.filter((r) => r.estado !== "cancelada" && r.estado !== "no_llego");
        return {
          fecha, reservas, porEstado,
          resumen: { total: reservas.length, vigentes: vigentes.length, personas: vigentes.reduce((a, r) => a + r.personas, 0), web: reservas.filter((r) => r.origen === "web").length },
          ocupacion: ocupacion(db, tenant.id, fecha),
        };
      },
    },
    {
      // Próximos días: cantidad de reservas vigentes y personas
      method: "GET", path: "/semana", handler: ({ db, tenant, url }) => {
        const desde = url.searchParams.get("desde") ?? hoy();
        const hasta = ymd(addDays(new Date(desde + "T12:00:00"), 6));
        const rows = db.query(`SELECT fecha, COUNT(*) AS reservas, SUM(personas) AS personas, SUM(estado = 'pendiente') AS pendientes
          FROM reservas_reservas WHERE tenant_id = ? AND fecha BETWEEN ? AND ? AND estado NOT IN ('cancelada','no_llego') GROUP BY fecha`).all(tenant.id, desde, hasta) as any[];
        const map = new Map(rows.map((x) => [x.fecha, x]));
        return Array.from({ length: 7 }, (_, i) => { const f = ymd(addDays(new Date(desde + "T12:00:00"), i)); return map.get(f) ?? { fecha: f, reservas: 0, personas: 0, pendientes: 0 }; });
      },
    },
    { method: "GET", path: "/reservas", handler: ({ db, tenant, url }) => reservasDelDia(db, tenant.id, url.searchParams.get("fecha") ?? hoy()) },
    { method: "POST", path: "/reservas", handler: async (ctx) => crearReserva(ctx, await ctx.body(), false) },
    {
      method: "PATCH", path: "/reservas/:id", handler: async (ctx) => {
        const b = await ctx.body();
        const r = ctx.db.query("SELECT * FROM reservas_reservas WHERE id = ? AND tenant_id = ?").get(Number(ctx.params.id), ctx.tenant.id) as Reserva | null;
        if (!r) throw new HttpError(404, "Reserva no existe");
        if (b?.estado !== undefined && !ESTADOS.includes(b.estado)) throw new HttpError(400, "Estado inválido");
        let mesaId = r.mesa_id;
        if (b?.mesa_id !== undefined) {
          if (b.mesa_id === null) mesaId = null;
          else {
            const m = ctx.db.query("SELECT id FROM reservas_mesas WHERE id = ? AND tenant_id = ?").get(Number(b.mesa_id), ctx.tenant.id) as { id: number } | null;
            if (!m) throw new HttpError(400, "Mesa no existe");
            mesaId = m.id;
          }
        }
        // Reactivar una reserva sin mesa: intentar asignar
        const estado: EstadoReserva = b?.estado ?? r.estado;
        if (!mesaId && ACTIVOS.includes(estado)) mesaId = asignarMesa(ctx.db, ctx.tenant.id, r.fecha, r.hora, r.personas, r.id)?.id ?? null;
        ctx.db.query("UPDATE reservas_reservas SET estado = ?, mesa_id = ?, nota = ? WHERE id = ?").run(estado, mesaId, b?.nota ?? r.nota, r.id);
        return { ok: true, estado, mesa_id: mesaId };
      },
    },

    // ----- público (cliente final, página /p/:slug/reservar) -----
    {
      method: "GET", path: "/public/disponibilidad", public: true, handler: ({ db, tenant, url }) => {
        const fecha = url.searchParams.get("fecha") ?? hoy();
        const personas = Math.max(1, Math.min(HORARIO.maxPersonas, Number(url.searchParams.get("personas") ?? 2) || 2));
        if (!FECHA_RE.test(fecha)) throw new HttpError(400, "Fecha inválida");
        const fuera = fecha < hoy() || fecha > ymd(addDays(new Date(), HORARIO.diasAdelante));
        return {
          local: tenant.nombre, fecha, personas, maxPersonas: HORARIO.maxPersonas, diasAdelante: HORARIO.diasAdelante,
          horas: fuera ? slots().map((hora) => ({ hora, disponible: false })) : disponibilidad(db, tenant.id, fecha, personas),
        };
      },
    },
    {
      // Estado de cada mesa a una hora: libre/ocupada y si cabe el grupo (lo usa el plano en /p/:slug/reservar)
      method: "GET", path: "/public/mesas", public: true, handler: ({ db, tenant, url }) => {
        const fecha = url.searchParams.get("fecha") ?? hoy();
        const hora = url.searchParams.get("hora") ?? "";
        const personas = Math.max(1, Number(url.searchParams.get("personas") ?? 2) || 2);
        if (!FECHA_RE.test(fecha) || !slots().includes(hora)) throw new HttpError(400, "Fecha u hora inválida");
        return mesasLibres(db, tenant.id, fecha, hora).map((m) => ({ id: m.id, nombre: m.nombre, capacidad: m.capacidad, zona: m.zona, libre: m.libre, cabe: m.capacidad >= personas }));
      },
    },
    {
      method: "POST", path: "/public/reservas", public: true, handler: async (ctx) => {
        const b = await ctx.body();
        const res = crearReserva(ctx, { nombre: b?.nombre, telefono: b?.telefono, email: b?.email, personas: b?.personas, fecha: b?.fecha, hora: b?.hora, nota: b?.nota, mesa_id: b?.mesa_id }, true);
        return { ...res, local: ctx.tenant.nombre };
      },
    },
  ],
};
export default mod;
