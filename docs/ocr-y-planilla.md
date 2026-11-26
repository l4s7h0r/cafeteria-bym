# OCR real y planilla de Google

## 1. OCR con Gemini (lectura de fotos y PDF)

La isla de facturas lee el documento con Gemini (modelo `gemini-3.8-flash`, IA con visión) usando el
**nivel gratuito** de la API de Gemini. Ojo: la suscripción Gemini Pro (Google One) no incluye la API;
la key se saca aparte en Google AI Studio y es gratis dentro de los límites del nivel gratuito.
En el nivel gratuito Google puede usar lo enviado para mejorar sus productos; si eso importa, se activa la facturación.

1. Entra a https://aistudio.google.com con tu cuenta Google > **Get API key** > **Create API key**.
2. En Vercel: proyecto `cafeteria-bym` > Settings > Environment Variables:
   - `GEMINI_API_KEY` = la clave.
   - (opcional) `GEMINI_MODELO` para usar otro modelo, por ejemplo `gemini-3.5-flash-lite`.
3. Redeploy.

Límites del nivel gratuito: se ven en https://aistudio.google.com/rate-limit. Para una cafetería
(decenas de documentos al día) sobra.

Alternativa: si en vez de `GEMINI_API_KEY` se configura `ANTHROPIC_API_KEY`, el OCR usa Claude
(`claude-opus-5-5`, unos US$0,01 por documento). Si están las dos, se usa Gemini.
Sin ninguna, la lectura queda simulada y la pantalla lo avisa.

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
