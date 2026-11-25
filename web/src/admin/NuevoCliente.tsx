import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { clp } from "../core/api";
import { adminApi } from "./adminApi";
import { useData } from "./useData";
import { ESTADO_LABEL, type Cliente, type EstadoCliente, type Planes } from "./types";

export default function NuevoCliente() {
  const nav = useNavigate();
  const { data: planes } = useData<Planes>("/planes");
  const [f, setF] = useState({ nombre: "", slug: "", contacto: "", ciudad: "", plan_id: "basico", estado: "prueba" as EstadoCliente });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const crear = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const c = await adminApi.post<Cliente>("/clientes", { ...f, slug: f.slug || undefined });
      nav(`/admin/clientes/${c.slug}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <>
      <Link to="/admin/clientes" className="muted adm-back">← Clientes</Link>
      <h2 className="display">Nuevo cliente</h2>
      <form className="card stack" onSubmit={crear}>
        <label className="stack adm-field"><span className="muted">Nombre del local *</span><input className="input" required value={f.nombre} onChange={set("nombre")} placeholder="Ej: Café Ñuñoa" /></label>
        <label className="stack adm-field"><span className="muted">Identificador (opcional, se genera del nombre)</span><input className="input" value={f.slug} onChange={set("slug")} placeholder="cafe-nunoa" /></label>
        <label className="stack adm-field"><span className="muted">Contacto</span><input className="input" value={f.contacto} onChange={set("contacto")} /></label>
        <label className="stack adm-field"><span className="muted">Ciudad</span><input className="input" value={f.ciudad} onChange={set("ciudad")} /></label>
        <label className="stack adm-field"><span className="muted">Plan</span>
          <select className="input" value={f.plan_id} onChange={set("plan_id")}>
            {(planes?.planes ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre} · {clp(p.precio_mensual)}/mes</option>)}
          </select>
        </label>
        <label className="stack adm-field"><span className="muted">Estado inicial</span>
          <select className="input" value={f.estado} onChange={set("estado")}>
            {(Object.keys(ESTADO_LABEL) as EstadoCliente[]).map((e) => <option key={e} value={e}>{ESTADO_LABEL[e]}</option>)}
          </select>
        </label>
        {err && <div className="adm-msg bad">{err}</div>}
        <button className="btn alt" disabled={busy}>{busy ? "Creando…" : "Crear cliente"}</button>
      </form>
    </>
  );
}
