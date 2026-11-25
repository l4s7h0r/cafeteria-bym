import type { Database } from "bun:sqlite";
import type { Tenant } from "../../core/types.ts";
import { ymd, type Categoria, type Medio } from "./catalogo.ts";

// PRNG determinista (mulberry32): cada cliente tiene sus propios números, siempre los mismos.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIAS = 60;
const GARZONES = ["Camila", "Benjamín", "Josefa", "Tomás", "Antonia", "Vicente", "Martina", "Joaquín", "Catalina", "Diego", "Fernanda", "Ignacio"];
const EQUIPO = ["Rosa (cocina)", "Pedro (barista)", "Daniela (caja)", "Luis (cocina)", "Carla (barista)", "Javier (copero)", "Paula (cocina)"];

// Proveedores de insumos: [proveedor, descripción, mínimo, máximo] (en fracción de la venta diaria base)
const INSUMOS: [string, string, number, number][] = [
  ["Tostaduría del Valle", "Café en grano 5 kg", 0.35, 0.8],
  ["Lácteos del Sur", "Leche entera y crema", 0.25, 0.6],
  ["Panadería La Espiga", "Pan, marraqueta y masas", 0.15, 0.4],
  ["Feria Lo Valledor", "Palta, tomate y frutas", 0.15, 0.45],
  ["Supermercado mayorista", "Azúcar, endulzante y abarrotes", 0.2, 0.55],
  ["Distribuidora de envases", "Vasos, tapas y servilletas", 0.15, 0.4],
  ["Pastelería Dulce Hogar", "Kuchen y tortas", 0.2, 0.5],
];
const OTROS: [string | null, string, number, number][] = [
  ["Librería y bazar", "Rollos de boleta y lápices", 6000, 18000],
  ["Ferretería del barrio", "Ampolletas y repuestos", 8000, 35000],
  [null, "Artículos de aseo", 9000, 28000],
  [null, "Cajas de cartón para delivery", 12000, 30000],
];
const MANTENCION: [string, string, number, number][] = [
  ["Servicio técnico cafetero", "Mantención máquina de espresso", 65000, 140000],
  ["Gasfíter", "Arreglo de lavaplatos", 35000, 70000],
  ["Técnico en refrigeración", "Revisión de vitrina refrigerada", 45000, 110000],
];

