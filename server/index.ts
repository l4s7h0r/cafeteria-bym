import { migrateCore } from "./core/db.ts";
import { serverModules } from "./modules/index.ts";
import { adminRoutes } from "./admin/index.ts";
import { compile, match, run, json, error } from "./core/router.ts";
import { enabledModules, getTenantBySlug } from "./core/tenancy.ts";
import { MODULES } from "../shared/modules.ts";
import { db } from "./core/db.ts";

migrateCore();
for (const m of serverModules) m.migrate(db);

const moduleRoutes = serverModules.flatMap((m) => m.routes.map((r) => ({ moduleId: m.id, ...compile(`/api/m/${m.id}`, r) })));
const admin = adminRoutes.map((r) => compile("/api/admin", r));

const PORT = Number(process.env.PORT ?? 3001);

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Catálogo y sesión del cliente (el cliente activo viaja en el header x-tenant o ?t=slug)
    const slug = req.headers.get("x-tenant") ?? url.searchParams.get("t");
    const tenant = slug ? getTenantBySlug(slug) : null;

    if (path === "/api/catalogo") return json(MODULES);
    if (path === "/api/tenants") return json(db.query("SELECT slug, nombre FROM tenants ORDER BY nombre").all());
    if (path === "/api/me") {
      if (!tenant) return error(404, "Cliente no encontrado");
      return json({ tenant, modulos: enabledModules(tenant) });
    }

    if (path.startsWith("/api/admin")) {
      const hit = match(admin, req.method, path);
      return hit ? run(hit.route, hit.params, req, url, null) : error(404, "No existe");
    }

    if (path.startsWith("/api/m/")) {
      const hit = match(moduleRoutes, req.method, path);
      if (!hit) return error(404, "No existe");
      if (!tenant) return error(400, "Falta cliente (x-tenant)");
      // Guardia de islas: si el plan del cliente no incluye el módulo, no pasa.
      const moduleId = (hit.route as any).moduleId;
      if (!enabledModules(tenant).includes(moduleId)) return error(403, `El plan de ${tenant.nombre} no incluye el módulo "${moduleId}"`);
      return run(hit.route, hit.params, req, url, tenant);
    }

    return error(404, "No existe");
  },
});
console.log(`API en http://localhost:${PORT}`);
