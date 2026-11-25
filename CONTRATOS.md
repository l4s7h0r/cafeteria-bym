# Contratos internos (para quien desarrolle una isla)

- Catálogo de islas: `shared/modules.ts`. Planes: `server/core/plans.ts`.
- Isla servidor: `server/modules/<id>/index.ts` exporta `ServerModule` (ver `server/core/types.ts`).
  - `migrate(db)`: CREATE TABLE IF NOT EXISTS, nombres de tabla con prefijo `<id>_`, siempre con columna `tenant_id`.
  - `seed(db, tenant)`: datos de prueba realistas para cada cliente (~60 días hacia atrás desde hoy). Ojo: se llama para todos los clientes, aunque no tengan el módulo.
  - `routes`: rutas relativas, montadas en `/api/m/<id>`. El handler recibe `ctx` con `tenant`, `db`, `params`, `url`, `body()`. Devuelve objeto (se pasa a JSON) o Response. Filtrar SIEMPRE por `ctx.tenant.id`.
  - El núcleo bloquea con 403 si el plan del cliente no incluye la isla. Una isla nunca importa código de otra isla; si necesita datos de otra, lee sus tablas en modo solo lectura (y documenta la dependencia en `requiere`).
- Isla web: `web/src/modules/<id>/index.tsx` exporta `ClientModule` (ver `web/src/core/types.ts`). La pantalla recibe `api` ya apuntando a `/api/m/<id>` con el cliente activo. Páginas públicas (QR, reservar) via `publicPages`, servidas en `/p/:slug/<path>`; ahí usar `makeApi("/api/m/<id>", slug)`.
- Estilos: clases de `web/src/styles.css` (card, btn, input, chip, grid, kpi, table…). Mobile first. Montos con `clp()` de `web/src/core/api.ts`.
- Textos en español de Chile, sin modismos argentinos.
- Comandos: `bun run seed` (reinicia la DB), `bun server/index.ts` (API :3001), `npx vite` (web :5173), `npx tsc --noEmit -p .`
- Pruebas en paralelo: usar `DB_FILE=/tmp/<tuyo>.db PORT=<tuyo>` para no chocar con otros.
- Web: `PORT=<api> WEB_PORT=<web> npx vite`. Playwright con chromium preinstalado para capturas (deviceScaleFactor 1, viewport 390x844).
