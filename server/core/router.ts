import { db } from "./db.ts";
import type { Ctx, Route, Tenant } from "./types.ts";

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
export const error = (status: number, mensaje: string) => json({ error: mensaje }, status);

// Compila "/mesas/:id" a regex con params
export function compile(prefix: string, r: Route) {
  const keys: string[] = [];
  const pattern = (prefix + r.path).replace(/\/$/, "").replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)"));
  return { ...r, regex: new RegExp(`^${pattern}/?$`), keys };
}
export type Compiled = ReturnType<typeof compile>;

export function match(routes: Compiled[], method: string, path: string) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.regex);
    if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export async function run(r: Compiled, params: Record<string, string>, req: Request, url: URL, tenant: Tenant | null) {
  const ctx: Ctx = { req, url, params, tenant: tenant as Tenant, db, body: async () => req.json() };
  try {
    const out = await r.handler(ctx);
    return out instanceof Response ? out : json(out ?? { ok: true });
  } catch (e: any) {
    console.error(e);
    return error(e?.status ?? 500, e?.message ?? "Error interno");
  }
}

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
