import { Link } from "react-router-dom";
import { clp } from "../core/api";
import { useData } from "./useData";
import type { Resumen } from "./types";

export default function ResumenView() {
  const { data: r, error } = useData<Resumen>("/resumen");
  if (error) return <p className="chip bad">{error}</p>;
  if (!r) return <p className="muted">Cargando…</p>;
  const maxPlan = Math.max(1, ...r.por_plan.map((p) => p.clientes));
  return (
    <>
      <div className="between"><h2 className="display">Resumen</h2><Link className="btn alt" to="/admin/clientes/nuevo">+ Cliente</Link></div>

      <div className="card dark adm-hero">
        <span className="muted adm-on-dark">MRR (ingreso mensual recurrente)</span>
        <b className="adm-hero-num">{clp(r.mrr)}</b>
        <span className="muted adm-on-dark">Planes {clp(r.mrr_planes)} · Add-ons {clp(r.mrr_addons)} · IVA no incluido</span>
      </div>

      <div className="adm-kpis">
        <div className="card"><span className="muted">Clientes activos</span><div className="kpi">{r.por_estado.activo}<small className="muted"> / {r.total_clientes}</small></div></div>
        <div className="card"><span className="muted">Ticket promedio</span><div className="kpi">{clp(r.ticket_promedio)}</div></div>
        <div className="card"><span className="muted">En prueba</span><div className="kpi">{r.por_estado.prueba}</div>{r.mrr_prueba > 0 && <span className="muted">Potencial {clp(r.mrr_prueba)}</span>}</div>
        <div className="card"><span className="muted">Suspendidos</span><div className="kpi">{r.por_estado.suspendido}</div></div>
      </div>

      <section className="card stack">
        <h3>Clientes por plan</h3>
        {r.por_plan.map((p) => (
          <div key={p.id} className="adm-bar-row">
            <div className="between"><b>{p.nombre} <span className="muted">{clp(p.precio_mensual)}/mes</span></b><span>{p.clientes} {p.clientes === 1 ? "cliente" : "clientes"}</span></div>
            <div className="adm-bar"><i style={{ width: `${(p.clientes / maxPlan) * 100}%` }} /></div>
            <span className="muted">{p.activos} {p.activos === 1 ? "activo" : "activos"} · MRR {clp(p.mrr)}</span>
          </div>
        ))}
      </section>

      <section className="card stack">
        <h3>Adopción por isla <span className="muted">(clientes activos que la usan)</span></h3>
        {r.adopcion.map((m) => {
          const pct = m.total_activos ? Math.round((m.activos / m.total_activos) * 100) : 0;
          return (
            <div key={m.id} className="adm-bar-row">
              <div className="between"><b>{m.nombre}</b><span>{m.activos}/{m.total_activos} · {pct}%</span></div>
              <div className="adm-bar"><i style={{ width: `${pct}%` }} /></div>
              {(m.addons > 0 || m.bloqueos > 0) && (
                <span className="muted">{m.addons > 0 && `${m.addons} como add-on`}{m.addons > 0 && m.bloqueos > 0 && " · "}{m.bloqueos > 0 && `${m.bloqueos} bloqueada${m.bloqueos > 1 ? "s" : ""}`}</span>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}
