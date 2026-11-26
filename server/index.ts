import { handleApi } from "./app.ts";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, normalize } from "node:path";

// Frontend compilado (`bun run build` → dist/). En producción el mismo servidor lo sirve.
const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const HAS_DIST = existsSync(join(DIST, "index.html"));

function serveStatic(path: string): Response {
  const rel = normalize(decodeURIComponent(path)).replace(/^([/\\]|\.\.)+/, "");
  const file = Bun.file(join(DIST, rel));
  if (rel && !rel.endsWith("/") && existsSync(join(DIST, rel)) && file.size > 0) {
    const cache = rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    return new Response(file, { headers: { "cache-control": cache } });
  }
  if (rel.startsWith("assets/")) return new Response("No existe", { status: 404 });
  // Rutas de React Router (/c/..., /p/..., /admin) → index.html
  return new Response(Bun.file(join(DIST, "index.html")), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
}

const PORT = Number(process.env.PORT ?? 3001);

Bun.serve({
  port: PORT,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (!path.startsWith("/api/") && path !== "/health" && HAS_DIST && (req.method === "GET" || req.method === "HEAD")) return serveStatic(path);
    return handleApi(req);
  },
});
console.log(`API en http://localhost:${PORT}${HAS_DIST ? " (sirviendo frontend de dist/)" : ""}`);
