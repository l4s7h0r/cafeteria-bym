import type { ComponentType } from "react";
import type { ModuleId } from "../../../shared/modules";

export interface TenantInfo { id: number; slug: string; nombre: string; plan_id: string; estado: string }

export interface ModuleProps { tenant: TenantInfo; api: Api }

// Contrato de una isla del lado web.
export interface ClientModule {
  id: ModuleId;
  label: string;          // texto del menú
  icon: string;           // emoji corto
  Component: ComponentType<ModuleProps>;          // pantalla interna en /c/:slug/m/<id>
  publicPages?: { path: string; Component: ComponentType<{ slug: string; params: Record<string, string> }> }[];
  // páginas públicas en /p/:slug/<path> (ej. "mesa/:mesa" para el QR, "reservar")
}

export interface Api {
  get<T = any>(path: string): Promise<T>;
  post<T = any>(path: string, body?: unknown): Promise<T>;
  put<T = any>(path: string, body?: unknown): Promise<T>;
  patch<T = any>(path: string, body?: unknown): Promise<T>;
  del<T = any>(path: string): Promise<T>;
}
