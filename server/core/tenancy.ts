import { db } from "./db.ts";
import { MODULES, type ModuleId } from "../../shared/modules.ts";
import type { Tenant } from "./types.ts";

export function getTenantBySlug(slug: string): Tenant | null {
  return db.query("SELECT id, slug, nombre, plan_id, estado FROM tenants WHERE slug = ?").get(slug) as Tenant | null;
}

// Módulos efectivos = módulos del plan + add-ons - bloqueos (y solo si el cliente está activo)
export function enabledModules(tenant: Tenant): ModuleId[] {
  if (tenant.estado !== "activo") return [];
  const plan = db.query("SELECT modulos FROM plans WHERE id = ?").get(tenant.plan_id) as { modulos: string } | null;
  const set = new Set<ModuleId>(plan ? JSON.parse(plan.modulos) : []);
  const overrides = db.query("SELECT module_id, enabled FROM tenant_modules WHERE tenant_id = ?").all(tenant.id) as { module_id: ModuleId; enabled: number }[];
  for (const o of overrides) o.enabled ? set.add(o.module_id) : set.delete(o.module_id);
  // una isla sin sus dependencias queda apagada
  for (const m of MODULES) if (set.has(m.id) && m.requiere?.some((r) => !set.has(r))) set.delete(m.id);
  return MODULES.map((m) => m.id).filter((id) => set.has(id));
}
