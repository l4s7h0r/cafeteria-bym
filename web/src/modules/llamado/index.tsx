import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClientModule, ModuleProps } from "../../core/types";
import { makeApi } from "../../core/api";

// Isla "llamado": cola en vivo de llamados a la mesa + QR por mesa + página pública que ve el comensal.

type Tipo = "garzon" | "cuenta" | "otro";
const ICONO: Record<Tipo, string> = { garzon: "🙋", cuenta: "🧾", otro: "💬" };

interface Llamado {
  id: number; mesa_codigo: string; mesa_nombre: string; tipo: Tipo; tipo_label: string; nota: string | null;
  estado: "pendiente" | "atendiendo" | "cerrado"; creado_en: string; espera_seg: number; respuesta_seg: number | null; canal: string;
}
interface Cola {
  ahora: string; abiertos: Llamado[]; cerrados: Llamado[];
  hoy: { total: number; porTipo: Record<Tipo, number>; promedio_respuesta_seg: number | null };
}
interface MesaL { id: number; codigo: string; nombre: string; zona: string }

const espera = (seg: number) => (seg < 60 ? `${seg}s` : `${Math.floor(seg / 60)} min ${seg % 60}s`);
const minutos = (seg: number | null) => (seg === null ? "—" : seg < 60 ? `${seg}s` : `${Math.round(seg / 60)} min`);
const hora = (s: string) => s.slice(11, 16);

