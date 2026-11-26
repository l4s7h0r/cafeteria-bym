import Anthropic from "@anthropic-ai/sdk";

// OCR real de documentos de gasto con Claude (visión). Lee fotos (JPG, PNG, WEBP, GIF) y PDF.
// Se activa con la variable de entorno ANTHROPIC_API_KEY. Sin ella, la isla sigue usando la lectura simulada.
// Modelo configurable con OCR_MODELO (por defecto claude-opus-5-5).

export const OCR_DISPONIBLE = () => !!process.env.ANTHROPIC_API_KEY;
const MODELO = () => process.env.OCR_MODELO || "claude-opus-5-5";

export interface LecturaOcr {
  legible: boolean;
  observacion: string;
  tipo_doc: "factura" | "boleta" | "otro";
  categoria_egreso: "insumos" | "sueldos" | "arriendo" | "servicios" | "mantencion" | "otros";
  proveedor: string; rut: string; giro: string; folio: string; fecha: string; categoria: string;
  neto: number; iva: number; total: number; condicion_pago: string;
  lineas: { producto: string; cantidad: number; unidad: string; precio_unitario: number; total: number }[];
  confianza: number;
}

const str = { type: "string" } as const;
const num = { type: "number" } as const;
const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["legible", "observacion", "tipo_doc", "categoria_egreso", "proveedor", "rut", "giro", "folio", "fecha", "categoria",
    "neto", "iva", "total", "condicion_pago", "lineas", "confianza"],
  properties: {
    legible: { type: "boolean" },
    observacion: str,
    tipo_doc: { type: "string", enum: ["factura", "boleta", "otro"] },
    categoria_egreso: { type: "string", enum: ["insumos", "sueldos", "arriendo", "servicios", "mantencion", "otros"] },
    proveedor: str, rut: str, giro: str, folio: str, fecha: str, categoria: str,
    neto: num, iva: num, total: num, condicion_pago: str,
    lineas: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["producto", "cantidad", "unidad", "precio_unitario", "total"],
        properties: { producto: str, cantidad: num, unidad: str, precio_unitario: num, total: num },
      },
    },
    confianza: num,
  },
};

const INSTRUCCIONES = `Eres el lector de documentos de gasto de una cafetería en Chile. Recibes la foto o el PDF de una factura,
una boleta o un comprobante (recibo, vale, guía, cuenta de luz/agua/gas, etc.) y devuelves sus datos en JSON según el esquema.

Reglas:
- Montos en pesos chilenos como números enteros, sin puntos de miles ni signo $ (ej. "$12.990" → 12990).
- fecha en formato YYYY-MM-DD (en Chile se escribe día-mes-año). Si no aparece, deja "".
- rut con puntos y guion, ej. "76.123.456-7". Si no aparece, "".
- tipo_doc: "factura" si dice FACTURA ELECTRÓNICA (trae neto + IVA); "boleta" si es boleta o ticket de caja; "otro" para el resto.
- Factura: neto, iva (19%) y total como vienen impresos. Boleta u otro: neto = total, iva = 0.
- categoria_egreso: insumos (comida, bebidas, café, envases, productos para vender), servicios (luz, agua, gas, internet, teléfono),
  mantencion (ferretería, aseo, reparaciones), arriendo, sueldos, otros.
- categoria: rubro corto del proveedor, ej. "Lácteos", "Café", "Ferretería", "Supermercado".
- lineas: una por producto con cantidad, unidad (kg, litro, unidad, caja, servicio…), precio_unitario y total de la línea.
  En facturas los precios de línea van sin IVA. Si el detalle no se lee, deja la lista vacía.
- condicion_pago: "Contado", "30 días", etc. Si no aparece, "Contado".
- No inventes datos: lo que no se lee queda "" o 0. confianza entre 0 y 1 según qué tan nítido y completo está.
- Si la imagen no es un documento de gasto o no se puede leer, legible = false y explica por qué en observacion (en español).`;

const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type TipoImagen = (typeof TIPOS_IMAGEN)[number];

export function tipoArchivoSoportado(mime: string) {
  return mime === "application/pdf" || (TIPOS_IMAGEN as readonly string[]).includes(mime);
}

export class ErrorOcr extends Error {}

export async function leerConClaude(bytes: ArrayBuffer, mime: string, pista?: string): Promise<LecturaOcr> {
  if (!tipoArchivoSoportado(mime)) throw new ErrorOcr("Formato no soportado: sube una foto (JPG o PNG) o un PDF");
  const data = Buffer.from(bytes).toString("base64");
  const documento: Anthropic.Beta.BetaContentBlockParam = mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: mime as TipoImagen, data } };

  const client = new Anthropic({ timeout: 55_000, maxRetries: 1 });
  let r: Anthropic.Beta.BetaMessage;
  try {
    r = await client.beta.messages.create({
      model: MODELO(),
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: INSTRUCCIONES,
      output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMA } },
      messages: [{
        role: "user",
        content: [documento, { type: "text", text: pista ? `El usuario indica que es: ${pista}. Lee el documento.` : "Lee el documento." }],
      }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new ErrorOcr("La API key de Anthropic no es válida (revisa ANTHROPIC_API_KEY)");
    if (e instanceof Anthropic.RateLimitError) throw new ErrorOcr("El lector está saturado, intenta de nuevo en un minuto");
    if (e instanceof Anthropic.BadRequestError) throw new ErrorOcr(`No se pudo leer el archivo: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new ErrorOcr(`Error del lector (${e.status ?? "red"}), intenta de nuevo`);
    throw e;
  }
  if (r.stop_reason === "refusal") throw new ErrorOcr("El lector no pudo procesar este archivo");
  const texto = r.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "";
  try {
    return JSON.parse(texto) as LecturaOcr;
  } catch {
    throw new ErrorOcr("El lector devolvió una respuesta incompleta, intenta de nuevo");
  }
}
