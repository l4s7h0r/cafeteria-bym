import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientModule, ModuleProps } from "../../core/types";
import PlanoSvg, { Leyenda, type EstadoVisual } from "../../core/PlanoSvg";
import { ETIQUETA_TIPO, type ElementoPlano, type FormaMesa, type Plano, type TipoElemento } from "../../../../shared/plano";

// Isla "plano": editor visual del local (forma + mesas + elementos) y vista en vivo del estado de cada mesa.

interface Vinculables { reservas: { id: number; nombre: string; capacidad: number; zona: string }[]; llamado: { codigo: string; nombre: string; zona: string }[] }
interface Vivo { estados: Record<string, { estado: "libre" | "reservada" | "ocupada" | "llamando"; detalle: string[] }> }

const SNAP = 0.1;
const snap = (n: number, paso = SNAP) => Math.round(n / paso) * paso;
const r2 = (n: number) => Math.round(n * 100) / 100;
const nuevoId = () => `e${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

// Plantillas para agregar elementos
const PALETA: { etiqueta: string; crear: () => Omit<ElementoPlano, "id" | "x" | "y"> }[] = [
  { etiqueta: "⚪ Mesa redonda", crear: () => ({ tipo: "mesa", forma: "redonda", nombre: "", w: 0.8, h: 0.8, rot: 0, capacidad: 2, zona: "Salón" }) },
  { etiqueta: "⬜ Mesa cuadrada", crear: () => ({ tipo: "mesa", forma: "cuadrada", nombre: "", w: 1, h: 1, rot: 0, capacidad: 4, zona: "Salón" }) },
  { etiqueta: "▭ Mesa larga", crear: () => ({ tipo: "mesa", forma: "rect", nombre: "", w: 1.8, h: 0.9, rot: 0, capacidad: 6, zona: "Salón" }) },
  { etiqueta: "Barra", crear: () => ({ tipo: "barra", nombre: "Barra", w: 3, h: 0.8, rot: 0 }) },
  { etiqueta: "Caja", crear: () => ({ tipo: "caja", nombre: "Caja", w: 1.2, h: 0.8, rot: 0 }) },
  { etiqueta: "Entrada", crear: () => ({ tipo: "puerta", nombre: "Entrada", w: 1.4, h: 0.25, rot: 0 }) },
  { etiqueta: "Ventana", crear: () => ({ tipo: "ventana", nombre: "Ventana", w: 2, h: 0.15, rot: 0 }) },
  { etiqueta: "Baño", crear: () => ({ tipo: "bano", nombre: "Baño", w: 1.6, h: 1.8, rot: 0 }) },
  { etiqueta: "Cocina", crear: () => ({ tipo: "cocina", nombre: "Cocina", w: 3, h: 2.2, rot: 0 }) },
  { etiqueta: "Planta", crear: () => ({ tipo: "planta", nombre: "Planta", w: 0.6, h: 0.6, rot: 0 }) },
  { etiqueta: "Zona terraza", crear: () => ({ tipo: "terraza", nombre: "Terraza", w: 6, h: 2.5, rot: 0 }) },
];

const FORMAS: { nombre: string; puntos: (a: number, h: number) => [number, number][] }[] = [
  { nombre: "Rectángulo", puntos: (a, h) => [[1, 1], [a - 1, 1], [a - 1, h - 1], [1, h - 1]] },
  { nombre: "En L", puntos: (a, h) => [[1, 1], [a * 0.6, 1], [a * 0.6, h * 0.45], [a - 1, h * 0.45], [a - 1, h - 1], [1, h - 1]] },
  { nombre: "En U", puntos: (a, h) => [[1, 1], [a * 0.35, 1], [a * 0.35, h * 0.5], [a * 0.65, h * 0.5], [a * 0.65, 1], [a - 1, 1], [a - 1, h - 1], [1, h - 1]] },
  { nombre: "Esquina", puntos: (a, h) => [[1, 1], [a - 1, 1], [a - 1, h - 1], [a * 0.35, h - 1], [1, h * 0.6]] },
];

function Pantalla({ api, tenant }: ModuleProps) {
  const [vista, setVista] = useState<"editor" | "vivo">("editor");
  const [plano, setPlano] = useState<Plano | null>(null);
  const [guardado, setGuardado] = useState<Plano | null>(null);
  const [vinc, setVinc] = useState<Vinculables>({ reservas: [], llamado: [] });
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const cargar = useCallback(() => {
    api.get<{ plano: Plano; vinculables: Vinculables }>("/plano").then((d) => { setPlano(d.plano); setGuardado(d.plano); setVinc(d.vinculables); }).catch((e) => setErr(e.message));
  }, [api]);
  useEffect(() => { cargar(); }, [cargar]);

  const sucio = !!plano && JSON.stringify(plano) !== JSON.stringify(guardado);
  const guardar = async () => {
    if (!plano) return;
    setErr(""); setMsg("");
    try { const r = await api.put<{ plano: Plano }>("/plano", plano); setPlano(r.plano); setGuardado(r.plano); setMsg("Plano guardado. Ya se ve en la página de reservas y en el QR de cada mesa."); }
    catch (e: any) { setErr(e.message); }
  };

  if (!plano) return <p className="muted">{err || "Cargando plano…"}</p>;
  const mesas = plano.elementos.filter((e) => e.tipo === "mesa");

  return (
    <div className="stack">
      <div className="grid">
        <div className="card"><p className="muted">Mesas en el plano</p><p className="kpi">{mesas.length}</p><p className="muted">{mesas.reduce((a, m) => a + (m.capacidad ?? 0), 0)} puestos</p></div>
        <div className="card"><p className="muted">Vinculadas a reservas</p><p className="kpi">{mesas.filter((m) => m.reserva_mesa_id).length}</p><p className="muted">el cliente puede elegirlas al reservar</p></div>
        <div className="card"><p className="muted">Con QR de llamado</p><p className="kpi">{mesas.filter((m) => m.qr_codigo).length}</p><p className="muted">muestran "estás aquí" al escanear</p></div>
      </div>
      <div className="row">
        <button className={vista === "editor" ? "btn alt" : "btn ghost"} onClick={() => setVista("editor")}>✏️ Editar plano</button>
        <button className={vista === "vivo" ? "btn alt" : "btn ghost"} onClick={() => setVista("vivo")}>● Mesas en vivo</button>
        <a className="btn ghost" style={{ textDecoration: "none" }} href={`/p/${tenant.slug}/reservar`} target="_blank" rel="noreferrer">Ver como cliente ↗</a>
      </div>
      {vista === "editor"
        ? <Editor plano={plano} setPlano={setPlano} vinc={vinc} sucio={sucio} guardar={guardar} descartar={() => setPlano(guardado)} err={err} msg={msg}
            sugerir={async () => { try { setPlano(await api.get<Plano>("/sugerido")); setMsg("Propuesta armada con tus mesas de reservas y QR. Revísala y guarda."); } catch (e: any) { setErr(e.message); } }} />
        : <EnVivo api={api} plano={guardado ?? plano} />}
    </div>
  );
}

// ---------------- Editor ----------------
type Arrastre = { tipo: "el"; id: string; dx: number; dy: number } | { tipo: "punto"; i: number } | null;

function Editor({ plano, setPlano, vinc, sucio, guardar, descartar, sugerir, err, msg }: {
  plano: Plano; setPlano: (p: Plano) => void; vinc: Vinculables; sucio: boolean; guardar: () => void; descartar: () => void; sugerir: () => void; err: string; msg: string;
}) {
  const [modo, setModo] = useState<"elementos" | "forma">("elementos");
  const [sel, setSel] = useState<string | null>(null);
  const [punto, setPunto] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const arrastre = useRef<Arrastre>(null);
  const planoRef = useRef(plano);
  planoRef.current = plano;

  const aSvg = (ev: { clientX: number; clientY: number }) => {
    const s = svg.current; const m = s?.getScreenCTM();
    if (!s || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  useEffect(() => {
    const mover = (ev: PointerEvent) => {
      const a = arrastre.current; if (!a) return;
      const p = planoRef.current; const { x, y } = aSvg(ev);
      if (a.tipo === "el") {
        setPlano({ ...p, elementos: p.elementos.map((e) => e.id === a.id ? { ...e, x: r2(Math.min(p.ancho, Math.max(0, snap(x - a.dx)))), y: r2(Math.min(p.alto, Math.max(0, snap(y - a.dy)))) } : e) });
      } else {
        setPlano({ ...p, contorno: p.contorno.map((pt, i) => i === a.i ? [r2(Math.min(p.ancho, Math.max(0, snap(x, 0.25)))), r2(Math.min(p.alto, Math.max(0, snap(y, 0.25))))] : pt) });
      }
    };
    const soltar = () => { arrastre.current = null; };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);
    return () => { window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); window.removeEventListener("pointercancel", soltar); };
  }, [setPlano]);

  const elSel = plano.elementos.find((e) => e.id === sel) ?? null;
  const cambiar = (id: string, cambios: Partial<ElementoPlano>) => setPlano({ ...plano, elementos: plano.elementos.map((e) => (e.id === id ? { ...e, ...cambios } : e)) });

  const agregar = (t: (typeof PALETA)[number]) => {
    const base = t.crear();
    const n = plano.elementos.filter((e) => e.tipo === "mesa").length + 1;
    const nombre = base.tipo === "mesa" ? `Mesa ${n}` : base.nombre;
    const el = { ...base, nombre, id: nuevoId(), x: r2(snap(plano.ancho / 2)), y: r2(snap(plano.alto / 2)) } as ElementoPlano;
    setPlano({ ...plano, elementos: [...plano.elementos, el] });
    setSel(el.id);
  };

  // Manillas para editar la forma del local
  const manillas = modo === "forma" ? (
    <g>
      {plano.contorno.map((pt, i) => {
        const sig = plano.contorno[(i + 1) % plano.contorno.length];
        const mx = (pt[0] + sig[0]) / 2, my = (pt[1] + sig[1]) / 2;
        return (
          <g key={`m${i}`} style={{ cursor: "copy" }} onPointerDown={(ev) => {
            ev.stopPropagation();
            const c = [...plano.contorno]; c.splice(i + 1, 0, [r2(snap(mx, 0.25)), r2(snap(my, 0.25))]);
            setPlano({ ...plano, contorno: c }); setPunto(i + 1); arrastre.current = { tipo: "punto", i: i + 1 };
          }}>
            <circle cx={mx} cy={my} r={0.26} fill="#fff" stroke="#2D6A4F" strokeWidth={0.05} />
            <text x={mx} y={my} textAnchor="middle" dominantBaseline="central" fontSize={0.36} fontWeight={800} fill="#2D6A4F" style={{ pointerEvents: "none" }}>+</text>
          </g>
        );
      })}
      {plano.contorno.map((pt, i) => (
        <circle key={`p${i}`} cx={pt[0]} cy={pt[1]} r={0.32} fill={punto === i ? "#F2B632" : "#1E2B26"} stroke="#fff" strokeWidth={0.07} style={{ cursor: "grab" }}
          onPointerDown={(ev) => { ev.stopPropagation(); setPunto(i); arrastre.current = { tipo: "punto", i }; }} />
      ))}
    </g>
  ) : null;

  const usadosReserva = new Set(plano.elementos.filter((e) => e.id !== sel && e.reserva_mesa_id).map((e) => e.reserva_mesa_id));
  const usadosQr = new Set(plano.elementos.filter((e) => e.id !== sel && e.qr_codigo).map((e) => e.qr_codigo));

  return (
    <div className="stack">
      <div className="card">
        <div className="between">
          <div className="row">
            <button className={modo === "elementos" ? "btn alt" : "btn ghost"} onClick={() => { setModo("elementos"); setPunto(null); }}>🪑 Mesas y elementos</button>
            <button className={modo === "forma" ? "btn alt" : "btn ghost"} onClick={() => { setModo("forma"); setSel(null); }}>📐 Forma del local</button>
          </div>
          <div className="row">
            {sucio && <span className="chip warn">Cambios sin guardar</span>}
            <button className="btn ghost" disabled={!sucio} onClick={descartar}>Descartar</button>
            <button className="btn alt" disabled={!sucio} onClick={guardar}>Guardar plano</button>
          </div>
        </div>
        {msg && <p style={{ color: "var(--verde)", marginTop: 8 }}>{msg}</p>}
        {err && <p style={{ color: "var(--rojo)", marginTop: 8 }}>{err}</p>}

        {modo === "elementos" ? (
          <>
            <p className="muted" style={{ marginTop: 10 }}>Toca para agregar y arrastra cada cosa a su lugar. Cada cuadro de la grilla es 1 metro.</p>
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              {PALETA.map((t) => <button key={t.etiqueta} className="btn ghost" style={{ padding: "6px 10px", fontSize: 13 }} onClick={() => agregar(t)}>{t.etiqueta}</button>)}
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 10 }}>Arrastra los puntos negros para dar la forma real del local. Toca un <b>+</b> para agregar una esquina.</p>
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              {FORMAS.map((f) => <button key={f.nombre} className="btn ghost" style={{ padding: "6px 10px", fontSize: 13 }}
                onClick={() => { setPlano({ ...plano, contorno: f.puntos(plano.ancho, plano.alto).map(([x, y]) => [r2(snap(x, 0.25)), r2(snap(y, 0.25))]) }); setPunto(null); }}>{f.nombre}</button>)}
              <label className="row muted" style={{ gap: 4 }}>Ancho <input className="input" style={{ width: 70 }} type="number" min={4} max={60} value={plano.ancho}
                onChange={(e) => setPlano({ ...plano, ancho: Math.max(4, Math.min(60, Number(e.target.value) || 4)) })} /> m</label>
              <label className="row muted" style={{ gap: 4 }}>Largo <input className="input" style={{ width: 70 }} type="number" min={4} max={60} value={plano.alto}
                onChange={(e) => setPlano({ ...plano, alto: Math.max(4, Math.min(60, Number(e.target.value) || 4)) })} /> m</label>
              {punto !== null && plano.contorno.length > 3 && (
                <button className="btn ghost" style={{ padding: "6px 10px", fontSize: 13, color: "var(--rojo)" }}
                  onClick={() => { setPlano({ ...plano, contorno: plano.contorno.filter((_, i) => i !== punto) }); setPunto(null); }}>Quitar punto</button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ padding: 8 }}>
        <PlanoSvg plano={plano} grilla editando seleccion={modo === "elementos" ? sel : null} extra={manillas}
          svgRef={(el) => { svg.current = el; }}
          onPointerDownFondo={() => { setSel(null); setPunto(null); }}
          onPointerDownEl={modo === "elementos" ? (el, ev) => {
            const { x, y } = aSvg(ev);
            setSel(el.id);
            arrastre.current = { tipo: "el", id: el.id, dx: x - el.x, dy: y - el.y };
          } : undefined} />
      </div>

      {modo === "elementos" && elSel && (
        <div className="card">
          <div className="between">
            <b>{ETIQUETA_TIPO[elSel.tipo]}{elSel.tipo === "mesa" ? `: ${elSel.nombre}` : ""}</b>
            <div className="row">
              <button className="btn ghost" onClick={() => cambiar(elSel.id, { rot: elSel.rot === 90 ? 0 : 90 })}>↻ Girar</button>
              <button className="btn ghost" onClick={() => {
                const c = { ...elSel, id: nuevoId(), x: r2(Math.min(plano.ancho, elSel.x + 1.2)), reserva_mesa_id: null, qr_codigo: null,
                  nombre: elSel.tipo === "mesa" ? `Mesa ${plano.elementos.filter((e) => e.tipo === "mesa").length + 1}` : elSel.nombre };
                setPlano({ ...plano, elementos: [...plano.elementos, c] }); setSel(c.id);
              }}>Duplicar</button>
              <button className="btn ghost" style={{ color: "var(--rojo)" }} onClick={() => { setPlano({ ...plano, elementos: plano.elementos.filter((e) => e.id !== elSel.id) }); setSel(null); }}>Eliminar</button>
            </div>
          </div>
          <div className="grid" style={{ marginTop: 10 }}>
            <label className="stack" style={{ gap: 4 }}><span className="muted">Nombre</span>
              <input className="input" value={elSel.nombre} onChange={(e) => cambiar(elSel.id, { nombre: e.target.value })} /></label>
            {elSel.tipo === "mesa" && (
              <>
                <label className="stack" style={{ gap: 4 }}><span className="muted">Personas</span>
                  <input className="input" type="number" min={1} max={30} value={elSel.capacidad ?? 2} onChange={(e) => cambiar(elSel.id, { capacidad: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} /></label>
                <label className="stack" style={{ gap: 4 }}><span className="muted">Forma</span>
                  <select className="input" value={elSel.forma} onChange={(e) => {
                    const forma = e.target.value as FormaMesa;
                    cambiar(elSel.id, { forma, ...(forma === "rect" && elSel.w === elSel.h ? { w: r2(elSel.w * 1.8) } : forma !== "rect" ? { h: elSel.w } : {}) });
                  }}>
                    <option value="redonda">Redonda</option><option value="cuadrada">Cuadrada</option><option value="rect">Rectangular</option>
                  </select></label>
                <label className="stack" style={{ gap: 4 }}><span className="muted">Zona</span>
                  <input className="input" list="zonas-plano" value={elSel.zona ?? ""} onChange={(e) => cambiar(elSel.id, { zona: e.target.value })} />
                  <datalist id="zonas-plano"><option value="Salón" /><option value="Terraza" /><option value="Barra" /><option value="Segundo piso" /></datalist></label>
                <label className="stack" style={{ gap: 4 }}><span className="muted">Mesa en reservas</span>
                  <select className="input" value={elSel.reserva_mesa_id ?? ""} onChange={(e) => cambiar(elSel.id, { reserva_mesa_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Sin vincular</option>
                    {vinc.reservas.map((m) => <option key={m.id} value={m.id} disabled={usadosReserva.has(m.id)}>{m.nombre} · {m.capacidad}p · {m.zona}{usadosReserva.has(m.id) ? " (ya usada)" : ""}</option>)}
                  </select></label>
                <label className="stack" style={{ gap: 4 }}><span className="muted">QR de la mesa (llamado)</span>
                  <select className="input" value={elSel.qr_codigo ?? ""} onChange={(e) => cambiar(elSel.id, { qr_codigo: e.target.value || null })}>
                    <option value="">Sin QR</option>
                    {vinc.llamado.map((m) => <option key={m.codigo} value={m.codigo} disabled={usadosQr.has(m.codigo)}>{m.nombre} ({m.codigo}){usadosQr.has(m.codigo) ? " (ya usado)" : ""}</option>)}
                  </select></label>
              </>
            )}
            <label className="stack" style={{ gap: 4 }}><span className="muted">Ancho (m)</span>
              <input className="input" type="number" step={0.1} min={0.2} value={elSel.w} onChange={(e) => {
                const w = Math.max(0.2, Number(e.target.value) || 0.2);
                cambiar(elSel.id, elSel.tipo === "mesa" && elSel.forma !== "rect" ? { w, h: w } : { w });
              }} /></label>
            {!(elSel.tipo === "mesa" && elSel.forma !== "rect") && (
              <label className="stack" style={{ gap: 4 }}><span className="muted">Largo (m)</span>
                <input className="input" type="number" step={0.1} min={0.1} value={elSel.h} onChange={(e) => cambiar(elSel.id, { h: Math.max(0.1, Number(e.target.value) || 0.1) })} /></label>
            )}
          </div>
          {elSel.tipo === "mesa" && !vinc.reservas.length && !vinc.llamado.length && (
            <p className="muted" style={{ marginTop: 8 }}>Cuando actives Reservas o Llamado a mesa, aquí podrás vincular esta mesa.</p>
          )}
        </div>
      )}

      {modo === "elementos" && !elSel && (
        <div className="card">
          <p className="muted">Toca una mesa para cambiar su nombre, personas, forma y vincularla con Reservas y con su QR.</p>
          {(vinc.reservas.length > 0 || vinc.llamado.length > 0) && (
            <button className="btn ghost" style={{ marginTop: 10 }} onClick={sugerir}>Armar plano automático con mis mesas</button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- En vivo ----------------
function EnVivo({ api, plano }: { api: ModuleProps["api"]; plano: Plano }) {
  const [vivo, setVivo] = useState<Vivo | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    const cargar = () => api.get<Vivo>("/vivo").then(setVivo).catch(() => {});
    void cargar();
    const id = setInterval(cargar, 5000);
    return () => clearInterval(id);
  }, [api]);
  const estados: Record<string, EstadoVisual> = {};
  for (const [id, v] of Object.entries(vivo?.estados ?? {})) estados[id] = v.estado;
  const cuenta = (e: string) => Object.values(vivo?.estados ?? {}).filter((v) => v.estado === e).length;
  const elSel = plano.elementos.find((e) => e.id === sel);
  return (
    <div className="stack">
      <div className="grid">
        <div className="card"><p className="muted">Libres</p><p className="kpi">{cuenta("libre")}</p></div>
        <div className="card"><p className="muted">Reservadas pronto</p><p className="kpi">{cuenta("reservada")}</p></div>
        <div className="card"><p className="muted">Ocupadas</p><p className="kpi">{cuenta("ocupada")}</p></div>
        <div className="card" style={cuenta("llamando") ? { background: "var(--rojoClaro)", borderColor: "var(--rojo)" } : undefined}><p className="muted">Llamando</p><p className="kpi">{cuenta("llamando")}</p></div>
      </div>
      <div className="card" style={{ padding: 8 }}>
        <PlanoSvg plano={plano} estados={estados} seleccion={sel} onTapMesa={(el) => setSel(el.id === sel ? null : el.id)} />
        <Leyenda estados={["libre", "reservada", "ocupada", "llamando"]} />
      </div>
      {elSel && (
        <div className="card">
          <b>{elSel.nombre}</b> <span className="muted">· {elSel.capacidad} personas · {elSel.zona}</span>
          {(vivo?.estados[elSel.id]?.detalle ?? []).map((d, i) => <p key={i} style={{ marginTop: 6 }}>{d}</p>)}
          {!vivo?.estados[elSel.id]?.detalle.length && <p className="muted" style={{ marginTop: 6 }}>Libre por ahora, sin reservas en las próximas 2 horas.</p>}
        </div>
      )}
      <p className="muted">Se actualiza cada 5 segundos con las reservas de hoy y los llamados del QR.</p>
    </div>
  );
}

const mod: ClientModule = { id: "plano", label: "Plano del local", icon: "🗺️", Component: Pantalla };
export default mod;
