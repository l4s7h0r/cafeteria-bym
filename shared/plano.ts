// Formato del plano del local (isla "plano"). Compartido por servidor y web.
// Unidades en metros. (x, y) de cada elemento = su centro. rot en grados (0 o 90).

export const TIPOS_ELEMENTO = ["mesa", "barra", "puerta", "ventana", "bano", "cocina", "planta", "terraza", "caja"] as const;
export type TipoElemento = (typeof TIPOS_ELEMENTO)[number];
export const FORMAS_MESA = ["redonda", "cuadrada", "rect"] as const;
export type FormaMesa = (typeof FORMAS_MESA)[number];

export interface ElementoPlano {
  id: string;
  tipo: TipoElemento;
  nombre: string;
  x: number; y: number; w: number; h: number; rot: 0 | 90;
  forma?: FormaMesa;          // sólo mesas
  capacidad?: number;         // sólo mesas
  zona?: string;              // Salón, Terraza, Barra…
  reserva_mesa_id?: number | null; // vínculo con la mesa de la isla reservas
  qr_codigo?: string | null;       // vínculo con el QR de la isla llamado
}

export interface Plano {
  ancho: number; alto: number;          // tamaño del lienzo
  contorno: [number, number][];         // forma del local (polígono)
  elementos: ElementoPlano[];
  actualizado_en?: string | null;
}

export const ETIQUETA_TIPO: Record<TipoElemento, string> = {
  mesa: "Mesa", barra: "Barra", puerta: "Entrada", ventana: "Ventana", bano: "Baño", cocina: "Cocina", planta: "Planta", terraza: "Terraza", caja: "Caja",
};

const num = (v: unknown, min: number, max: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : def;
};
const txt = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Limpia y valida un plano recibido. Lanza Error con un mensaje legible si no sirve. */
export function normalizarPlano(p: any): Plano {
  if (!p || typeof p !== "object") throw new Error("Plano inválido");
  const ancho = num(p.ancho, 3, 60, 14), alto = num(p.alto, 3, 60, 10);
  const contorno = (Array.isArray(p.contorno) ? p.contorno : [])
    .map((pt: any) => [num(pt?.[0], 0, ancho, 0), num(pt?.[1], 0, alto, 0)] as [number, number]);
  if (contorno.length < 3) throw new Error("La forma del local necesita al menos 3 puntos");
  if (contorno.length > 60) throw new Error("La forma del local tiene demasiados puntos");
  const elementos = (Array.isArray(p.elementos) ? p.elementos : []).slice(0, 300).map((e: any, i: number): ElementoPlano => {
    const tipo = (TIPOS_ELEMENTO as readonly string[]).includes(e?.tipo) ? (e.tipo as TipoElemento) : "mesa";
    const el: ElementoPlano = {
      id: txt(e?.id, 40) || `e${i + 1}`, tipo, nombre: txt(e?.nombre, 40) || ETIQUETA_TIPO[tipo],
      x: num(e?.x, 0, ancho, ancho / 2), y: num(e?.y, 0, alto, alto / 2),
      w: num(e?.w, 0.1, 40, 1), h: num(e?.h, 0.1, 40, 1), rot: Number(e?.rot) === 90 ? 90 : 0,
    };
    if (tipo === "mesa") {
      el.forma = (FORMAS_MESA as readonly string[]).includes(e?.forma) ? e.forma : "cuadrada";
      el.capacidad = Math.round(num(e?.capacidad, 1, 30, 4));
      el.zona = txt(e?.zona, 30) || "Salón";
      el.reserva_mesa_id = Number.isInteger(Number(e?.reserva_mesa_id)) && Number(e?.reserva_mesa_id) > 0 ? Number(e.reserva_mesa_id) : null;
      el.qr_codigo = txt(e?.qr_codigo, 40) || null;
    }
    return el;
  });
  const ids = new Set<string>();
  for (const e of elementos) { if (ids.has(e.id)) e.id = `${e.id}-${ids.size}`; ids.add(e.id); }
  return { ancho, alto, contorno, elementos };
}
