import type { Database } from "bun:sqlite";
import type { ServerModule, Tenant } from "../../core/types.ts";
import { HttpError } from "../../core/router.ts";

// Isla "facturas": "escaneo" de facturas de proveedores (OCR simulado) + catálogo de productos con historial de costos.
// Requiere la isla contabilidad (plan): al confirmar una factura escribe el egreso en contabilidad_egresos SI esa tabla existe.
// Tablas propias: facturas_facturas, facturas_lineas, facturas_productos, facturas_precios.

const IVA = 0.19;
export const ALZA_PCT = 8; // sobre este % de alza se avisa

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoy = () => ymd(new Date());
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const redondear = (n: number) => Math.round(n / 10) * 10;
const clave = (nombre: string, unidad: string) => `${nombre.trim().toLowerCase()}|${unidad.trim().toLowerCase()}`;

// ---------------- PRNG determinista ----------------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// Dígito verificador de RUT (módulo 11)
export function dvRut(cuerpo: number): string {
  let suma = 0, mul = 2;
  for (const c of String(cuerpo).split("").reverse()) { suma += Number(c) * mul; mul = mul === 7 ? 2 : mul + 1; }
  const res = 11 - (suma % 11);
  return res === 11 ? "0" : res === 10 ? "K" : String(res);
}
export const formatearRut = (cuerpo: number) => `${String(cuerpo).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dvRut(cuerpo)}`;

// ---------------- Proveedores y productos de referencia (CL) ----------------
interface ProvDef { nombre: string; rutCuerpo: number; giro: string; productos: { nombre: string; unidad: string; precio: number; inflacionMes: number; cant: number[] }[] }

