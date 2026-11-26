import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath: en Windows `.pathname` deja "/C:/..." y SQLite no encuentra la ruta.
export const DB_FILE = process.env.DB_FILE ?? fileURLToPath(new URL("../../data/cafeteria.db", import.meta.url));
mkdirSync(dirname(DB_FILE), { recursive: true });
export const db = new Database(DB_FILE, { create: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

// Tablas del núcleo. Cada isla crea sus propias tablas en su migrate().
export function migrateCore() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY, nombre TEXT NOT NULL, precio_mensual INTEGER NOT NULL,
      descripcion TEXT, modulos TEXT NOT NULL  -- JSON array de ModuleId
    );
    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, nombre TEXT NOT NULL,
      plan_id TEXT NOT NULL REFERENCES plans(id), estado TEXT NOT NULL DEFAULT 'activo',
      contacto TEXT, ciudad TEXT, creado_en TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Ajustes por cliente sobre su plan: add-on (enabled=1) o bloqueo (enabled=0)
    CREATE TABLE IF NOT EXISTS tenant_modules (
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      module_id TEXT NOT NULL, enabled INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, module_id)
    );
  `);
}
