// Reinicia la base con datos de prueba: `bun run seed`
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
const file = process.env.DB_FILE ?? fileURLToPath(new URL("../data/cafeteria.db", import.meta.url));
for (const suf of ["", "-wal", "-shm"]) rmSync(file + suf, { force: true });

const { db, migrateCore } = await import("./core/db.ts");
const { serverModules } = await import("./modules/index.ts");
const { PLANS } = await import("./core/plans.ts");
type Tenant = import("./core/types.ts").Tenant;

migrateCore();
for (const m of serverModules) m.migrate(db);

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
console.log(`Seed listo: ${PLANS.length} planes, ${tenants.length} clientes.`);
