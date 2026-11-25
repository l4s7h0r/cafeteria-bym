import type { Database } from "bun:sqlite";
import type { Ctx, Route, Tenant } from "../core/types.ts";
import { HttpError } from "../core/router.ts";
import { enabledModules } from "../core/tenancy.ts";
import { ADDON_PRICE, PLANS } from "../core/plans.ts";
import { MODULES, type ModuleId } from "../../shared/modules.ts";

// API de administración interna (montada en /api/admin). La usa el equipo comercial, no la cafetería.

export const ESTADOS = ["activo", "prueba", "suspendido"] as const;
type EstadoCliente = (typeof ESTADOS)[number];
// Cómo queda cada isla para un cliente respecto de su plan
type EstadoModulo = "plan" | "addon" | "bloqueado" | "no";

interface PlanRow { id: string; nombre: string; precio_mensual: number; descripcion: string | null; modulos: string }
interface TenantRow extends Tenant { contacto: string | null; ciudad: string | null; creado_en: string }
interface PlanInfo { id: string; nombre: string; precio_mensual: number; descripcion: string; modulos: ModuleId[] }

const MODULE_IDS = MODULES.map((m) => m.id);
const nombreModulo = (id: ModuleId) => MODULES.find((m) => m.id === id)?.nombre ?? id;
const isModule = (id: string): id is ModuleId => (MODULE_IDS as string[]).includes(id);

function planes(db: Database): PlanInfo[] {
  return (db.query("SELECT * FROM plans ORDER BY precio_mensual").all() as PlanRow[]).map((p) => ({
    id: p.id, nombre: p.nombre, precio_mensual: p.precio_mensual, descripcion: p.descripcion ?? "", modulos: JSON.parse(p.modulos),
  }));
}

function overridesDe(db: Database, tenantId: number) {
  const rows = db.query("SELECT module_id, enabled FROM tenant_modules WHERE tenant_id = ?").all(tenantId) as { module_id: string; enabled: number }[];
  return new Map(rows.filter((r) => isModule(r.module_id)).map((r) => [r.module_id as ModuleId, r.enabled === 1]));
}

// Vista completa de un cliente: módulos, add-ons, bloqueos y lo que paga al mes.
function vistaCliente(db: Database, t: TenantRow, plans: PlanInfo[]) {
  const plan = plans.find((p) => p.id === t.plan_id);
  const enPlan = new Set(plan?.modulos ?? []);
  const ov = overridesDe(db, t.id);
  // Configuración sin considerar el estado del cliente (para mostrar qué tendría al reactivarse)
  const configurados = enabledModules({ ...t, estado: "activo" });
  const efectivos = enabledModules(t);

  const modulos = MODULES.map((m) => {
    const o = ov.get(m.id);
    let estado: EstadoModulo = "no";
    if (enPlan.has(m.id)) estado = o === false ? "bloqueado" : "plan";
    else if (o === true) estado = "addon";
    const encendido = configurados.includes(m.id);
    const faltan = (m.requiere ?? []).filter((r) => !configurados.includes(r));
    return {
      id: m.id, nombre: m.nombre, estado, encendido, efectivo: efectivos.includes(m.id),
      // prendido en la configuración pero apagado por falta de requisitos
      sin_requisitos: (estado === "plan" || estado === "addon") && !encendido ? faltan : [],
      precio_addon: ADDON_PRICE[m.id],
    };
  });

  const addons = modulos.filter((m) => m.estado === "addon").map((m) => m.id);
  const bloqueos = modulos.filter((m) => m.estado === "bloqueado").map((m) => m.id);
  // Solo se cobran los add-ons que realmente quedan encendidos
  const monto_addons = modulos.filter((m) => m.estado === "addon" && m.encendido).reduce((s, m) => s + m.precio_addon, 0);
  const precio_plan = plan?.precio_mensual ?? 0;
  const tarifa = precio_plan + monto_addons;
  return {
    id: t.id, slug: t.slug, nombre: t.nombre, estado: t.estado, contacto: t.contacto, ciudad: t.ciudad, creado_en: t.creado_en,
    plan: plan ? { id: plan.id, nombre: plan.nombre, precio_mensual: plan.precio_mensual } : { id: t.plan_id, nombre: t.plan_id, precio_mensual: 0 },
    modulos, modulos_efectivos: efectivos, addons, bloqueos,
    precio_plan, monto_addons, tarifa,
    // MRR: solo clientes activos pagan (prueba y suspendido no facturan)
    mrr: t.estado === "activo" ? tarifa : 0,
  };
}
export type ClienteAdmin = ReturnType<typeof vistaCliente>;

function cargarCliente(db: Database, slug: string, plans = planes(db)) {
  const t = db.query("SELECT * FROM tenants WHERE slug = ?").get(slug) as TenantRow | null;
  if (!t) throw new HttpError(404, `No existe el cliente "${slug}"`);
  return vistaCliente(db, t, plans);
}

