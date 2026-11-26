// Reinicia la base con datos de prueba: `bun run seed`
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
const file = process.env.DB_FILE ?? fileURLToPath(new URL("../data/cafeteria.db", import.meta.url));
for (const suf of ["", "-wal", "-shm"]) rmSync(file + suf, { force: true });

const { db, migrateCore } = await import("./core/db.ts");
const { serverModules } = await import("./modules/index.ts");
const { seedDemo } = await import("./seedData.ts");

migrateCore();
for (const m of serverModules) m.migrate(db);
const r = seedDemo(db);
console.log(`Seed listo: ${r.planes} planes, ${r.clientes} clientes.`);
