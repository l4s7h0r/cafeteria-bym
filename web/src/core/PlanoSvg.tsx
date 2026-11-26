import { useEffect, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import type { ElementoPlano, Plano } from "../../../shared/plano";

// Dibujo del plano del local. Es parte del núcleo para que cualquier isla (reservas, llamado, plano)
// lo muestre sin importar código de otra isla. El editor de la isla "plano" lo usa con `onPointerDownEl`.

export type EstadoVisual = "libre" | "reservada" | "ocupada" | "llamando" | "seleccionada" | "aqui" | "no_disponible" | "atenuada";

const COLOR: Record<EstadoVisual, { fill: string; stroke: string; text: string }> = {
  libre: { fill: "#E3F2EA", stroke: "#2D6A4F", text: "#1E2B26" },
  reservada: { fill: "#FFF1DE", stroke: "#F0A04B", text: "#1E2B26" },
  ocupada: { fill: "#D9DED9", stroke: "#5B6660", text: "#1E2B26" },
  llamando: { fill: "#FDECEA", stroke: "#B42318", text: "#B42318" },
  seleccionada: { fill: "#F2B632", stroke: "#1E2B26", text: "#1E2B26" },
  aqui: { fill: "#F2B632", stroke: "#1E2B26", text: "#1E2B26" },
  no_disponible: { fill: "#EEF0ED", stroke: "#C9D3CD", text: "#9AA39E" },
  atenuada: { fill: "#F6F7F5", stroke: "#C9D3CD", text: "#5B6660" },
};

export const LEYENDA: Partial<Record<EstadoVisual, string>> = {
  libre: "Libre", reservada: "Reservada", ocupada: "Ocupada", llamando: "Llamando", seleccionada: "Tu elección", aqui: "Estás aquí", no_disponible: "No disponible",
};

interface Props {
  plano: Plano;
  estados?: Record<string, EstadoVisual>;     // por id de elemento (mesas)
  seleccion?: string | null;                   // id resaltado (editor)
  onTapMesa?: (el: ElementoPlano) => void;
  onPointerDownEl?: (el: ElementoPlano, ev: RPointerEvent<SVGGElement>) => void;
  grilla?: boolean;
  extra?: ReactNode;                           // capas extra (manillas del editor)
  svgRef?: (el: SVGSVGElement | null) => void;
  onPointerDownFondo?: (ev: RPointerEvent<SVGSVGElement>) => void;
  maxAltura?: number;
  editando?: boolean;
}

export default function PlanoSvg({ plano, estados, seleccion, onTapMesa, onPointerDownEl, grilla, extra, svgRef, onPointerDownFondo, maxAltura, editando }: Props) {
  const { ancho, alto } = plano;
  const fondo = [...plano.elementos].sort((a, b) => orden(a) - orden(b));
  return (
    <svg ref={svgRef} viewBox={`0 0 ${ancho} ${alto}`} width="100%" role="img" aria-label="Plano del local"
      style={{ display: "block", maxHeight: maxAltura, background: "#FBFBF8", borderRadius: 12, touchAction: editando ? "none" : undefined, userSelect: "none" }}
      onPointerDown={onPointerDownFondo}>
      {grilla && (
        <g stroke="#E6E9E4" strokeWidth={0.02}>
          {Array.from({ length: Math.floor(ancho) + 1 }, (_, i) => <line key={`v${i}`} x1={i} y1={0} x2={i} y2={alto} />)}
          {Array.from({ length: Math.floor(alto) + 1 }, (_, i) => <line key={`h${i}`} x1={0} y1={i} x2={ancho} y2={i} />)}
        </g>
      )}
      <polygon points={plano.contorno.map((p) => p.join(",")).join(" ")} fill="#FFFFFF" stroke="#1E2B26" strokeWidth={0.14} strokeLinejoin="round" />
      {fondo.map((el) => {
        const est = estados?.[el.id];
        const sel = seleccion === el.id;
        const interactivo = !!onPointerDownEl || (!!onTapMesa && el.tipo === "mesa" && est !== "no_disponible");
        return (
          <g key={el.id} transform={`translate(${el.x} ${el.y}) rotate(${el.rot})`}
            style={{ cursor: interactivo ? "pointer" : undefined }}
            onPointerDown={onPointerDownEl ? (ev) => { ev.stopPropagation(); onPointerDownEl(el, ev); } : undefined}
            onClick={onTapMesa && el.tipo === "mesa" && est !== "no_disponible" ? () => onTapMesa(el) : undefined}>
            <Figura el={el} estado={est} sel={sel} />
          </g>
        );
      })}
      {extra}
    </svg>
  );
}

const orden = (e: ElementoPlano) => (e.tipo === "terraza" ? 0 : e.tipo === "mesa" ? 2 : 1);

function Figura({ el, estado, sel }: { el: ElementoPlano; estado?: EstadoVisual; sel: boolean }) {
  const { w, h } = el;
  const anillo = sel ? <rect x={-w / 2 - 0.15} y={-h / 2 - 0.15} width={w + 0.3} height={h + 0.3} rx={0.12} fill="none" stroke="#F2B632" strokeWidth={0.08} strokeDasharray="0.2 0.12" /> : null;
  const texto = (t: string, size: number, color = "#1E2B26", dy = 0) => (
    <text x={0} y={dy} textAnchor="middle" dominantBaseline="central" fontSize={size} fontWeight={700} fill={color}
      transform={el.rot ? `rotate(${-el.rot})` : undefined} style={{ pointerEvents: "none" }}>{t}</text>
  );
  const fs = Math.max(0.22, Math.min(0.4, Math.min(w, h) * 0.38));
  switch (el.tipo) {
    case "mesa": {
      const c = COLOR[estado ?? "libre"];
      const sillas = sillasDe(el);
      const pulso = estado === "llamando" || estado === "aqui";
      return (
        <>
          {sillas.map(([sx, sy], i) => <circle key={i} cx={sx} cy={sy} r={0.17} fill="#fff" stroke={c.stroke} strokeWidth={0.04} />)}
          {pulso && (el.forma === "redonda"
            ? <circle r={w / 2 + 0.25} fill="none" stroke={c.stroke} strokeWidth={0.06}><animate attributeName="opacity" values="1;0.15;1" dur="1.4s" repeatCount="indefinite" /></circle>
            : <rect x={-w / 2 - 0.25} y={-h / 2 - 0.25} width={w + 0.5} height={h + 0.5} rx={0.2} fill="none" stroke={c.stroke} strokeWidth={0.06}><animate attributeName="opacity" values="1;0.15;1" dur="1.4s" repeatCount="indefinite" /></rect>)}
          {el.forma === "redonda"
            ? <ellipse rx={w / 2} ry={h / 2} fill={c.fill} stroke={c.stroke} strokeWidth={0.07} />
            : <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={0.1} fill={c.fill} stroke={c.stroke} strokeWidth={0.07} />}
          {texto(etiquetaCorta(el.nombre), fs, c.text)}
          {anillo}
        </>
      );
    }
    case "barra": return <>{<rect x={-w / 2} y={-h / 2} width={w} height={h} rx={0.08} fill="#6B4F3A" />}{texto(el.nombre, Math.min(0.36, h * 0.5), "#F5F5F0")}{anillo}</>;
    case "caja": return <>{<rect x={-w / 2} y={-h / 2} width={w} height={h} rx={0.08} fill="#26362F" />}{texto("Caja", Math.min(0.3, h * 0.45), "#F2B632")}{anillo}</>;
    case "cocina": case "bano": return (
      <>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="#EEF0ED" stroke="#9AA39E" strokeWidth={0.05} />
        {texto(el.tipo === "bano" ? "🚻" : "🍳", Math.min(0.55, h * 0.3), "#1E2B26", -Math.min(0.3, h * 0.18))}
        {texto(el.nombre, Math.min(0.3, h * 0.2), "#5B6660", Math.min(0.32, h * 0.2))}
        {anillo}
      </>
    );
    case "puerta": return <>{<rect x={-w / 2} y={-h / 2 - 0.05} width={w} height={h + 0.1} fill="#F2B632" />}{texto(`⬇ ${el.nombre}`, 0.3, "#1E2B26", h / 2 + 0.38)}{anillo}</>;
    case "ventana": return <>{<rect x={-w / 2} y={-h / 2} width={w} height={h} fill="#9CC9E8" stroke="#4B8DB8" strokeWidth={0.03} />}{anillo}</>;
    case "planta": return <>{<circle r={w / 2} fill="#B7DDC4" stroke="#2D6A4F" strokeWidth={0.04} />}{texto("🌿", w * 0.6)}{anillo}</>;
    case "terraza": return (
      <>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={0.2} fill="#F1F7EE" stroke="#8FBF9F" strokeWidth={0.06} strokeDasharray="0.3 0.18" />
        <text x={-w / 2 + 0.25} y={-h / 2 + 0.38} fontSize={0.3} fontWeight={700} fill="#2D6A4F" style={{ pointerEvents: "none" }}>{el.nombre}</text>
        {anillo}
      </>
    );
  }
}

const etiquetaCorta = (n: string) => n.replace(/^Mesa\s+/i, "").replace(/^Terraza\s+/i, "T").replace(/^Barra\s+/i, "B").slice(0, 8);

// Sillas alrededor de la mesa según capacidad
function sillasDe(el: ElementoPlano): [number, number][] {
  const cap = Math.max(1, Math.min(14, el.capacidad ?? 2));
  const { w, h } = el;
  if (el.forma === "redonda") {
    const r = Math.max(w, h) / 2 + 0.2;
    return Array.from({ length: cap }, (_, i) => { const a = (i / cap) * Math.PI * 2 - Math.PI / 2; return [Math.cos(a) * r, Math.sin(a) * r]; });
  }
  // rectangulares: repartir en los lados largos; si sobra, cabeceras
  const out: [number, number][] = [];
  const cabeceras = cap >= 6 && cap % 2 === 0 ? 2 : cap % 2;
  const porLado = Math.ceil((cap - cabeceras) / 2);
  for (const lado of [-1, 1]) {
    const n = lado === -1 ? porLado : cap - cabeceras - porLado;
    for (let i = 0; i < n; i++) out.push([-w / 2 + (w * (i + 0.5)) / n, lado * (h / 2 + 0.2)]);
  }
  if (cabeceras >= 1) out.push([w / 2 + 0.2, 0]);
  if (cabeceras >= 2) out.push([-w / 2 - 0.2, 0]);
  return out;
}

export function Leyenda({ estados }: { estados: EstadoVisual[] }) {
  return (
    <div className="row" style={{ gap: 12, marginTop: 8 }}>
      {estados.map((e) => (
        <span key={e} className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, background: COLOR[e].fill, border: `2px solid ${COLOR[e].stroke}` }} />{LEYENDA[e]}
        </span>
      ))}
    </div>
  );
}

/** Plano público del local (null si el cliente no tiene la isla o no ha dibujado su plano). */
export function usePlanoPublico(slug: string) {
  const [plano, setPlano] = useState<Plano | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch("/api/m/plano/public/plano", { headers: { "x-tenant": slug } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (vivo) setPlano(d?.plano ?? null); }).catch(() => {});
    return () => { vivo = false; };
  }, [slug]);
  return plano;
}
