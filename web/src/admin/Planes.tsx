import { clp } from "../core/api";
import { MODULES } from "../../../shared/modules";
import { useData } from "./useData";
import type { Planes } from "./types";

const LIMITES: Record<string, string> = { usuarios: "Usuarios", mesas: "Mesas", locales: "Locales", facturas_mes: "Facturas/mes" };

export default function PlanesView() {
  const { data, error } = useData<Planes>("/planes");
  if (error) return <p className="chip bad">{error}</p>;
  if (!data) return <p className="muted">Cargando…</p>;
  return (
    <>
      <h2 className="display">Planes</h2>
      <p className="muted">Precios mensuales en CLP, IVA no incluido.</p>
      <div className="adm-planes">
        {data.planes.map((p) => (
          <article key={p.id} className="card stack adm-plan">
            <div className="between"><h3>{p.nombre}</h3><span className="chip off">{p.clientes} {p.clientes === 1 ? "cliente" : "clientes"}</span></div>
            <div><b className="kpi">{clp(p.precio_mensual)}</b><span className="muted"> /mes</span></div>
            {p.ficha?.precio_anual ? <span className="muted">Anual {clp(p.ficha.precio_anual)}{p.ficha.implementacion ? ` · Implementación ${clp(p.ficha.implementacion)}` : ""}</span> : null}
            {p.descripcion && <p className="muted">{p.descripcion}</p>}
            <ul className="adm-incl">
              {p.modulos_detalle.map((m) => <li key={m.id} className={m.incluido ? "si" : "no"}>{m.incluido ? "✓" : "—"} {m.nombre}</li>)}
            </ul>
            {p.ficha?.limites && (
              <div className="adm-lims">
                {Object.entries(p.ficha.limites).map(([k, v]) => <span key={k}><b>{v === null ? "∞" : v}</b> <span className="muted">{LIMITES[k] ?? k}</span></span>)}
              </div>
            )}
            {p.ficha?.locales_incluidos ? <span className="muted">Incluye {p.ficha.locales_incluidos} locales · {clp(p.ficha.precio_local_adicional ?? 0)} por local adicional</span> : null}
            {p.valor_addons > p.precio_mensual && <span className="muted">Por separado costaría {clp(p.valor_addons)}</span>}
            <div className="between adm-plan-foot"><span className="muted">{p.por_estado.activo} {p.por_estado.activo === 1 ? "activo" : "activos"} · {p.por_estado.prueba} en prueba · {p.por_estado.suspendido} susp.</span><b>MRR {clp(p.mrr)}</b></div>
          </article>
        ))}
      </div>
      <section className="card stack">
        <h3>Islas como add-on</h3>
        <div className="scroll-x">
          <table>
            <thead><tr><th>Isla</th><th>Requiere</th><th style={{ textAlign: "right" }}>Precio/mes</th></tr></thead>
            <tbody>
              {data.addons.map((a) => (
                <tr key={a.id}>
                  <td><b>{a.nombre}</b><br /><span className="muted">{a.descripcion}</span></td>
                  <td className="muted">{a.requiere.map((r) => MODULES.find((m) => m.id === r)?.nombre).join(", ") || "—"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{a.precio ? clp(a.precio) : "Incluida"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
