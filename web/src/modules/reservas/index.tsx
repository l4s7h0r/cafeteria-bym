import { useCallback, useEffect, useMemo, useState } from "react";
import type { Api, ClientModule, ModuleProps } from "../../core/types";
import { makeApi } from "../../core/api";
import PlanoSvg, { Leyenda, usePlanoPublico, type EstadoVisual } from "../../core/PlanoSvg";

// Isla "reservas": agenda interna del día + página pública para que el cliente final reserve.

const ESTADOS = ["pendiente", "confirmada", "sentada", "cancelada", "no_llego"] as const;
type Estado = (typeof ESTADOS)[number];
const LABEL: Record<Estado, string> = { pendiente: "Pendiente", confirmada: "Confirmada", sentada: "Sentada", cancelada: "Cancelada", no_llego: "No llegó" };
const CHIP: Record<Estado, string> = { pendiente: "chip warn", confirmada: "chip", sentada: "chip", cancelada: "chip off", no_llego: "chip bad" };

interface Reserva {
  id: number; mesa_id: number | null; mesa_nombre: string | null; mesa_zona: string | null; nombre: string; telefono: string;
  personas: number; fecha: string; hora: string; estado: Estado; nota: string | null; origen: string; codigo: string;
}
interface Dia {
  fecha: string; reservas: Reserva[]; porEstado: Record<Estado, number>;
  resumen: { total: number; vigentes: number; personas: number; web: number };
  ocupacion: { totalMesas: number; promedio: number; peak: { hora: string; mesas: number; pct: number }; franjas: { hora: string; mesas: number; pct: number }[] };
}
interface Mesa { id: number; nombre: string; capacidad: number; zona: string }

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoyStr = () => ymd(new Date());
const correrDia = (f: string, n: number) => { const d = new Date(f + "T12:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fechaLarga = (f: string) => { const d = new Date(f + "T12:00:00"); return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`; };
const fechaCorta = (f: string) => { const d = new Date(f + "T12:00:00"); return `${DIAS[d.getDay()].slice(0, 3)} ${d.getDate()}`; };

// ---------------- Pantalla interna ----------------
function Pantalla({ tenant, api }: ModuleProps) {
  const [fecha, setFecha] = useState(hoyStr());
  const [dia, setDia] = useState<Dia | null>(null);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [semana, setSemana] = useState<{ fecha: string; reservas: number; personas: number; pendientes: number }[]>([]);
  const [verForm, setVerForm] = useState(false);
  const [err, setErr] = useState("");
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      setErr("");
      const [d, s] = await Promise.all([api.get<Dia>(`/dia?fecha=${fecha}`), api.get<any[]>(`/semana?desde=${hoyStr()}`)]);
      setDia(d); setSemana(s);
    } catch (e: any) { setErr(e.message); } finally { setCargando(false); }
  }, [api, fecha]);

  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => { api.get<Mesa[]>("/mesas").then(setMesas).catch(() => {}); }, [api]);

  const cambiar = async (r: Reserva, estado: Estado) => {
    try { await api.patch(`/reservas/${r.id}`, { estado }); await cargar(); } catch (e: any) { setErr(e.message); }
  };

  const porHora = useMemo(() => {
    const m = new Map<string, Reserva[]>();
    for (const r of dia?.reservas ?? []) { const k = r.hora; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [dia]);

  const enlacePublico = `${location.origin}/p/${tenant.slug}/reservar`;

  return (
    <div className="stack">
      <div className="card">
        <div className="between">
          <div>
            <h2 className="display">Agenda de reservas</h2>
            <p className="muted">{fechaLarga(fecha)}{fecha === hoyStr() ? " · hoy" : ""}</p>
          </div>
          <div className="row">
            <button className="btn ghost" onClick={() => setFecha(correrDia(fecha, -1))} aria-label="Día anterior">←</button>
            <input className="input" style={{ width: 150 }} type="date" value={fecha} onChange={(e) => setFecha(e.target.value || hoyStr())} />
            <button className="btn ghost" onClick={() => setFecha(correrDia(fecha, 1))} aria-label="Día siguiente">→</button>
            {fecha !== hoyStr() && <button className="btn ghost" onClick={() => setFecha(hoyStr())}>Hoy</button>}
          </div>
        </div>
      </div>

      {err && <div className="card" style={{ borderColor: "var(--rojo)", color: "var(--rojo)" }}>{err}</div>}
      {cargando && <p className="muted">Cargando…</p>}

      {dia && (
        <>
          <div className="grid">
            <div className="card"><p className="muted">Reservas vigentes</p><p className="kpi">{dia.resumen.vigentes}</p><p className="muted">{dia.resumen.total} en total</p></div>
            <div className="card"><p className="muted">Personas esperadas</p><p className="kpi">{dia.resumen.personas}</p><p className="muted">{dia.resumen.web} llegaron por la web</p></div>
            <div className="card"><p className="muted">Por confirmar</p><p className="kpi">{dia.porEstado.pendiente}</p><p className="muted">{dia.porEstado.confirmada} confirmadas</p></div>
            <div className="card"><p className="muted">Ocupación promedio</p><p className="kpi">{dia.ocupacion.promedio}%</p><p className="muted">{dia.ocupacion.totalMesas} mesas · peak {dia.ocupacion.peak?.hora} ({dia.ocupacion.peak?.pct}%)</p></div>
          </div>

          <div className="card">
            <div className="between"><h3>Ocupación por hora</h3><span className="muted">{dia.ocupacion.totalMesas} mesas</span></div>
            <div className="row" style={{ gap: 4, alignItems: "flex-end", marginTop: 12, overflowX: "auto" }}>
              {dia.ocupacion.franjas.map((f) => (
                <div key={f.hora} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 34 }}>
                  <span className="muted" style={{ fontSize: 10 }}>{f.pct ? `${f.pct}%` : ""}</span>
                  <div title={`${f.mesas} de ${dia.ocupacion.totalMesas} mesas`}
                    style={{ width: 22, height: 80, borderRadius: 6, background: "#EEF0ED", display: "flex", alignItems: "flex-end" }}>
                    <div style={{
                      // alto relativo al peak del día (el % real va en la etiqueta)
                      width: "100%", height: `${f.pct ? Math.max(10, Math.round((f.pct / Math.max(1, dia.ocupacion.peak?.pct ?? 1)) * 100)) : 0}%`, borderRadius: 6,
                      background: f.pct >= 80 ? "var(--rojo)" : f.pct >= 50 ? "var(--mostaza)" : "var(--verde)",
                    }} />
                  </div>
                  <span className="muted" style={{ fontSize: 10 }}>{f.hora.slice(0, 5)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="between">
              <h3>Reservas del día</h3>
              <button className="btn alt" onClick={() => setVerForm((v) => !v)}>{verForm ? "Cerrar" : "+ Nueva reserva"}</button>
            </div>
            {verForm && <FormReserva api={api} fecha={fecha} mesas={mesas} onListo={() => { setVerForm(false); void cargar(); }} />}
            {!porHora.length && <p className="muted" style={{ marginTop: 10 }}>No hay reservas para este día.</p>}
            {porHora.map(([hora, rs]) => (
              <div key={hora} style={{ marginTop: 14 }}>
                <div className="row" style={{ gap: 8 }}>
                  <b style={{ fontSize: 15 }}>{hora}</b>
                  <span className="muted">{rs.filter((r) => r.estado !== "cancelada" && r.estado !== "no_llego").reduce((a, r) => a + r.personas, 0)} personas</span>
                </div>
                <div className="stack" style={{ marginTop: 8 }}>
                  {rs.map((r) => (
                    <div key={r.id} style={{ border: "1px solid var(--borde)", borderRadius: 12, padding: 10, opacity: r.estado === "cancelada" || r.estado === "no_llego" ? 0.65 : 1 }}>
                      <div className="between">
                        <div>
                          <b>{r.nombre}</b> <span className="muted">· {r.personas}p · {r.mesa_nombre ?? "sin mesa"}{r.mesa_zona ? ` (${r.mesa_zona})` : ""}</span>
                          <div className="muted">{r.telefono} · {r.origen === "web" ? "reserva web" : r.origen === "telefono" ? "por teléfono" : "mostrador"} · cód. {r.codigo}</div>
                          {r.nota && <div className="muted">📝 {r.nota}</div>}
                        </div>
                        <span className={CHIP[r.estado]}>{LABEL[r.estado]}</span>
                      </div>
                      <div className="row" style={{ marginTop: 8 }}>
                        {r.estado === "pendiente" && <button className="btn alt" onClick={() => cambiar(r, "confirmada")}>Confirmar</button>}
                        {(r.estado === "pendiente" || r.estado === "confirmada") && <button className="btn" onClick={() => cambiar(r, "sentada")}>Sentar</button>}
                        {(r.estado === "pendiente" || r.estado === "confirmada") && <button className="btn ghost" onClick={() => cambiar(r, "no_llego")}>No llegó</button>}
                        {r.estado !== "cancelada" && <button className="btn ghost" onClick={() => cambiar(r, "cancelada")}>Cancelar</button>}
                        {(r.estado === "cancelada" || r.estado === "no_llego") && <button className="btn ghost" onClick={() => cambiar(r, "confirmada")}>Reactivar</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Próximos 7 días</h3>
            <div className="row" style={{ marginTop: 10, gap: 8, overflowX: "auto" }}>
              {semana.map((d) => (
                <button key={d.fecha} className="btn ghost" onClick={() => setFecha(d.fecha)}
                  style={{ flexDirection: "column", display: "flex", minWidth: 92, background: d.fecha === fecha ? "var(--verdeClaro)" : undefined }}>
                  <span className="muted">{fechaCorta(d.fecha)}</span>
                  <b style={{ fontSize: 18 }}>{d.reservas}</b>
                  <span className="muted">{d.personas} personas</span>
                  {!!d.pendientes && <span className="chip warn" style={{ marginTop: 4 }}>{d.pendientes} x confirmar</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="card dark">
            <h3>Página pública de reservas</h3>
            <p className="tiza" style={{ marginTop: 4 }}>Comparte este enlace en Instagram o en Google: el cliente reserva solo.</p>
            <div className="row" style={{ marginTop: 10 }}>
              <a className="btn alt" href={`/p/${tenant.slug}/reservar`} target="_blank" rel="noreferrer">Abrir</a>
              <button className="btn ghost" style={{ color: "var(--tiza)" }} onClick={() => navigator.clipboard?.writeText(enlacePublico)}>Copiar enlace</button>
            </div>
            <p className="tiza" style={{ marginTop: 8, wordBreak: "break-all" }}>{enlacePublico}</p>
          </div>

          <div className="card">
            <h3>Mesas del local</h3>
            <div className="scroll-x">
              <table>
                <thead><tr><th>Mesa</th><th>Zona</th><th>Capacidad</th></tr></thead>
                <tbody>{mesas.map((m) => <tr key={m.id}><td>{m.nombre}</td><td>{m.zona}</td><td>{m.capacidad} personas</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FormReserva({ api, fecha, mesas, onListo }: { api: Api; fecha: string; mesas: Mesa[]; onListo: () => void }) {
  const [f, setF] = useState({ nombre: "", telefono: "", personas: 2, hora: "13:00", fecha, mesa_id: "", nota: "" });
  const [horas, setHoras] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { api.get<{ slots: string[] }>("/config").then((c) => setHoras(c.slots)).catch(() => {}); }, [api]);
  useEffect(() => { setF((x) => ({ ...x, fecha })); }, [fecha]);

  const guardar = async () => {
    setGuardando(true); setErr("");
    try {
      await api.post("/reservas", { ...f, mesa_id: f.mesa_id ? Number(f.mesa_id) : undefined, estado: "confirmada", origen: "telefono" });
      onListo();
    } catch (e: any) { setErr(e.message); } finally { setGuardando(false); }
  };

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--borde)", paddingTop: 12 }} className="stack">
      <div className="grid">
        <label className="stack" style={{ gap: 4 }}><span className="muted">Nombre</span>
          <input className="input" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej: Camila Rojas" /></label>
        <label className="stack" style={{ gap: 4 }}><span className="muted">Teléfono</span>
          <input className="input" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} placeholder="+56 9 1234 5678" /></label>
        <label className="stack" style={{ gap: 4 }}><span className="muted">Personas</span>
          <input className="input" type="number" min={1} max={12} value={f.personas} onChange={(e) => setF({ ...f, personas: Number(e.target.value) })} /></label>
        <label className="stack" style={{ gap: 4 }}><span className="muted">Hora</span>
          <select className="input" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })}>{horas.map((h) => <option key={h} value={h}>{h}</option>)}</select></label>
        <label className="stack" style={{ gap: 4 }}><span className="muted">Mesa</span>
          <select className="input" value={f.mesa_id} onChange={(e) => setF({ ...f, mesa_id: e.target.value })}>
            <option value="">Asignar automáticamente</option>
            {mesas.map((m) => <option key={m.id} value={m.id}>{m.nombre} · {m.zona} · {m.capacidad}p</option>)}
          </select></label>
        <label className="stack" style={{ gap: 4 }}><span className="muted">Nota</span>
          <input className="input" value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} placeholder="Cumpleaños, silla de bebé…" /></label>
      </div>
      {err && <p style={{ color: "var(--rojo)" }}>{err}</p>}
      <div className="row"><button className="btn alt" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar reserva"}</button></div>
    </div>
  );
}

// ---------------- Página pública: /p/:slug/reservar ----------------
interface Disp { local: string; fecha: string; personas: number; maxPersonas: number; diasAdelante: number; horas: { hora: string; disponible: boolean }[] }

function PaginaReservar({ slug }: { slug: string }) {
  const api = useMemo(() => makeApi("/api/m/reservas", slug), [slug]);
  const [personas, setPersonas] = useState(2);
  const [fecha, setFecha] = useState(hoyStr());
  const [disp, setDisp] = useState<Disp | null>(null);
  const [hora, setHora] = useState("");
  const [datos, setDatos] = useState({ nombre: "", telefono: "", nota: "" });
  const [listo, setListo] = useState<any>(null);
  const [err, setErr] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [bloqueado, setBloqueado] = useState(false);
  // Plano del local (isla "plano"): si existe, el cliente puede elegir su mesa
  const plano = usePlanoPublico(slug);
  const [mesasHora, setMesasHora] = useState<{ id: number; nombre: string; capacidad: number; libre: boolean; cabe: boolean }[] | null>(null);
  const [mesaSel, setMesaSel] = useState<number | null>(null);
  useEffect(() => {
    setMesaSel(null); setMesasHora(null);
    if (!plano || !hora) return;
    api.get<any[]>(`/public/mesas?fecha=${fecha}&hora=${hora}&personas=${personas}`).then(setMesasHora).catch(() => {});
  }, [api, plano, fecha, hora, personas]);
  const estadosPlano = useMemo(() => {
    const out: Record<string, EstadoVisual> = {};
    for (const el of plano?.elementos ?? []) {
      if (el.tipo !== "mesa") continue;
      const m = mesasHora?.find((x) => x.id === el.reserva_mesa_id);
      out[el.id] = !m || !m.libre || !m.cabe ? "no_disponible" : m.id === mesaSel ? "seleccionada" : "libre";
    }
    return out;
  }, [plano, mesasHora, mesaSel]);
  const nombreMesaSel = mesasHora?.find((m) => m.id === mesaSel)?.nombre;

  useEffect(() => {
    setHora("");
    api.get<Disp>(`/public/disponibilidad?fecha=${fecha}&personas=${personas}`).then((d) => { setDisp(d); setErr(""); })
      .catch((e) => { setErr(e.message); setBloqueado(true); });
  }, [api, fecha, personas]);

  const reservar = async () => {
    setEnviando(true); setErr("");
    try { setListo(await api.post("/public/reservas", { ...datos, personas, fecha, hora, mesa_id: mesaSel ?? undefined })); }
    catch (e: any) { setErr(e.message); } finally { setEnviando(false); }
  };

  const dias = Array.from({ length: 14 }, (_, i) => correrDia(hoyStr(), i));

  if (bloqueado) return (
    <div className="page" style={{ maxWidth: 480 }}>
      <div className="card"><h2 className="display">Reservas no disponibles</h2><p className="muted" style={{ marginTop: 6 }}>{err}</p></div>
    </div>
  );

  if (listo) return (
    <div className="page" style={{ maxWidth: 480 }}>
      <div className="card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 44 }}>✅</div>
        <h2 className="display" style={{ marginTop: 8 }}>¡Reserva tomada!</h2>
        <p className="muted" style={{ marginTop: 6 }}>Te esperamos en {listo.local}.</p>
        <div className="card" style={{ marginTop: 14, background: "var(--verdeClaro)", border: 0 }}>
          <p><b>{fechaLarga(listo.fecha)}</b> a las <b>{listo.hora}</b></p>
          <p className="muted">{listo.personas} {listo.personas === 1 ? "persona" : "personas"}{listo.mesa ? ` · ${listo.mesa}` : ""}</p>
          <p className="muted" style={{ marginTop: 6 }}>Código: <b>{listo.codigo}</b></p>
        </div>
        {plano && listo.mesa_id && plano.elementos.some((e) => e.reserva_mesa_id === listo.mesa_id) && (
          <div style={{ marginTop: 14, textAlign: "left" }}>
            <p className="muted" style={{ marginBottom: 6 }}>Tu mesa en el local:</p>
            <PlanoSvg plano={plano} estados={Object.fromEntries(plano.elementos.filter((e) => e.tipo === "mesa").map((e) => [e.id, e.reserva_mesa_id === listo.mesa_id ? "aqui" : "atenuada"]))} />
          </div>
        )}
        <p className="muted" style={{ marginTop: 12 }}>Queda <b>pendiente de confirmación</b>. Te avisamos por WhatsApp al {datos.telefono}.</p>
        <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => { setListo(null); setDatos({ nombre: "", telefono: "", nota: "" }); setHora(""); }}>Hacer otra reserva</button>
      </div>
    </div>
  );

  return (
    <div className="page" style={{ maxWidth: 480 }}>
      <div className="card dark">
        <p className="tiza">Reserva tu mesa</p>
        <h1 className="display" style={{ fontSize: 26 }}>{disp?.local ?? ""}</h1>
      </div>

      <div className="card">
        <h3>1. ¿Cuántas personas?</h3>
        <div className="row" style={{ marginTop: 10 }}>
          {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
            <button key={n} onClick={() => setPersonas(n)} className={personas === n ? "btn alt" : "btn ghost"} style={{ minWidth: 48 }}>{n}</button>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>2. ¿Qué día?</h3>
        <div className="row" style={{ marginTop: 10, overflowX: "auto", flexWrap: "nowrap", paddingBottom: 4 }}>
          {dias.map((d) => (
            <button key={d} onClick={() => setFecha(d)} className={fecha === d ? "btn alt" : "btn ghost"} style={{ minWidth: 76, flexDirection: "column", display: "flex" }}>
              <span style={{ fontSize: 12 }}>{d === hoyStr() ? "Hoy" : fechaCorta(d)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>3. ¿A qué hora?</h3>
        {!disp && <p className="muted" style={{ marginTop: 8 }}>Buscando horarios…</p>}
        <div className="row" style={{ marginTop: 10 }}>
          {disp?.horas.map((h) => (
            <button key={h.hora} disabled={!h.disponible} onClick={() => setHora(h.hora)}
              className={hora === h.hora ? "btn alt" : "btn ghost"}
              style={{ minWidth: 68, opacity: h.disponible ? 1 : 0.35, textDecoration: h.disponible ? "none" : "line-through" }}>{h.hora}</button>
          ))}
        </div>
        {disp && !disp.horas.some((h) => h.disponible) && <p className="muted" style={{ marginTop: 10 }}>No quedan mesas para ese día. Prueba otra fecha.</p>}
      </div>

      {hora && plano && (
        <div className="card">
          <div className="between"><h3>4. Elige tu mesa <span className="muted">(opcional)</span></h3>
            {mesaSel && <button className="btn ghost" style={{ padding: "4px 10px" }} onClick={() => setMesaSel(null)}>Que me asignen</button>}</div>
          <p className="muted" style={{ marginTop: 4 }}>{mesaSel ? `Elegiste ${nombreMesaSel}.` : "Toca una mesa verde. Si no eliges, te asignamos la mejor disponible."}</p>
          <div style={{ marginTop: 10 }}>
            <PlanoSvg plano={plano} estados={estadosPlano}
              onTapMesa={(el) => { const m = mesasHora?.find((x) => x.id === el.reserva_mesa_id); if (m?.libre && m.cabe) setMesaSel(m.id === mesaSel ? null : m.id); }} />
            <Leyenda estados={["libre", "seleccionada", "no_disponible"]} />
          </div>
        </div>
      )}

      {hora && (
        <div className="card">
          <h3>{plano ? "5" : "4"}. Tus datos</h3>
          <div className="stack" style={{ marginTop: 10 }}>
            <input className="input" placeholder="Nombre y apellido" value={datos.nombre} onChange={(e) => setDatos({ ...datos, nombre: e.target.value })} />
            <input className="input" placeholder="Teléfono (+56 9 ...)" inputMode="tel" value={datos.telefono} onChange={(e) => setDatos({ ...datos, telefono: e.target.value })} />
            <input className="input" placeholder="¿Algo que debamos saber? (opcional)" value={datos.nota} onChange={(e) => setDatos({ ...datos, nota: e.target.value })} />
          </div>
          {err && <p style={{ color: "var(--rojo)", marginTop: 10 }}>{err}</p>}
          <button className="btn alt" style={{ width: "100%", marginTop: 14, padding: "14px" }} disabled={enviando || !datos.nombre || !datos.telefono} onClick={reservar}>
            {enviando ? "Enviando…" : `Reservar ${personas}p · ${fechaCorta(fecha)} ${hora}${nombreMesaSel ? ` · ${nombreMesaSel}` : ""}`}
          </button>
          <p className="muted" style={{ marginTop: 10 }}>Al reservar aceptas que te contactemos para confirmar. Si no puedes venir, avísanos.</p>
        </div>
      )}
    </div>
  );
}

const mod: ClientModule = {
  id: "reservas",
  label: "Reservas",
  icon: "📅",
  Component: Pantalla,
  publicPages: [{ path: "reservar", Component: PaginaReservar }],
};
export default mod;
