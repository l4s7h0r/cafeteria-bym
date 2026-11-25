// Catálogos fijos de la isla contabilidad (medios de pago y categorías de egreso).
export const MEDIOS = ["efectivo", "debito", "credito", "transferencia"] as const;
export type Medio = (typeof MEDIOS)[number];
export const MEDIO_LABEL: Record<Medio, string> = {
  efectivo: "Efectivo", debito: "Débito", credito: "Crédito", transferencia: "Transferencia",
};

export const CATEGORIAS = ["insumos", "sueldos", "arriendo", "servicios", "mantencion", "otros"] as const;
export type Categoria = (typeof CATEGORIAS)[number];
export const CATEGORIA_LABEL: Record<Categoria, string> = {
  insumos: "Insumos", sueldos: "Sueldos", arriendo: "Arriendo", servicios: "Servicios básicos",
  mantencion: "Mantención", otros: "Otros",
};

// Fechas locales en formato YYYY-MM-DD
const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hoy = () => ymd(new Date());
export const esFecha = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
export function inicioMes(d = new Date()) { return ymd(new Date(d.getFullYear(), d.getMonth(), 1)); }
