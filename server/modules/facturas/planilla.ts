// Copia cada comprobante confirmado como una fila en una planilla de Google Sheets.
// Se hace a través de un Apps Script publicado como "app web" en la misma planilla (docs/planilla-google.md):
// así no hacen falta cuentas de servicio ni claves de Google en el servidor.
// Variables: GOOGLE_SHEETS_WEBHOOK_URL (URL /exec del script) y GOOGLE_SHEETS_TOKEN (clave compartida, opcional).

export interface FilaPlanilla {
  id: number; cliente: string; tipo: string; fecha: string; proveedor: string; rut: string; folio: string;
  categoria_egreso: string; categoria: string; neto: number; iva: number; total: number; estado: string;
  condicion_pago: string; detalle: string; motor: string; confianza: number | null; archivo: string | null;
}

export type ResultadoPlanilla = { ok: true } | { ok: false; motivo: string };

export const PLANILLA_CONFIGURADA = () => !!process.env.GOOGLE_SHEETS_WEBHOOK_URL;

export async function enviarAPlanilla(fila: FilaPlanilla): Promise<ResultadoPlanilla> {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  if (!url) return { ok: false, motivo: "planilla de Google no configurada" };
  try {
    // Apps Script responde con una redirección (302) a la respuesta final; fetch la sigue sola.
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token: process.env.GOOGLE_SHEETS_TOKEN ?? "", fila }),
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const txt = await res.text();
    if (!res.ok) return { ok: false, motivo: `Google respondió ${res.status}` };
    try {
      const j = JSON.parse(txt);
      return j.ok ? { ok: true } : { ok: false, motivo: String(j.error ?? "error en el script") };
    } catch {
      return { ok: false, motivo: "el script no devolvió JSON (¿está publicado con acceso para cualquier persona?)" };
    }
  } catch (e: any) {
    return { ok: false, motivo: e?.name === "TimeoutError" ? "Google no respondió a tiempo" : "no se pudo conectar con Google" };
  }
}