export const PROVEEDORES: ProvDef[] = [
  {
    nombre: "Tostaduría Café Andino Ltda.", rutCuerpo: 76543210, giro: "Café en grano y molido",
    productos: [
      { nombre: "Café en grano Brasil Santos", unidad: "kg", precio: 12900, inflacionMes: 0.028, cant: [5, 8, 10] },
      { nombre: "Café en grano Colombia Huila", unidad: "kg", precio: 16800, inflacionMes: 0.035, cant: [3, 5, 6] },
      { nombre: "Café descafeinado molido", unidad: "kg", precio: 14500, inflacionMes: 0.015, cant: [1, 2] },
      { nombre: "Filtros de papel N°4 (100 u)", unidad: "caja", precio: 3200, inflacionMes: 0.008, cant: [4, 6] },
    ],
  },
  {
    nombre: "Lácteos del Maipo S.A.", rutCuerpo: 77891234, giro: "Lácteos y quesos",
    productos: [
      { nombre: "Leche entera", unidad: "litro", precio: 1050, inflacionMes: 0.012, cant: [40, 60, 80] },
      { nombre: "Leche sin lactosa", unidad: "litro", precio: 1390, inflacionMes: 0.01, cant: [12, 20, 24] },
      { nombre: "Crema para batir", unidad: "litro", precio: 3650, inflacionMes: 0.018, cant: [6, 10, 12] },
      { nombre: "Queso mantecoso laminado", unidad: "kg", precio: 8200, inflacionMes: 0.022, cant: [3, 5, 8] },
      { nombre: "Mantequilla", unidad: "kg", precio: 9400, inflacionMes: 0.02, cant: [2, 3, 4] },
    ],
  },
  {
    nombre: "Panadería La Espiga de Oro", rutCuerpo: 78234567, giro: "Panadería y pastelería",
    productos: [
      { nombre: "Pan de molde integral", unidad: "unidad", precio: 2250, inflacionMes: 0.011, cant: [12, 18, 24] },
      { nombre: "Marraqueta", unidad: "kg", precio: 1980, inflacionMes: 0.014, cant: [10, 15, 20] },
      { nombre: "Croissant congelado", unidad: "unidad", precio: 420, inflacionMes: 0.016, cant: [60, 90, 120] },
      { nombre: "Empanada de queso", unidad: "unidad", precio: 780, inflacionMes: 0.013, cant: [30, 50] },
    ],
  },
  {
    nombre: "Distribuidora Santa Elena Ltda.", rutCuerpo: 79456123, giro: "Abarrotes y envases",
    productos: [
      { nombre: "Azúcar granulada", unidad: "kg", precio: 1180, inflacionMes: 0.009, cant: [20, 25, 30] },
      { nombre: "Vaso de cartón 8 oz (50 u)", unidad: "paquete", precio: 4900, inflacionMes: 0.006, cant: [8, 12, 16] },
      { nombre: "Tapa plástica 8 oz (50 u)", unidad: "paquete", precio: 2700, inflacionMes: 0.005, cant: [8, 12] },
      { nombre: "Servilleta dispensadora (500 u)", unidad: "paquete", precio: 2100, inflacionMes: 0.007, cant: [10, 14] },
      { nombre: "Endulzante en sobres (500 u)", unidad: "caja", precio: 6800, inflacionMes: 0.004, cant: [2, 3] },
    ],
  },
  {
    nombre: "Frutas y Verduras Lo Valledor", rutCuerpo: 76998877, giro: "Frutas y verduras",
    productos: [
      { nombre: "Palta Hass", unidad: "kg", precio: 4200, inflacionMes: 0.055, cant: [8, 12, 15] },
      { nombre: "Tomate", unidad: "kg", precio: 1450, inflacionMes: -0.02, cant: [8, 10, 12] },
      { nombre: "Plátano", unidad: "kg", precio: 1250, inflacionMes: 0.01, cant: [10, 12] },
      { nombre: "Frutilla", unidad: "kg", precio: 3300, inflacionMes: 0.04, cant: [4, 6, 8] },
    ],
  },
  {
    nombre: "Comercial Insumos del Sur SpA", rutCuerpo: 77112233, giro: "Insumos de pastelería",
    productos: [
      { nombre: "Harina sin polvos", unidad: "kg", precio: 980, inflacionMes: 0.013, cant: [25, 50] },
      { nombre: "Chocolate cobertura 60%", unidad: "kg", precio: 11800, inflacionMes: 0.031, cant: [3, 5] },
      { nombre: "Huevo (bandeja 30 u)", unidad: "bandeja", precio: 5600, inflacionMes: 0.024, cant: [6, 10, 12] },
      { nombre: "Nuez mariposa", unidad: "kg", precio: 13500, inflacionMes: 0.028, cant: [2, 3] },
    ],
  },
];

const CATEGORIAS: Record<string, string> = {
  "Tostaduría Café Andino Ltda.": "Café", "Lácteos del Maipo S.A.": "Lácteos", "Panadería La Espiga de Oro": "Panadería",
  "Distribuidora Santa Elena Ltda.": "Abarrotes y envases", "Frutas y Verduras Lo Valledor": "Frutas y verduras",
  "Comercial Insumos del Sur SpA": "Pastelería",
};

// ---------------- OCR simulado ----------------
// ÚNICA pieza a reemplazar cuando llegue el OCR real: recibe el archivo y devuelve los datos leídos.
export interface LineaExtraida { producto: string; cantidad: number; unidad: string; precio_unitario: number; total: number }
export interface FacturaExtraida {
  proveedor: string; rut: string; giro: string; folio: string; fecha: string; categoria: string;
  neto: number; iva: number; total: number; condicion_pago: string; lineas: LineaExtraida[];
  confianza: number; motor: string; archivo: string | null;
}

