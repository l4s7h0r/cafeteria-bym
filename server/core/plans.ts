import type { ModuleId } from "../../shared/modules.ts";

// Planes comerciales (precios referenciales en CLP, IVA no incluido). Ver docs/planes.md

/** Límites por plan. `null` = sin límite. Para el plan Cadena los límites son por local. */
export interface PlanLimites {
  usuarios: number | null;
  mesas: number | null;
  locales: number | null;
  facturas_mes: number | null; // facturas escaneadas al mes (0 = isla no incluida)
}

export interface Plan {
  id: string;
  nombre: string;
  precio_mensual: number;
  descripcion: string;
  modulos: ModuleId[];
  precio_anual?: number;          // pago anual adelantado (equivale a 2 meses gratis)
  limites?: PlanLimites;
  locales_incluidos?: number;     // locales cubiertos por precio_mensual
  precio_local_adicional?: number; // por cada local extra al mes
  implementacion?: number;        // pago único de puesta en marcha (0 = autoservicio)
}

/** Pago anual = 10 meses (≈17% de descuento). */
export const DESCUENTO_ANUAL_MESES = 2;
const anual = (mensual: number) => mensual * (12 - DESCUENTO_ANUAL_MESES);

/** Prueba gratis: días con todas las islas del plan "full", sin tarjeta. */
export const TRIAL_DIAS = 14;

export const PLANS: Plan[] = [
  {
    id: "basico", nombre: "Emprende", precio_mensual: 14990, precio_anual: anual(14990),
    descripcion: "Caja, propinas y reportes para el café que parte.",
    modulos: ["contabilidad", "reportes"],
    limites: { usuarios: 2, mesas: 10, locales: 1, facturas_mes: 0 },
    implementacion: 0,
  },
  {
    id: "pro", nombre: "Local", precio_mensual: 29990, precio_anual: anual(29990),
    descripcion: "Contabilidad, reportes y reservas de mesa con sitio público.",
    modulos: ["contabilidad", "reportes", "reservas"],
    limites: { usuarios: 6, mesas: 30, locales: 1, facturas_mes: 0 },
    implementacion: 0,
  },
  {
    id: "full", nombre: "Pro", precio_mensual: 49990, precio_anual: anual(49990),
    descripcion: "Todas las islas: suma llamado a mesa por QR y escaneo de facturas.",
    modulos: ["contabilidad", "reportes", "reservas", "llamado", "facturas"],
    limites: { usuarios: 15, mesas: 60, locales: 1, facturas_mes: 150 },
    implementacion: 49990,
  },
  {
    id: "cadena", nombre: "Cadena", precio_mensual: 99990, precio_anual: anual(99990),
    descripcion: "Todas las islas para 2 locales o más, con reportes consolidados.",
    modulos: ["contabilidad", "reportes", "reservas", "llamado", "facturas"],
    limites: { usuarios: null, mesas: 60, locales: null, facturas_mes: 200 },
    locales_incluidos: 2, precio_local_adicional: 39990,
    implementacion: 89990,
  },
];

// Precio mensual de cada isla como add-on suelto (sobre cualquier plan).
// contabilidad = 0 porque viene incluida en todos los planes.
export const ADDON_PRICE: Record<ModuleId, number> = {
  contabilidad: 0, reportes: 5990, reservas: 14990, llamado: 9990, facturas: 19990,
};
