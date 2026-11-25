// Registro de islas del lado web. Agregar una isla = agregar su import aquí.
import type { ClientModule } from "../core/types";
import contabilidad from "./contabilidad";
import reportes from "./reportes";
import reservas from "./reservas";
import llamado from "./llamado";
import facturas from "./facturas";

export const clientModules: ClientModule[] = [contabilidad, reportes, reservas, llamado, facturas];
