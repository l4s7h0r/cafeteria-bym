import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MODULES } from "../../../shared/modules";
import { clp } from "../core/api";
import { adminApi } from "./adminApi";
import { useData } from "./useData";
import { ESTADO_LABEL, ESTADO_CHIP, type Cliente, type EstadoCliente, type ModuloCliente, type Planes } from "./types";

const nombreDe = (id: string) => MODULES.find((m) => m.id === id)?.nombre ?? id;

function etiqueta(m: ModuloCliente) {
  if (m.estado === "plan") return <span className="chip">Incluida en el plan</span>;
  if (m.estado === "addon") return <span className="chip warn">Add-on +{clp(m.precio_addon)}</span>;
  if (m.estado === "bloqueado") return <span className="chip bad">Bloqueada</span>;
  return <span className="chip off">No incluida{m.precio_addon > 0 ? ` · add-on ${clp(m.precio_addon)}` : ""}</span>;
}

export default function ClienteDetalle() {
  const { slug = "" } = useParams();
  const { data: c, setData, error } = useData<Cliente>(`/clientes/${slug}`);
  const { data: planes } = useData<Planes>("/planes");
  const [msg, setMsg] = useState<{ tipo: "ok" | "bad" | "warn"; texto: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState({ nombre: "", contacto: "", ciudad: "" });

  useEffect(() => { if (c) setForm({ nombre: c.nombre, contacto: c.contacto ?? "", ciudad: c.ciudad ?? "" }); }, [c?.id]);

  if (error) return <><Link to="/admin/clientes" className="muted">← Clientes</Link><p className="chip bad">{error}</p></>;
  if (!c) return <p className="muted">Cargando…</p>;

  const guardar = async (key: string, fn: () => Promise<Cliente>, ok: string) => {
    setBusy(key); setMsg(null);
    try {
      const nuevo = await fn();
      setData(nuevo);
      setMsg(nuevo.avisos?.length ? { tipo: "warn", texto: `${ok}. ${nuevo.avisos.join(" ")}` } : { tipo: "ok", texto: ok });
    } catch (e) {
      setMsg({ tipo: "bad", texto: (e as Error).message });
    } finally { setBusy(""); }
  };
  const patch = (body: object, ok: string, key: string) => guardar(key, () => adminApi.patch<Cliente>(`/clientes/${slug}`, body), ok);
  const modulo = (m: ModuloCliente, estado: "on" | "off" | "plan") =>
    guardar(m.id, () => adminApi.put<Cliente>(`/clientes/${slug}/modulos/${m.id}`, { estado }),
      estado === "plan" ? `${m.nombre} volvió a lo que da el plan` : `${m.nombre} ${estado === "on" ? "activada" : "apagada"}`);
  const datosCambiados = form.nombre !== c.nombre || form.contacto !== (c.contacto ?? "") || form.ciudad !== (c.ciudad ?? "");

  return (
    <>
      <Link to="/admin/clientes" className="muted adm-back">← Clientes</Link>
      <div className="card dark stack">
        <div className="between">
          <div className="stack" style={{ gap: 4 }}>
            <h2 className="display">{c.nombre}</h2>
            <span className="muted adm-on-dark">/{c.slug}{c.ciudad ? ` · ${c.ciudad}` : ""}{c.contacto ? ` · ${c.contacto}` : ""}</span>
          </div>
          <span className={ESTADO_CHIP[c.estado]}>{ESTADO_LABEL[c.estado]}</span>
        </div>
        <div className="between adm-tarifa">
          <div><span className="muted adm-on-dark">Paga al mes</span><b className="adm-hero-num">{clp(c.tarifa)}</b></div>
          <span className="muted adm-on-dark" style={{ textAlign: "right" }}>Plan {c.plan.nombre} {clp(c.precio_plan)}{c.monto_addons > 0 && <><br />Add-ons {clp(c.monto_addons)}</>}{c.estado !== "activo" && <><br />No suma al MRR</>}</span>
        </div>
        <a className="btn alt" href={`/c/${c.slug}`} target="_blank" rel="noreferrer">Entrar como cliente ↗</a>
      </div>

      {msg && <div className={`adm-msg ${msg.tipo}`} role="status">{msg.texto}</div>}

      <section className="card stack">
        <h3>Estado de la cuenta</h3>
        <div className="adm-seg" role="radiogroup">
          {(Object.keys(ESTADO_LABEL) as EstadoCliente[]).map((e) => (
            <button key={e} role="radio" aria-checked={c.estado === e} className={c.estado === e ? `on ${e}` : ""} disabled={!!busy}
              onClick={() => c.estado !== e && patch({ estado: e }, `Estado cambiado a ${ESTADO_LABEL[e].toLowerCase()}`, "estado")}>{ESTADO_LABEL[e]}</button>
          ))}
        </div>
        {c.estado !== "activo" && <p className="muted">Mientras no esté activo, el cliente no tiene acceso a ninguna isla.</p>}
      </section>

      <section className="card stack">
        <h3>Plan</h3>
        <div className="stack" style={{ gap: 8 }}>
          {(planes?.planes ?? []).map((p) => (
            <label key={p.id} className={`adm-plan-opt${p.id === c.plan.id ? " on" : ""}`}>
              <input type="radio" name="plan" checked={p.id === c.plan.id} disabled={!!busy}
                onChange={() => patch({ plan_id: p.id }, `Plan cambiado a ${p.nombre}`, "plan")} />
              <span className="adm-plan-txt"><b>{p.nombre}</b><span className="muted">{p.modulos.map(nombreDe).join(", ")}</span></span>
              <b>{clp(p.precio_mensual)}</b>
            </label>
          ))}
        </div>
        <p className="muted">Al cambiar de plan se limpian los add-ons que pasan a estar incluidos y los bloqueos de islas que el nuevo plan no trae.</p>
      </section>

      <section className="card stack">
        <h3>Islas</h3>
        {c.modulos.map((m) => {
          const req = MODULES.find((x) => x.id === m.id)?.requiere ?? [];
          return (
            <div key={m.id} className="adm-mod">
              <div className="adm-mod-txt">
                <b>{m.nombre}</b>
                <div className="row" style={{ gap: 6 }}>{etiqueta(m)}{req.length > 0 && <span className="muted">Requiere {req.map(nombreDe).join(", ")}</span>}</div>
                {m.sin_requisitos.length > 0 && <span className="adm-warn-txt">Apagada: falta {m.sin_requisitos.map(nombreDe).join(", ")}</span>}
                {(m.estado === "addon" || m.estado === "bloqueado") && (
                  <button className="adm-link" disabled={!!busy} onClick={() => modulo(m, "plan")}>Volver a lo del plan</button>
                )}
              </div>
              <label className="adm-switch" aria-label={`${m.encendido ? "Apagar" : "Activar"} ${m.nombre}`}>
                <input type="checkbox" checked={m.encendido} disabled={!!busy} onChange={(e) => modulo(m, e.target.checked ? "on" : "off")} />
                <span />
              </label>
            </div>
          );
        })}
      </section>

      <section className="card stack">
        <h3>Datos del cliente</h3>
        <label className="stack adm-field"><span className="muted">Nombre</span><input className="input" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></label>
        <label className="stack adm-field"><span className="muted">Contacto</span><input className="input" value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} /></label>
        <label className="stack adm-field"><span className="muted">Ciudad</span><input className="input" value={form.ciudad} onChange={(e) => setForm({ ...form, ciudad: e.target.value })} /></label>
        <button className="btn" disabled={!datosCambiados || !!busy} onClick={() => patch(form, "Datos guardados", "datos")}>Guardar datos</button>
        <span className="muted">Cliente desde {new Date(c.creado_en.replace(" ", "T") + "Z").toLocaleDateString("es-CL")}</span>
      </section>
    </>
  );
}