export function seedContabilidad(db: Database, tenant: Tenant) {
  const rnd = mulberry32(tenant.id * 2654435761 + 12345);
  const r = (a: number, b: number) => a + (b - a) * rnd();
  const ri = (a: number, b: number) => Math.round(r(a, b));
  const round100 = (n: number) => Math.round(n / 100) * 100;
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];

  // Perfil del local
  const base = ri(380, 950) * 1000;                     // venta diaria promedio
  const cierraDomingo = rnd() < 0.35;
  const arriendo = Math.round((base * r(2.2, 3.2)) / 10000) * 10000;
  const equipo = EQUIPO.slice(0, Math.min(EQUIPO.length, Math.max(3, Math.round(base / 115000)))).map((n) => ({ n, sueldo: ri(55, 85) * 10000 }));
  const garzones = [...GARZONES].sort(() => rnd() - 0.5).slice(0, ri(2, 4));
  const factorDia = [1.12, 0.78, 0.86, 0.92, 0.98, 1.2, 1.4]; // domingo..sábado

  db.run("DELETE FROM contabilidad_propinas WHERE tenant_id = ?", [tenant.id]);
  db.run("DELETE FROM contabilidad_ingresos WHERE tenant_id = ?", [tenant.id]);
  db.run("DELETE FROM contabilidad_egresos WHERE tenant_id = ?", [tenant.id]);

  const insI = db.query("INSERT INTO contabilidad_ingresos (tenant_id, fecha, monto, medio, con_boleta, descripcion) VALUES (?, ?, ?, ?, ?, ?)");
  const insE = db.query("INSERT INTO contabilidad_egresos (tenant_id, fecha, monto, categoria, proveedor, descripcion, con_documento) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const insP = db.query("INSERT INTO contabilidad_propinas (tenant_id, fecha, total, modo, nota) VALUES (?, ?, ?, 'igual', NULL) RETURNING id");
  const insR = db.query("INSERT INTO contabilidad_propinas_reparto (tenant_id, propina_id, garzon, monto) VALUES (?, ?, ?, ?)");
  const egreso = (f: string, monto: number, cat: Categoria, prov: string | null, desc: string, doc = 1) =>
    insE.run(tenant.id, f, Math.max(1000, round100(monto)), cat, prov, desc, doc);

  db.transaction(() => {
    const today = new Date();
    for (let i = DIAS - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const f = ymd(d);
      const dow = d.getDay();
      const ultimoDelMes = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() === d.getDate();
      const abierto = !(cierraDomingo && dow === 0);

      // ---- Ingresos: un cierre de caja por medio de pago ----
      let venta = 0;
      if (abierto) {
        const tendencia = 1 + (DIAS - i) * 0.0015;
        venta = base * factorDia[dow] * r(0.85, 1.15) * tendencia;
        const pesos: Record<Medio, number> = { debito: r(0.36, 0.48), credito: r(0.15, 0.24), efectivo: r(0.18, 0.28), transferencia: r(0.08, 0.16) };
        const suma = Object.values(pesos).reduce((a, b) => a + b, 0);
        for (const m of Object.keys(pesos) as Medio[]) {
          const monto = round100((venta * pesos[m]) / suma);
          if (m === "efectivo" && rnd() < 0.55) {
            const sin = round100(monto * r(0.08, 0.2));
            insI.run(tenant.id, f, monto - sin, m, 1, "Cierre de caja");
            insI.run(tenant.id, f, sin, m, 0, "Ventas de mostrador sin boleta");
          } else {
            insI.run(tenant.id, f, monto, m, 1, "Cierre de caja");
          }
        }
        // Algún pedido grande por transferencia (oficinas, eventos)
        if (rnd() < 0.08) insI.run(tenant.id, f, round100(r(45000, 160000)), "transferencia", 1, pick(["Pedido de oficina", "Coffee break evento", "Pedido de cumpleaños"]));

        // ---- Propinas del día, repartidas en partes iguales ----
        const total = round100(venta * r(0.05, 0.08));
        const turno = garzones.filter(() => rnd() < 0.8);
        if (turno.length === 0) turno.push(garzones[0]);
        const { id } = insP.get(tenant.id, f, total) as { id: number };
        const parte = Math.floor(total / turno.length / 10) * 10;
        turno.forEach((g, k) => insR.run(tenant.id, id, g, k === 0 ? total - parte * (turno.length - 1) : parte));
      }

      // ---- Egresos ----
      if (abierto && rnd() < 0.72) {
        const [prov, desc, a, b] = pick(INSUMOS);
        egreso(f, base * r(a, b) * 1.25, "insumos", prov, desc);
      }
      if (abierto && rnd() < 0.2) egreso(f, base * r(0.15, 0.4), "insumos", "Feria Lo Valledor", "Compra de feria", rnd() < 0.6 ? 0 : 1);
      if (d.getDate() === 5) egreso(f, arriendo, "arriendo", "Inmobiliaria del local", "Arriendo del mes");
      if (d.getDate() === 10) egreso(f, equipo.reduce((a, p) => a + p.sueldo, 0) * r(0.19, 0.23), "sueldos", "Previred", "Imposiciones y leyes sociales");
      if (d.getDate() === 15) for (const p of equipo) egreso(f, p.sueldo * 0.35, "sueldos", null, `Anticipo ${p.n}`);
      if (ultimoDelMes) for (const p of equipo) egreso(f, p.sueldo * 0.65, "sueldos", null, `Sueldo ${p.n}`);
      if (d.getDate() === 12) egreso(f, base * r(0.3, 0.42), "servicios", "Empresa eléctrica", "Luz del local");
      if (d.getDate() === 18) egreso(f, r(28000, 55000), "servicios", "Empresa de agua", "Agua potable");
      if (d.getDate() === 8) egreso(f, r(24990, 34990), "servicios", "Proveedor de internet", "Internet y teléfono");
      if (d.getDate() % 10 === 3) egreso(f, r(42000, 76000), "servicios", "Distribuidora de gas", "Gas licuado 45 kg");
      if (rnd() < 0.035) { const [p, de, a, b] = pick(MANTENCION); egreso(f, r(a, b), "mantencion", p, de); }
      if (rnd() < 0.12) { const [p, de, a, b] = pick(OTROS); egreso(f, r(a, b), "otros", p, de, p ? 1 : 0); }
    }
  })();
}
