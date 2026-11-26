// Apps Script para la planilla "Cafetería ByM - Comprobantes".
// Pegar en la planilla: Extensiones > Apps Script. Luego Implementar > Nueva implementación > App web,
// "Ejecutar como: Yo" y "Quién tiene acceso: Cualquier persona". La URL que termina en /exec va en
// GOOGLE_SHEETS_WEBHOOK_URL (Vercel). Cambia TOKEN por una clave tuya y ponla también en GOOGLE_SHEETS_TOKEN.
const TOKEN = "cambia-esta-clave";
const HOJA = "Comprobantes";
const COLUMNAS = ["Registrado", "ID", "Cliente", "Tipo", "Fecha documento", "Proveedor o comercio", "RUT", "Folio",
  "Tipo de gasto", "Rubro", "Neto", "IVA", "Total", "Estado", "Condición de pago", "Detalle", "Leído por", "Confianza", "Archivo"];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (TOKEN && body.token !== TOKEN) return json_({ ok: false, error: "token inválido" });
    const f = body.fila || {};
    const libro = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = libro.getSheetByName(HOJA) || libro.insertSheet(HOJA);
    if (hoja.getLastRow() === 0) hoja.appendRow(COLUMNAS);
    hoja.appendRow([new Date(), f.id, f.cliente, f.tipo, f.fecha, f.proveedor, f.rut, f.folio, f.categoria_egreso, f.categoria,
      f.neto, f.iva, f.total, f.estado, f.condicion_pago, f.detalle, ({ gemini: "Gemini (OCR)", claude: "Claude (OCR)" })[f.motor] || f.motor,
      f.confianza, f.archivo]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