function todos(db: Database) {
  const plans = planes(db);
  const rows = db.query("SELECT * FROM tenants ORDER BY nombre").all() as TenantRow[];
  return rows.map((t) => vistaCliente(db, t, plans));
}

const texto = (v: unknown, campo: string, max = 120) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new HttpError(400, `El campo "${campo}" debe ser texto`);
  const s = v.trim();
  if (s.length > max) throw new HttpError(400, `El campo "${campo}" es demasiado largo (máx. ${max})`);
  return s || null;
};
function validarPlan(db: Database, id: unknown) {
  if (typeof id !== "string" || !db.query("SELECT 1 FROM plans WHERE id = ?").get(id)) throw new HttpError(400, `Plan inválido: "${String(id)}"`);
  return id;
}
function validarEstado(e: unknown): EstadoCliente {
  if (!ESTADOS.includes(e as EstadoCliente)) throw new HttpError(400, `Estado inválido. Usa: ${ESTADOS.join(", ")}`);
  return e as EstadoCliente;
}
async function leerBody(ctx: Ctx): Promise<Record<string, unknown>> {
  try {
    const b = await ctx.body();
    if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch {}
  throw new HttpError(400, "Cuerpo JSON inválido");
}

export const adminRoutes: Route[] = [
  {
    method: "GET", path: "/resumen",
    handler: ({ db }) => {
      const clientes = todos(db);
      const plans = planes(db);
      const por_estado = Object.fromEntries(ESTADOS.map((e) => [e, clientes.filter((c) => c.estado === e).length])) as Record<EstadoCliente, number>;
      const activos = clientes.filter((c) => c.estado === "activo");
      const mrr = activos.reduce((s, c) => s + c.mrr, 0);
      const mrr_addons = activos.reduce((s, c) => s + c.monto_addons, 0);
      // MRR potencial: lo que facturarían los clientes en prueba si se convierten
      const mrr_prueba = clientes.filter((c) => c.estado === "prueba").reduce((s, c) => s + c.tarifa, 0);
      return {
        total_clientes: clientes.length,
        por_estado,
        mrr, mrr_addons, mrr_planes: mrr - mrr_addons, mrr_prueba,
        ticket_promedio: activos.length ? Math.round(mrr / activos.length) : 0,
        por_plan: plans.map((p) => {
          const cs = clientes.filter((c) => c.plan.id === p.id);
          return {
            id: p.id, nombre: p.nombre, precio_mensual: p.precio_mensual,
            clientes: cs.length, activos: cs.filter((c) => c.estado === "activo").length,
            mrr: cs.reduce((s, c) => s + c.mrr, 0),
          };
        }),
        // Adopción: clientes activos que tienen la isla funcionando
        adopcion: MODULES.map((m) => ({
          id: m.id, nombre: m.nombre,
          activos: activos.filter((c) => c.modulos_efectivos.includes(m.id)).length,
          addons: clientes.filter((c) => c.addons.includes(m.id)).length,
          bloqueos: clientes.filter((c) => c.bloqueos.includes(m.id)).length,
          total_activos: activos.length,
        })),
      };
    },
  },
  { method: "GET", path: "/clientes", handler: ({ db }) => todos(db) },
  { method: "GET", path: "/clientes/:slug", handler: ({ db, params }) => cargarCliente(db, params.slug) },
  {
    method: "POST", path: "/clientes",
    handler: async (ctx) => {
      const b = await leerBody(ctx);
      const nombre = texto(b.nombre, "nombre");
      if (!nombre) throw new HttpError(400, "Falta el nombre del cliente");
      const slug = (texto(b.slug, "slug", 40) ?? nombre).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!slug) throw new HttpError(400, "El identificador (slug) no es válido");
      if (ctx.db.query("SELECT 1 FROM tenants WHERE slug = ?").get(slug)) throw new HttpError(409, `Ya existe un cliente con el identificador "${slug}"`);
      const plan = validarPlan(ctx.db, b.plan_id ?? "basico");
      const estado = validarEstado(b.estado ?? "prueba");
      ctx.db.query("INSERT INTO tenants (slug, nombre, plan_id, estado, contacto, ciudad) VALUES (?, ?, ?, ?, ?, ?)")
        .run(slug, nombre, plan, estado, texto(b.contacto, "contacto"), texto(b.ciudad, "ciudad"));
      return new Response(JSON.stringify(cargarCliente(ctx.db, slug)), { status: 201, headers: { "content-type": "application/json; charset=utf-8" } });
    },
  },
  {
    method: "PATCH", path: "/clientes/:slug",
    handler: async (ctx) => {
      const actual = cargarCliente(ctx.db, ctx.params.slug);
      const b = await leerBody(ctx);
      const sets: string[] = [];
      const vals: (string | null)[] = [];
      if ("nombre" in b) {
        const n = texto(b.nombre, "nombre");
        if (!n) throw new HttpError(400, "El nombre no puede quedar vacío");
        sets.push("nombre = ?"), vals.push(n);
      }
      if ("contacto" in b) sets.push("contacto = ?"), vals.push(texto(b.contacto, "contacto"));
      if ("ciudad" in b) sets.push("ciudad = ?"), vals.push(texto(b.ciudad, "ciudad"));
      if ("estado" in b) sets.push("estado = ?"), vals.push(validarEstado(b.estado));
      if ("plan_id" in b) sets.push("plan_id = ?"), vals.push(validarPlan(ctx.db, b.plan_id));
      if (!sets.length) throw new HttpError(400, "No hay cambios que guardar");
      ctx.db.query(`UPDATE tenants SET ${sets.join(", ")} WHERE id = ?`).run(...vals, actual.id);
      // Al cambiar de plan, limpiar ajustes que quedaron redundantes (add-on ya incluido / bloqueo de algo no incluido)
      if ("plan_id" in b) {
        const p = planes(ctx.db).find((x) => x.id === b.plan_id)!;
        for (const [mid, on] of overridesDe(ctx.db, actual.id)) {
          if (on === p.modulos.includes(mid)) ctx.db.query("DELETE FROM tenant_modules WHERE tenant_id = ? AND module_id = ?").run(actual.id, mid);
        }
      }
      return cargarCliente(ctx.db, ctx.params.slug);
    },
  },
  {
    method: "PUT", path: "/clientes/:slug/modulos/:moduleId",
    handler: async (ctx) => {
      const c = cargarCliente(ctx.db, ctx.params.slug);
      const mid = ctx.params.moduleId;
      if (!isModule(mid)) throw new HttpError(404, `No existe la isla "${mid}"`);
      const b = await leerBody(ctx);
      const estado = b.estado;
      if (estado !== "plan" && estado !== "on" && estado !== "off") throw new HttpError(400, 'Estado inválido. Usa "plan", "on" u "off"');
      const info = MODULES.find((m) => m.id === mid)!;
      const enPlan = planes(ctx.db).find((p) => p.id === c.plan.id)?.modulos.includes(mid) ?? false;
      const prendidos = c.modulos.filter((m) => m.encendido).map((m) => m.id);

      // Resultado deseado: ¿queda encendida?
      const quedaOn = estado === "on" || (estado === "plan" && enPlan);
      if (quedaOn) {
        const faltan = (info.requiere ?? []).filter((r) => !prendidos.includes(r));
        if (faltan.length) {
          throw new HttpError(409, `No se puede activar ${info.nombre}: requiere ${faltan.map(nombreModulo).join(" y ")}. ${faltan.length > 1 ? "Actívalos" : "Actívalo"} primero.`);
        }
      }

      const del = () => ctx.db.query("DELETE FROM tenant_modules WHERE tenant_id = ? AND module_id = ?").run(c.id, mid);
      const set = (en: number) => ctx.db.query("INSERT INTO tenant_modules (tenant_id, module_id, enabled) VALUES (?, ?, ?) ON CONFLICT(tenant_id, module_id) DO UPDATE SET enabled = excluded.enabled").run(c.id, mid, en);
      // Solo se guarda un ajuste si difiere de lo que da el plan
      if (estado === "plan" || (estado === "on" && enPlan) || (estado === "off" && !enPlan)) del();
      else set(estado === "on" ? 1 : 0);

      const avisos: string[] = [];
      if (!quedaOn) {
        const dependientes = MODULES.filter((m) => m.requiere?.includes(mid) && prendidos.includes(m.id));
        if (dependientes.length) avisos.push(`También quedan apagadas: ${dependientes.map((m) => m.nombre).join(", ")} (requieren ${info.nombre}).`);
      }
      return { ...cargarCliente(ctx.db, ctx.params.slug), avisos };
    },
  },
  {
    method: "GET", path: "/planes",
    handler: ({ db }) => {
      const clientes = todos(db);
      return {
        planes: planes(db).map((p) => {
          const cs = clientes.filter((c) => c.plan.id === p.id);
          return {
            ...p,
            // datos comerciales extra del catálogo en código (si existen): precio anual, límites, etc.
            ficha: (PLANS.find((x) => x.id === p.id) ?? null) as Record<string, unknown> | null,
            modulos_detalle: MODULES.map((m) => ({ id: m.id, nombre: m.nombre, incluido: p.modulos.includes(m.id) })),
            valor_addons: p.modulos.reduce((s, m) => s + ADDON_PRICE[m], 0),
            clientes: cs.length,
            por_estado: Object.fromEntries(ESTADOS.map((e) => [e, cs.filter((c) => c.estado === e).length])),
            mrr: cs.reduce((s, c) => s + c.mrr, 0),
          };
        }),
        addons: MODULES.map((m) => ({ id: m.id, nombre: m.nombre, descripcion: m.descripcion, requiere: m.requiere ?? [], precio: ADDON_PRICE[m.id] })),
      };
    },
  },
];
