import type { Database } from "bun:sqlite";
import type { ModuleId } from "../../shared/modules.ts";

export interface Tenant { id: number; slug: string; nombre: string; plan_id: string; estado: string }

export interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  tenant: Tenant;
  db: Database;
  body: <T = any>() => Promise<T>;
}

export type Handler = (ctx: Ctx) => Response | Promise<Response> | unknown | Promise<unknown>;

export interface Route { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; handler: Handler; public?: boolean }

// Contrato de una isla del lado servidor.
export interface ServerModule {
  id: ModuleId;
  migrate(db: Database): void;                  // CREATE TABLE IF NOT EXISTS ...  (todas las tablas con tenant_id)
  seed?(db: Database, tenant: Tenant): void;    // datos de prueba para un cliente
  routes: Route[];                              // montadas en /api/m/<id><path>; public=true no exige sesión (ej. página QR)
}