// ---------------- Pantalla interna ----------------
function Pantalla({ tenant, api }: ModuleProps) {
  const [vista, setVista] = useState<"cola" | "qr">("cola");
  const [cola, setCola] = useState<Cola | null>(null);
  const [mesas, setMesas] = useState<MesaL[]>([]);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);

  const cargar = useCallback(async () => {
    try { setCola(await api.get<Cola>("/cola")); setErr(""); } catch (e: any) { setErr(e.message); }
  }, [api]);

  // Polling cada 3 s
  useEffect(() => {
    void cargar();
    const id = setInterval(cargar, 3000);
    return () => clearInterval(id);
  }, [cargar]);
  // Reloj local para que el tiempo de espera avance entre consultas
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { api.get<MesaL[]>("/mesas").then(setMesas).catch(() => {}); }, [api]);

  const accion = async (l: Llamado, accion: "atender" | "cerrar" | "reabrir") => {
    try { await api.patch(`/llamados/${l.id}`, { accion }); await cargar(); } catch (e: any) { setErr(e.message); }
  };

  const abiertos = cola?.abiertos ?? [];
  const pendientes = abiertos.filter((l) => l.estado === "pendiente");
  const desfase = cola ? Math.max(0, Math.round((Date.now() - new Date(cola.ahora.replace(" ", "T")).getTime()) / 1000)) : 0;
  void tick;

  return (
    <div className="stack">
      <div className="row">
        <button className={vista === "cola" ? "btn alt" : "btn ghost"} onClick={() => setVista("cola")}>Cola en vivo</button>
        <button className={vista === "qr" ? "btn alt" : "btn ghost"} onClick={() => setVista("qr")}>QR de las mesas</button>
      </div>

      {err && <div className="card" style={{ borderColor: "var(--rojo)", color: "var(--rojo)" }}>{err}</div>}

      {vista === "cola" && (
        <>
          <div className="grid">
            <div className="card" style={pendientes.length ? { background: "var(--naranjoClaro)", borderColor: "var(--naranjo)" } : undefined}>
              <p className="muted">Esperando garzón</p><p className="kpi">{pendientes.length}</p>
              <p className="muted">{abiertos.length - pendientes.length} en atención</p>
            </div>
            <div className="card"><p className="muted">Llamados hoy</p><p className="kpi">{cola?.hoy.total ?? 0}</p>
              <p className="muted">{cola?.hoy.porTipo.cuenta ?? 0} {cola?.hoy.porTipo.cuenta === 1 ? "pidió" : "pidieron"} la cuenta</p></div>
            <div className="card"><p className="muted">Respuesta promedio</p><p className="kpi">{minutos(cola?.hoy.promedio_respuesta_seg ?? null)}</p>
              <p className="muted">hoy, desde que tocan el QR</p></div>
            <div className="card"><p className="muted">Mesas con QR</p><p className="kpi">{mesas.length}</p>
              <p className="muted">se actualiza cada 3 segundos</p></div>
          </div>

          <div className="card">
            <div className="between"><h3>Llamados abiertos</h3><span className="muted">● en vivo</span></div>
            {!abiertos.length && <p className="muted" style={{ marginTop: 10 }}>Todo tranquilo: ninguna mesa está llamando.</p>}
            <div className="stack" style={{ marginTop: 10 }}>
              {abiertos.map((l) => {
                const seg = l.espera_seg + desfase;
                const urgente = seg > 180;
                return (
                  <div key={l.id} style={{
                    border: `1px solid ${urgente ? "var(--rojo)" : l.estado === "atendiendo" ? "var(--borde)" : "var(--naranjo)"}`,
                    background: l.estado === "atendiendo" ? "#fff" : urgente ? "var(--rojoClaro)" : "var(--naranjoClaro)",
                    borderRadius: 12, padding: 12,
                  }}>
                    <div className="between">
                      <div>
                        <b style={{ fontSize: 17 }}>{ICONO[l.tipo]} {l.mesa_nombre}</b>
                        <div>{l.tipo_label}{l.nota ? ` — “${l.nota}”` : ""}</div>
                        <div className="muted">{hora(l.creado_en)} · {l.canal === "qr" ? "escaneó el QR" : "desde la web"}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span className={l.estado === "atendiendo" ? "chip" : urgente ? "chip bad" : "chip warn"}>{l.estado === "atendiendo" ? "En atención" : "Esperando"}</span>
                        <div style={{ fontWeight: 800, fontSize: 18, marginTop: 4 }}>{espera(seg)}</div>
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: 10 }}>
                      {l.estado === "pendiente" && <button className="btn alt" onClick={() => accion(l, "atender")}>Voy a la mesa</button>}
                      <button className="btn" onClick={() => accion(l, "cerrar")}>Listo, atendido</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h3>Cerrados hoy</h3>
            <div className="scroll-x">
              <table>
                <thead><tr><th>Hora</th><th>Mesa</th><th>Pidió</th><th>Respuesta</th><th></th></tr></thead>
                <tbody>
                  {(cola?.cerrados ?? []).map((l) => (
                    <tr key={l.id}>
                      <td>{hora(l.creado_en)}</td><td>{l.mesa_nombre}</td>
                      <td>{ICONO[l.tipo]} {l.tipo_label}{l.nota ? ` — ${l.nota}` : ""}</td>
                      <td>{minutos(l.respuesta_seg)}</td>
                      <td><button className="btn ghost" onClick={() => accion(l, "reabrir")}>Reabrir</button></td>
                    </tr>
                  ))}
                  {!cola?.cerrados.length && <tr><td colSpan={5} className="muted">Todavía no hay llamados cerrados hoy.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {vista === "qr" && <VistaQR slug={tenant.slug} mesas={mesas} nombreLocal={tenant.nombre} />}
    </div>
  );
}

// ---------------- Vista para imprimir los QR ----------------
function VistaQR({ slug, mesas, nombreLocal }: { slug: string; mesas: MesaL[]; nombreLocal: string }) {
  const base = encodeURIComponent(location.origin);
  return (
    <div className="stack">
      <style>{`
        @media print {
          .top, .tabs, .no-print { display: none !important; }
          .page { padding: 0 !important; max-width: none !important; }
          .qr-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .qr-card { break-inside: avoid; border: 1px dashed #999 !important; }
        }
        .qr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
      `}</style>
      <div className="card no-print">
        <div className="between">
          <div>
            <h3>QR para las mesas</h3>
            <p className="muted">Imprime, recorta y pega uno en cada mesa. Al escanear se abre la página del llamado.</p>
          </div>
          <button className="btn alt" onClick={() => window.print()}>Imprimir</button>
        </div>
      </div>
      <div className="qr-grid">
        {mesas.map((m) => (
          <div key={m.id} className="card qr-card" style={{ textAlign: "center" }}>
            <b className="display" style={{ fontSize: 18 }}>{m.nombre}</b>
            <p className="muted">{m.zona}</p>
            <img alt={`QR de ${m.nombre}`} style={{ width: "100%", maxWidth: 190, height: "auto", margin: "8px auto 0" }}
              src={`/api/m/llamado/qr/${encodeURIComponent(m.codigo)}?t=${slug}&base=${base}&escala=6`} />
            <p style={{ fontWeight: 700, marginTop: 6 }}>Escanea para llamar al garzón</p>
            <p className="muted" style={{ fontSize: 11 }}>{nombreLocal} · mesa {m.codigo}</p>
          </div>
        ))}
        {!mesas.length && <p className="muted">No hay mesas configuradas.</p>}
      </div>
    </div>
  );
}

// ---------------- Página pública del QR: /p/:slug/mesa/:mesa ----------------
interface DatosMesa {
  local: string; mesa: { codigo: string; nombre: string; zona: string };
  opciones: { tipo: Tipo; label: string }[]; activo: Llamado | null;
}

function PaginaMesa({ slug, params }: { slug: string; params: Record<string, string> }) {
  const api = useMemo(() => makeApi("/api/m/llamado", slug), [slug]);
  const mesa = params.mesa ?? "";
  const [datos, setDatos] = useState<DatosMesa | null>(null);
  const [err, setErr] = useState("");
  const [nota, setNota] = useState("");
  const [pidiendoOtro, setPidiendoOtro] = useState(false);
  const [enviado, setEnviado] = useState<{ mensaje: string; tipo: Tipo } | null>(null);
  const [enviando, setEnviando] = useState<Tipo | null>(null);

  useEffect(() => {
    api.get<DatosMesa>(`/public/mesa/${encodeURIComponent(mesa)}`).then(setDatos).catch((e) => setErr(e.message));
  }, [api, mesa]);

  const llamar = async (tipo: Tipo) => {
    if (tipo === "otro" && !pidiendoOtro) { setPidiendoOtro(true); return; }
    setEnviando(tipo); setErr("");
    try {
      const r = await api.post<{ mensaje: string }>(`/public/mesa/${encodeURIComponent(mesa)}`, { tipo, nota: tipo === "otro" ? nota : undefined });
      setEnviado({ mensaje: r.mensaje, tipo });
      setPidiendoOtro(false); setNota("");
    } catch (e: any) { setErr(e.message); } finally { setEnviando(null); }
  };

  if (err && !datos) return (
    <div className="page" style={{ maxWidth: 440 }}>
      <div className="card">
        <h2 className="display">{/plan/i.test(err) ? "Llamado a mesa no disponible" : "Mesa no encontrada"}</h2>
        <p className="muted" style={{ marginTop: 6 }}>{/plan/i.test(err) ? "Este local todavía no tiene activado el llamado a la mesa." : err}</p>
      </div>
    </div>
  );
  if (!datos) return <div className="page muted">Cargando…</div>;

  if (enviado) return (
    <div className="page" style={{ maxWidth: 440 }}>
      <div className="card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48 }}>{enviado.tipo === "cuenta" ? "🧾" : "🙋"}</div>
        <h2 className="display" style={{ marginTop: 8 }}>{enviado.mensaje}</h2>
        <p className="muted" style={{ marginTop: 8 }}>{datos.mesa.nombre} · {datos.local}</p>
        <button className="btn ghost" style={{ marginTop: 16 }} onClick={() => setEnviado(null)}>Pedir otra cosa</button>
      </div>
    </div>
  );

  return (
    <div className="page" style={{ maxWidth: 440 }}>
      <div className="card dark" style={{ textAlign: "center" }}>
        <p className="tiza">{datos.local}</p>
        <h1 className="display" style={{ fontSize: 28 }}>{datos.mesa.nombre}</h1>
        <p className="tiza">{datos.mesa.zona}</p>
      </div>

      {datos.activo && (
        <div className="card" style={{ background: "var(--verdeClaro)", borderColor: "var(--verde)" }}>
          <b>Ya avisamos</b>
          <p className="muted">{datos.activo.tipo_label} · hace {espera(datos.activo.espera_seg)}. {datos.activo.estado === "atendiendo" ? "Un garzón viene en camino." : "Espéranos un momento."}</p>
        </div>
      )}

      <div className="stack">
        <button className="btn alt" style={{ padding: "22px 16px", fontSize: 19 }} disabled={enviando === "garzon"} onClick={() => llamar("garzon")}>
          🙋 Llamar al garzón
        </button>
        <button className="btn" style={{ padding: "22px 16px", fontSize: 19 }} disabled={enviando === "cuenta"} onClick={() => llamar("cuenta")}>
          🧾 Pedir la cuenta
        </button>
        {!pidiendoOtro ? (
          <button className="btn ghost" style={{ padding: "18px 16px", fontSize: 17 }} onClick={() => setPidiendoOtro(true)}>💬 Otro</button>
        ) : (
          <div className="card">
            <h3>¿Qué necesitas?</h3>
            <textarea className="input" style={{ marginTop: 8, minHeight: 84 }} value={nota} maxLength={240}
              placeholder="Ej: nos faltan servilletas, ¿nos traen agua?" onChange={(e) => setNota(e.target.value)} />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn alt" disabled={!nota.trim() || enviando === "otro"} onClick={() => llamar("otro")}>Enviar</button>
              <button className="btn ghost" onClick={() => { setPidiendoOtro(false); setNota(""); }}>Cancelar</button>
            </div>
          </div>
        )}
      </div>

      {err && <p style={{ color: "var(--rojo)" }}>{err}</p>}
      <p className="muted" style={{ textAlign: "center" }}>Tu llamado llega al tiro a la pantalla del local.</p>
    </div>
  );
}

const mod: ClientModule = {
  id: "llamado",
  label: "Llamado a mesa",
  icon: "🔔",
  Component: Pantalla,
  publicPages: [{ path: "mesa/:mesa", Component: PaginaMesa }],
};
export default mod;
