// Carga los datos de prueba en una base ya migrada y vacía.
import type { Database } from "bun:sqlite";
import { serverModules } from "./modules/index.ts";
import { PLANS } from "./core/plans.ts";
import type { Tenant } from "./core/types.ts";

export function seedDemo(db: Database) {
  const insPlan = db.query("INSERT INTO plans (id, nombre, precio_mensual, descripcion, modulos) VALUES (?, ?, ?, ?, ?)");
  for (const p of PLANS) insPlan.run(p.id, p.nombre, p.precio_mensual, p.descripcion, JSON.stringify(p.modulos));

  // Clientes de prueba (Papa Kike es el cliente piloto)
  const TENANTS = [
    { slug: "papa-kike", nombre: "Papa Kike", plan: "full", ciudad: "Santiago", contacto: "Enrique" },
    { slug: "cafe-andes", nombre: "Café Los Andes", plan: "pro", ciudad: "Viña del Mar", contacto: "Camila" },
    { slug: "barista-sur", nombre: "Barista del Sur", plan: "basico", ciudad: "Concepción", contacto: "Matías" },
    { slug: "la-tetera", nombre: "La Tetera", plan: "pro", ciudad: "Valparaíso", contacto: "Josefa" },
  ];
  const insT = db.query("INSERT INTO tenants (slug, nombre, plan_id, ciudad, contacto) VALUES (?, ?, ?, ?, ?)");
  for (const t of TENANTS) insT.run(t.slug, t.nombre, t.plan, t.ciudad, t.contacto);
  // Add-on de ejemplo: La Tetera agrega llamado a mesa sobre su plan Pro
  db.run("INSERT INTO tenant_modules (tenant_id, module_id, enabled) SELECT id, 'llamado', 1 FROM tenants WHERE slug = 'la-tetera'");

  const tenants = db.query("SELECT id, slug, nombre, plan_id, estado FROM tenants").all() as Tenant[];
  for (const m of serverModules) for (const t of tenants) m.seed?.(db, t);
  return { planes: PLANS.length, clientes: tenants.length };
}
