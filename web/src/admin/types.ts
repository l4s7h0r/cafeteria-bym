import type { ModuleId } from "../../../shared/modules";

export type EstadoCliente = "activo" | "prueba" | "suspendido";
export type EstadoModulo = "plan" | "addon" | "bloqueado" | "no";

export interface ModuloCliente {
  id: ModuleId; nombre: string; estado: EstadoModulo;
  encendido: boolean; efectivo: boolean; sin_requisitos: ModuleId[]; precio_addon: number;
}

export interface Cliente {
  id: number; slug: string; nombre: string; estado: EstadoCliente;
  contacto: string | null; ciudad: string | null; creado_en: string;
  plan: { id: string; nombre: string; precio_mensual: number };
  modulos: ModuloCliente[]; modulos_efectivos: ModuleId[]; addons: ModuleId[]; bloqueos: ModuleId[];
  precio_plan: number; monto_addons: number; tarifa: number; mrr: number;
  avisos?: string[];
}

export interface Resumen {
  total_clientes: number;
  por_estado: Record<EstadoCliente, number>;
  mrr: number; mrr_addons: number; mrr_planes: number; mrr_prueba: number; ticket_promedio: number;
  por_plan: { id: string; nombre: string; precio_mensual: number; clientes: number; activos: number; mrr: number }[];
  adopcion: { id: ModuleId; nombre: string; activos: number; addons: number; bloqueos: number; total_activos: number }[];
}

export interface PlanAdmin {
  id: string; nombre: string; precio_mensual: number; descripcion: string; modulos: ModuleId[];
  ficha: { precio_anual?: number; implementacion?: number; limites?: Record<string, number | null>; locales_incluidos?: number; precio_local_adicional?: number } | null;
  modulos_detalle: { id: ModuleId; nombre: string; incluido: boolean }[];
  valor_addons: number; clientes: number; por_estado: Record<EstadoCliente, number>; mrr: number;
}
export interface Planes {
  planes: PlanAdmin[];
  addons: { id: ModuleId; nombre: string; descripcion: string; requiere: ModuleId[]; precio: number }[];
}

export const ESTADO_LABEL: Record<EstadoCliente, string> = { activo: "Activo", prueba: "En prueba", suspendido: "Suspendido" };
export const ESTADO_CHIP: Record<EstadoCliente, string> = { activo: "chip", prueba: "chip warn", suspendido: "chip bad" };
