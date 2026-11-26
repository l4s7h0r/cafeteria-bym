// Función de Vercel (runtime Bun). Vercel reescribe /api/* y /health hacia acá.
// El disco de Vercel es de solo lectura salvo /tmp: la base vive ahí y se siembra
// con los datos de prueba en cada arranque en frío. Es una demo: los cambios no son permanentes.
process.env.DB_FILE ??= "/tmp/cafeteria.db";

const { db } = await import("../server/core/db.ts");
const { handleApi } = await import("../server/app.ts");
const { seedDemo } = await import("../server/seedData.ts");

const { n } = db.query("SELECT COUNT(*) AS n FROM tenants").get() as { n: number };
if (n === 0) seedDemo(db);

export default {
  fetch(req: Request) {
    return handleApi(req);
  },
};