export function extraerFactura(entrada: { archivo?: string; bytes?: number; semilla?: number; ejemplo?: boolean }): FacturaExtraida {
  // Simulación determinista: el "resultado del OCR" depende del nombre/tamaño del archivo.
  const semilla = (entrada.semilla ?? 0) + hash(entrada.archivo ?? "ejemplo") + (entrada.bytes ?? 0);
  const r = rng(semilla);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const prov = PROVEEDORES[Math.floor(r() * PROVEEDORES.length)];
  const nLineas = 2 + Math.floor(r() * Math.min(4, prov.productos.length - 1));
  const elegidos = [...prov.productos].sort(() => r() - 0.5).slice(0, nLineas);
  const fecha = ymd(addDays(new Date(), -Math.floor(r() * 4)));
  const lineas: LineaExtraida[] = elegidos.map((p) => {
    const cantidad = pick(p.cant);
    const precio = redondear(p.precio * (1 + p.inflacionMes * 2) * (1 + (r() - 0.4) * 0.12));
    return { producto: p.nombre, unidad: p.unidad, cantidad, precio_unitario: precio, total: Math.round(precio * cantidad) };
  });
  const neto = lineas.reduce((a, l) => a + l.total, 0);
  const iva = Math.round(neto * IVA);
  return {
    proveedor: prov.nombre, rut: formatearRut(prov.rutCuerpo), giro: prov.giro, categoria: CATEGORIAS[prov.nombre] ?? "Insumos",
    folio: String(100000 + Math.floor(r() * 899999)), fecha, neto, iva, total: neto + iva,
    condicion_pago: r() < 0.6 ? "30 días" : "Contado",
    lineas, confianza: Math.round((0.88 + r() * 0.11) * 100) / 100,
    motor: "simulado-v1", archivo: entrada.archivo ?? null,
  };
}

// ---------------- Guardado + automatización de productos ----------------
interface DatosFactura {
  proveedor: string; rut: string; folio: string; fecha: string; categoria?: string; neto: number; iva?: number; total?: number;
  estado?: "pagada" | "por_pagar"; condicion_pago?: string; archivo?: string | null; nota?: string | null; confianza?: number | null;
  lineas: { producto: string; cantidad: number; unidad: string; precio_unitario: number; total?: number }[];
}

export interface AlertaAlza { producto: string; unidad: string; anterior: number; nuevo: number; variacion_pct: number; proveedor: string }

