// Registro de islas del servidor. Agregar una isla = agregar su import aquí.
import type { ServerModule } from "../core/types.ts";
import contabilidad from "./contabilidad/index.ts";
import reportes from "./reportes/index.ts";
import reservas from "./reservas/index.ts";
import llamado from "./llamado/index.ts";
import facturas from "./facturas/index.ts";
import plano from "./plano/index.ts";

export const serverModules: ServerModule[] = [contabilidad, reportes, reservas, llamado, facturas, plano]; // plano al final: su seed lee las mesas de reservas y llamado
