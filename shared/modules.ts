// Catálogo de "islas" (módulos). Fuente única compartida por servidor y web.
export type ModuleId =
  | "contabilidad"   // ingresos, egresos, propinas
  | "reportes"       // reportes diarios, semanales, mensuales
  | "reservas"       // reserva de mesas
  | "llamado"        // llamado a la mesa por web / QR
  | "facturas"       // escaneo de facturas y boletas + automatización de productos
  | "plano";         // plano del local: forma y ubicación real de las mesas

export interface ModuleInfo {
  id: ModuleId;
  nombre: string;
  descripcion: string;
  requiere?: ModuleId[]; // dependencias entre islas
}

export const MODULES: ModuleInfo[] = [
  { id: "contabilidad", nombre: "Contabilidad", descripcion: "Ingresos, egresos y propinas del local." },
  { id: "reportes", nombre: "Reportes", descripcion: "Resumen diario, semanal y mensual.", requiere: ["contabilidad"] },
  { id: "reservas", nombre: "Reservas", descripcion: "Reserva de mesas desde un sitio público." },
  { id: "llamado", nombre: "Llamado a mesa", descripcion: "El cliente llama al garzón escaneando el QR de su mesa." },
  { id: "facturas", nombre: "Facturas y productos", descripcion: "Escaneo de facturas, boletas y otros comprobantes de gasto como egresos, con actualización automática de productos y costos.", requiere: ["contabilidad"] },
  { id: "plano", nombre: "Plano del local", descripcion: "El dueño dibuja su local y ubica las mesas como son en realidad. El cliente elige mesa al reservar y ve dónde está al escanear el QR." },
];