function registrarFactura(db: Database, tenantId: number, d: DatosFactura, creadoEn?: string, conEgreso = true) {
  const neto = Math.round(d.neto);
  const iva = Math.round(d.iva ?? neto * IVA);
  const total = Math.round(d.total ?? neto + iva);
  const estado = d.estado === "pagada" ? "pagada" : "por_pagar";
  const dup = db.query("SELECT id FROM facturas_facturas WHERE tenant_id = ? AND rut = ? AND folio = ?").get(tenantId, d.rut, String(d.folio)) as { id: number } | null;
  if (dup) throw new HttpError(409, `La factura ${d.folio} de ${d.proveedor} ya está registrada`);

  const f = db.query(`INSERT INTO facturas_facturas (tenant_id, proveedor, rut, folio, fecha, categoria, neto, iva, total, estado, condicion_pago, archivo, nota, confianza, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime'))) RETURNING id`)
    .get(tenantId, d.proveedor, d.rut, String(d.folio), d.fecha, d.categoria ?? "Insumos", neto, iva, total, estado,
      d.condicion_pago ?? "30 días", d.archivo ?? null, d.nota ?? null, d.confianza ?? null, creadoEn ?? null) as { id: number };

  const insL = db.query("INSERT INTO facturas_lineas (tenant_id, factura_id, producto, cantidad, unidad, precio_unitario, total) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const insP = db.query(`INSERT INTO facturas_productos (tenant_id, clave, nombre, unidad, categoria, proveedor, ultimo_costo, costo_anterior, variacion_pct, ultima_compra, compras)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, 1) RETURNING id`);
  const insPrecio = db.query("INSERT INTO facturas_precios (tenant_id, producto_id, factura_id, fecha, proveedor, precio) VALUES (?, ?, ?, ?, ?, ?)");

  const alzas: AlertaAlza[] = [];
  for (const l of d.lineas) {
    const nombre = String(l.producto).trim();
    if (!nombre) continue;
    const unidad = String(l.unidad ?? "unidad").trim() || "unidad";
    const cantidad = Number(l.cantidad) || 0;
    const precio = Math.round(Number(l.precio_unitario) || 0);
    insL.run(tenantId, f.id, nombre, cantidad, unidad, precio, Math.round(l.total ?? precio * cantidad));

    const k = clave(nombre, unidad);
    let prod = db.query("SELECT * FROM facturas_productos WHERE tenant_id = ? AND clave = ?").get(tenantId, k) as any;
    if (!prod) {
      prod = insP.get(tenantId, k, nombre, unidad, d.categoria ?? "Insumos", d.proveedor, precio, d.fecha) as any;
      insPrecio.run(tenantId, prod.id, f.id, d.fecha, d.proveedor, precio);
      continue;
    }
    const anterior = Number(prod.ultimo_costo) || 0;
    const variacion = anterior > 0 ? ((precio - anterior) / anterior) * 100 : 0;
    // Solo mover el "último costo" si la factura es más nueva que la última compra registrada
    const esMasNueva = !prod.ultima_compra || d.fecha >= prod.ultima_compra;
    if (esMasNueva) {
      db.query(`UPDATE facturas_productos SET ultimo_costo = ?, costo_anterior = ?, variacion_pct = ?, ultima_compra = ?, proveedor = ?, compras = compras + 1 WHERE id = ?`)
        .run(precio, anterior || null, Math.round(variacion * 10) / 10, d.fecha, d.proveedor, prod.id);
    } else {
      db.query("UPDATE facturas_productos SET compras = compras + 1 WHERE id = ?").run(prod.id);
    }
    insPrecio.run(tenantId, prod.id, f.id, d.fecha, d.proveedor, precio);
    if (anterior > 0 && variacion > ALZA_PCT) alzas.push({ producto: nombre, unidad, anterior, nuevo: precio, variacion_pct: Math.round(variacion * 10) / 10, proveedor: d.proveedor });
  }

  // El egreso se escribe en la isla contabilidad sólo al confirmar una factura real (el seed no toca datos vecinos)
  const egreso = conEgreso
    ? registrarEgreso(db, tenantId, { id: f.id, proveedor: d.proveedor, fecha: d.fecha, total, neto, iva, categoria: d.categoria ?? "Insumos", folio: String(d.folio), estado })
    : { ok: false as const, motivo: "no corresponde (datos de prueba)", id: null };
  if (egreso.ok) db.query("UPDATE facturas_facturas SET egreso_id = ? WHERE id = ?").run(egreso.id ?? null, f.id);
  return { id: f.id, folio: String(d.folio), neto, iva, total, estado, alzas, egreso };
}

// ---------------- Integración tolerante con la isla contabilidad ----------------
// La tabla contabilidad_egresos la define otra isla: puede no existir todavía, tener otros nombres de
// columna u otros valores permitidos. Acá se detecta el esquema en caliente y, si no calza, no se escribe nada.
function valoresPermitidos(sql: string, columna: string): string[] | null {
  // Lee un CHECK (columna IN ('a','b',...)) del CREATE TABLE de la isla vecina
  const re = new RegExp(`${columna}\\s+IN\\s*\\(([^)]*)\\)`, "i");
  const m = sql.match(re);
  if (!m) return null;
  const vals = m[1].split(",").map((x) => x.trim().replace(/^'|'$/g, "")).filter(Boolean);
  return vals.length ? vals : null;
}

function registrarEgreso(db: Database, tenantId: number, f: { id: number; proveedor: string; fecha: string; total: number; neto: number; iva: number; categoria: string; folio: string; estado: string }) {
  try {
    const cols = db.query("PRAGMA table_info('contabilidad_egresos')").all() as { name: string; notnull: number; dflt_value: unknown; pk: number }[];
    if (!cols.length) return { ok: false as const, motivo: "contabilidad aún no tiene la tabla de egresos", id: null };
    const have = new Set(cols.map((c) => c.name));
    const sql = String((db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'contabilidad_egresos'").get() as { sql: string } | null)?.sql ?? "");
    const detalle = `Factura ${f.folio} · ${f.proveedor} (${f.categoria})`;
    // Nombres de columna posibles según cómo la haya definido la otra isla
    const candidatos: Record<string, unknown> = {
      tenant_id: tenantId, fecha: f.fecha, monto: f.total, total: f.total, neto: f.neto, iva: f.iva,
      categoria: "insumos", tipo: "insumos", glosa: detalle, detalle, descripcion: detalle, concepto: detalle, nota: detalle,
      proveedor: f.proveedor, documento: `Factura ${f.folio}`, folio: f.folio, con_documento: 1,
      medio: "transferencia", medio_pago: "transferencia", metodo_pago: "transferencia",
      estado: f.estado === "pagada" ? "pagado" : "pendiente", origen: "facturas", modulo: "facturas", fuente: "facturas",
    };
    // Respetar los CHECK ... IN (...) de la isla vecina
    for (const k of Object.keys(candidatos)) {
      const permitidos = valoresPermitidos(sql, k);
      if (!permitidos) continue;
      const valor = String(candidatos[k]);
      if (!permitidos.includes(valor)) {
        const preferido = ["insumos", "insumo", "proveedores", "compras", "otros", "otro"].find((v) => permitidos.includes(v));
        candidatos[k] = preferido ?? permitidos[0];
      }
    }
    const usar = Object.keys(candidatos).filter((k) => have.has(k));
    if (!usar.includes("tenant_id") || !usar.includes("fecha")) return { ok: false as const, motivo: "el esquema de contabilidad_egresos no calza", id: null };
    // Columnas obligatorias que no sabemos llenar → mejor no escribir nada en la isla vecina
    const faltan = cols.filter((c) => c.notnull && !c.pk && c.dflt_value === null && !usar.includes(c.name));
    if (faltan.length) return { ok: false as const, motivo: `faltan columnas en contabilidad_egresos: ${faltan.map((c) => c.name).join(", ")}`, id: null };
    const row = db.query(`INSERT INTO contabilidad_egresos (${usar.join(", ")}) VALUES (${usar.map(() => "?").join(", ")}) RETURNING rowid AS id`)
      .get(...usar.map((k) => candidatos[k] as any)) as { id: number } | null;
    return { ok: true as const, motivo: "ok" as const, id: row?.id ?? null };
  } catch (e: any) {
    return { ok: false as const, motivo: String(e?.message ?? e), id: null };
  }
}

// ---------------- seed ----------------
function seed(db: Database, tenant: Tenant) {
  const r = rng(tenant.id * 2654435761 + 7);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const tid = tenant.id;
  // Cada local compra a 3-5 de los proveedores
  const proveedores = [...PROVEEDORES].sort(() => r() - 0.5).slice(0, 3 + Math.floor(r() * 3));
  const folios = new Map<string, number>(proveedores.map((p) => [p.nombre, 1000 + Math.floor(r() * 8000)]));
  const cadaDias = new Map<string, number>(proveedores.map((p) => [p.nombre, 5 + Math.floor(r() * 7)]));
  // Alzas de precio del proveedor: a partir de cierta fecha el producto queda más caro (se mantiene)
  const alzas = new Map<string, { desde: number; factor: number }>();
  for (const prov of proveedores) for (const p of prov.productos) {
    if (r() < 0.45) alzas.set(`${prov.nombre}|${p.nombre}`, { desde: -Math.floor(r() * 26), factor: 1 + (0.09 + r() * 0.14) });
  }

  const tx = db.transaction(() => {
    for (const prov of proveedores) {
      const cada = cadaDias.get(prov.nombre)!;
      for (let off = -60 + (hash(prov.nombre) % cada); off <= 0; off += cada) {
        const fecha = ymd(addDays(new Date(), off));
        const mesesAtras = -off / 30;
        const nL = 2 + Math.floor(r() * Math.min(4, prov.productos.length - 1));
        const elegidos = [...prov.productos].sort(() => r() - 0.5).slice(0, nL);
        const lineas = elegidos.map((p) => {
          // Precio histórico: el de hoy descontando la inflación mensual del insumo
          const base = p.precio * Math.pow(1 + p.inflacionMes, -mesesAtras);
          // alza del proveedor: se mantiene desde la fecha en que subió
          const alza = alzas.get(`${prov.nombre}|${p.nombre}`);
          const salto = alza && off >= alza.desde ? alza.factor : 1;
          const precio = redondear(base * salto * (1 + (r() - 0.5) * 0.04));
          const cantidad = pick(p.cant);
          return { producto: p.nombre, unidad: p.unidad, cantidad, precio_unitario: precio, total: Math.round(precio * cantidad) };
        });
        const neto = lineas.reduce((a, l) => a + l.total, 0);
        const folio = folios.get(prov.nombre)!;
        folios.set(prov.nombre, folio + 1 + Math.floor(r() * 3));
        const vencida = off < -30;
        try {
          registrarFactura(db, tid, {
            proveedor: prov.nombre, rut: formatearRut(prov.rutCuerpo), folio: String(folio), fecha,
            categoria: CATEGORIAS[prov.nombre] ?? "Insumos", neto, lineas,
            estado: vencida ? (r() < 0.95 ? "pagada" : "por_pagar") : r() < 0.55 ? "pagada" : "por_pagar",
            condicion_pago: r() < 0.6 ? "30 días" : "Contado",
            archivo: r() < 0.7 ? `factura-${folio}.pdf` : null,
            confianza: Math.round((0.86 + r() * 0.13) * 100) / 100,
          }, `${fecha} ${pad(8 + Math.floor(r() * 10))}:${pad(Math.floor(r() * 60))}:00`, false);
        } catch { /* folio repetido: se ignora */ }
      }
    }
  });
  tx();
}

// ---------------- módulo ----------------
const mod: ServerModule = {
  id: "facturas",
  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS facturas_facturas (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL,
        proveedor TEXT NOT NULL, rut TEXT NOT NULL, folio TEXT NOT NULL, fecha TEXT NOT NULL,
        categoria TEXT NOT NULL DEFAULT 'Insumos',
        neto INTEGER NOT NULL, iva INTEGER NOT NULL, total INTEGER NOT NULL,
        estado TEXT NOT NULL DEFAULT 'por_pagar',  -- por_pagar | pagada
        condicion_pago TEXT, archivo TEXT, nota TEXT, confianza REAL,
        egreso_id INTEGER,                          -- id en contabilidad_egresos si la isla existe
        pagada_en TEXT, creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS facturas_facturas_t ON facturas_facturas(tenant_id, fecha);
      CREATE TABLE IF NOT EXISTS facturas_lineas (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL,
        factura_id INTEGER NOT NULL REFERENCES facturas_facturas(id) ON DELETE CASCADE,
        producto TEXT NOT NULL, cantidad REAL NOT NULL DEFAULT 1, unidad TEXT NOT NULL DEFAULT 'unidad',
        precio_unitario INTEGER NOT NULL, total INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS facturas_lineas_f ON facturas_lineas(factura_id);
      -- Catálogo de productos / insumos armado automáticamente desde las facturas
      CREATE TABLE IF NOT EXISTS facturas_productos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL,
        clave TEXT NOT NULL, nombre TEXT NOT NULL, unidad TEXT NOT NULL, categoria TEXT,
        proveedor TEXT, ultimo_costo INTEGER NOT NULL DEFAULT 0, costo_anterior INTEGER,
        variacion_pct REAL NOT NULL DEFAULT 0, ultima_compra TEXT, compras INTEGER NOT NULL DEFAULT 0,
        UNIQUE (tenant_id, clave)
      );
      CREATE TABLE IF NOT EXISTS facturas_precios (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL,
        producto_id INTEGER NOT NULL REFERENCES facturas_productos(id) ON DELETE CASCADE,
        factura_id INTEGER, fecha TEXT NOT NULL, proveedor TEXT, precio INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS facturas_precios_p ON facturas_precios(producto_id, fecha);
    `);
  },
  seed,
  routes: [
    {
      // "Escanear": acepta multipart (foto/PDF) o JSON {ejemplo:true}. No guarda nada: devuelve lo leído para revisar.
      method: "POST", path: "/escanear", handler: async (ctx) => {
        let archivo: string | null = null, bytes = 0;
        const ct = ctx.req.headers.get("content-type") ?? "";
        if (ct.includes("multipart/form-data")) {
          const form = await ctx.req.formData();
          const f = form.get("archivo");
          if (f && typeof f !== "string") { archivo = f.name; bytes = f.size; }
        } else {
          const b = await ctx.req.json().catch(() => ({} as any));
          if (b?.archivo) { archivo = String(b.archivo); bytes = Number(b.bytes) || 0; }
        }
        const datos = extraerFactura({ archivo: archivo ?? undefined, bytes, semilla: ctx.tenant.id * 31 });
        // Comparación contra el último costo conocido, para avisar antes de confirmar
        const lineas = datos.lineas.map((l) => {
          const p = ctx.db.query("SELECT ultimo_costo, ultima_compra FROM facturas_productos WHERE tenant_id = ? AND clave = ?")
            .get(ctx.tenant.id, clave(l.producto, l.unidad)) as { ultimo_costo: number; ultima_compra: string } | null;
          const variacion = p && p.ultimo_costo > 0 ? Math.round(((l.precio_unitario - p.ultimo_costo) / p.ultimo_costo) * 1000) / 10 : null;
          return { ...l, costo_anterior: p?.ultimo_costo ?? null, variacion_pct: variacion, alza: variacion !== null && variacion > ALZA_PCT, nuevo: !p };
        });
        return { ...datos, lineas, alza_pct: ALZA_PCT, ejemplo: !archivo };
      },
    },
    {
      // Confirmar: guarda la factura, actualiza productos/historial y registra el egreso.
      method: "POST", path: "/facturas", handler: async (ctx) => {
        const b = await ctx.body<DatosFactura>();
        if (!b?.proveedor || !b?.folio || !b?.fecha) throw new HttpError(400, "Faltan proveedor, folio o fecha");
        if (!Array.isArray(b.lineas) || !b.lineas.length) throw new HttpError(400, "La factura no tiene líneas");
        const neto = Math.round(Number(b.neto) || b.lineas.reduce((a, l) => a + (Number(l.total) || (Number(l.precio_unitario) || 0) * (Number(l.cantidad) || 0)), 0));
        if (neto <= 0) throw new HttpError(400, "El neto debe ser mayor a cero");
        return registrarFactura(ctx.db, ctx.tenant.id, { ...b, neto, rut: String(b.rut ?? "") });
      },
    },
    {
      method: "GET", path: "/facturas", handler: ({ db, tenant, url }) => {
        const estado = url.searchParams.get("estado");
        const where = estado === "pagada" || estado === "por_pagar" ? " AND estado = ?" : "";
        const args: any[] = [tenant.id, ...(where ? [estado] : [])];
        return db.query(`SELECT * FROM facturas_facturas WHERE tenant_id = ?${where} ORDER BY fecha DESC, id DESC LIMIT 200`).all(...args);
      },
    },
    {
      method: "GET", path: "/facturas/:id", handler: ({ db, tenant, params }) => {
        const f = db.query("SELECT * FROM facturas_facturas WHERE id = ? AND tenant_id = ?").get(Number(params.id), tenant.id);
        if (!f) throw new HttpError(404, "Factura no existe");
        return { ...f, lineas: db.query("SELECT * FROM facturas_lineas WHERE factura_id = ? ORDER BY id").all(Number(params.id)) };
      },
    },
    {
      // Marcar pagada / por pagar
      method: "PATCH", path: "/facturas/:id", handler: async (ctx) => {
        const b = await ctx.body();
        const estado = String(b?.estado ?? "");
        if (!["pagada", "por_pagar"].includes(estado)) throw new HttpError(400, "Estado inválido (pagada | por_pagar)");
        const f = ctx.db.query("SELECT id FROM facturas_facturas WHERE id = ? AND tenant_id = ?").get(Number(ctx.params.id), ctx.tenant.id) as { id: number } | null;
        if (!f) throw new HttpError(404, "Factura no existe");
        ctx.db.query("UPDATE facturas_facturas SET estado = ?, pagada_en = ? WHERE id = ?").run(estado, estado === "pagada" ? hoy() : null, f.id);
        return { ok: true, estado };
      },
    },
    {
      method: "GET", path: "/productos", handler: ({ db, tenant, url }) => {
        const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
        const rows = db.query(`SELECT * FROM facturas_productos WHERE tenant_id = ? ORDER BY variacion_pct DESC, nombre`).all(tenant.id) as any[];
        return q ? rows.filter((p) => String(p.nombre).toLowerCase().includes(q)) : rows;
      },
    },
    {
      method: "GET", path: "/productos/:id", handler: ({ db, tenant, params }) => {
        const p = db.query("SELECT * FROM facturas_productos WHERE id = ? AND tenant_id = ?").get(Number(params.id), tenant.id);
        if (!p) throw new HttpError(404, "Producto no existe");
        return { ...p, historial: db.query("SELECT fecha, precio, proveedor, factura_id FROM facturas_precios WHERE producto_id = ? ORDER BY fecha, id").all(Number(params.id)) };
      },
    },
    {
      // Productos que subieron de precio (sobre ALZA_PCT)
      method: "GET", path: "/alzas", handler: ({ db, tenant }) => ({
        alza_pct: ALZA_PCT,
        productos: db.query(`SELECT * FROM facturas_productos WHERE tenant_id = ? AND variacion_pct > ? AND costo_anterior IS NOT NULL ORDER BY variacion_pct DESC`).all(tenant.id, ALZA_PCT),
      }),
    },
    {
      method: "GET", path: "/resumen", handler: ({ db, tenant }) => {
        const tid = tenant.id;
        const porPagar = db.query("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS monto FROM facturas_facturas WHERE tenant_id = ? AND estado = 'por_pagar'").get(tid) as any;
        const mes = db.query("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS monto, COALESCE(SUM(iva),0) AS iva FROM facturas_facturas WHERE tenant_id = ? AND strftime('%Y-%m', fecha) = strftime('%Y-%m','now','localtime')").get(tid) as any;
        const alzas = db.query("SELECT COUNT(*) AS n FROM facturas_productos WHERE tenant_id = ? AND variacion_pct > ?").get(tid, ALZA_PCT) as any;
        const productos = db.query("SELECT COUNT(*) AS n FROM facturas_productos WHERE tenant_id = ?").get(tid) as any;
        const proveedores = db.query(`SELECT proveedor, COUNT(*) AS facturas, COALESCE(SUM(total),0) AS total FROM facturas_facturas
          WHERE tenant_id = ? AND fecha >= date('now','localtime','-90 days') GROUP BY proveedor ORDER BY total DESC`).all(tid);
        const contabilidad = (() => { try { return !!(db.query("PRAGMA table_info('contabilidad_egresos')").all() as any[]).length; } catch { return false; } })();
        return { por_pagar: porPagar, mes, alzas: alzas.n, productos: productos.n, proveedores, alza_pct: ALZA_PCT, contabilidad_conectada: contabilidad };
      },
    },
  ],
};
export default mod;
