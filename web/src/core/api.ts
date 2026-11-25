import type { Api } from "./types";

// Cliente HTTP. base = "/api/m/<modulo>" o "/api/admin". slug = cliente activo.
export function makeApi(base: string, slug?: string): Api {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(slug ? { "x-tenant": slug } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
    return data;
  };
  return {
    get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), put: (p, b) => call("PUT", p, b),
    patch: (p, b) => call("PATCH", p, b), del: (p) => call("DELETE", p),
  };
}

export const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
