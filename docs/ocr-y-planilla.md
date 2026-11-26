# OCR real y planilla de Google

## 1. OCR con Claude (lectura de fotos y PDF)

La isla de facturas lee el documento con Claude (modelo `claude-opus-5-5`, IA con visión).
Sin la clave, sigue funcionando con la lectura simulada y lo avisa en pantalla.

1. Crea una API key en https://platform.claude.com (sección API Keys) y carga saldo.
2. En Vercel: proyecto `cafeteria-bym` > Settings > Environment Variables:
   - `ANTHROPIC_API_KEY` = la clave.
   - (opcional) `OCR_MODELO` para usar otro modelo.
3. Redeploy.

Costo aproximado: unos US$0,01 (cerca de 10 pesos) por documento.

## 2. Planilla de Google Drive

Cada documento confirmado se agrega como fila en la hoja **Comprobantes** de la planilla
"Cafetería ByM - Comprobantes". El servidor escribe a través de un Apps Script de la misma planilla,
así que no hacen falta cuentas de servicio de Google Cloud.

1. Abre la planilla > Extensiones > Apps Script.
2. Borra lo que aparece y pega el contenido de [`planilla-google.gs`](planilla-google.gs).
   Cambia `TOKEN` por una clave inventada por ti.
3. Implementar > Nueva implementación > tipo **App web**.
   - Ejecutar como: **Yo**. Quién tiene acceso: **Cualquier persona**.
   - Autoriza el acceso cuando Google lo pida (es tu propia cuenta).
4. Copia la URL que termina en `/exec`.
5. En Vercel agrega:
   - `GOOGLE_SHEETS_WEBHOOK_URL` = esa URL.
   - `GOOGLE_SHEETS_TOKEN` = la misma clave del paso 2.
6. Redeploy.

Si la copia a la planilla falla, el documento igual queda guardado en el sistema y la pantalla muestra el motivo.
