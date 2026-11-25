import { Link, useNavigate } from "react-router-dom";
import { MODULES } from "../../../shared/modules";
import { clp } from "../core/api";
import { useData } from "./useData";
import { ESTADO_CHIP, ESTADO_LABEL, type Cliente, type EstadoModulo } from "./types";

export const CELDA: Record<EstadoModulo, { sym: string; cls: string; title: string }> = {
  plan: { sym: "✓", cls: "plan", title: "Incluida en el plan" },
  addon: { sym: "+", cls: "addon", title: "Add-on" },
  bloqueado: { sym: "✕", cls: "bloq", title: "Bloqueada" },
  no: { sym: "—", cls: "no", title: "No incluida" },
};

export default function ClientesView() {
  const { data, error } = useData<Cliente[]>("/clientes");
  const nav = useNavigate();
  if (error) return <p className="chip bad">{error}</p>;
  if (!data) return <p className="muted">Cargando…</p>;
  return (
    <>
      <div className="between"><h2 className="display">Clientes <span className="muted">({data.length})</span></h2><Link className="btn alt" to="/admin/clientes/nuevo">+ Cliente</Link></div>
      <div className="card adm-matrix-card">
        <div className="scroll-x adm-matrix">
          <table>
            <thead>
              <tr>
                <th className="sticky">Cliente</th>
                {MODULES.map((m) => <th key={m.id} className="c" title={m.nombre}>{m.nombre.split(" ")[0]}</th>)}
                <th className="r">MRR</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.slug} onClick={() => nav(`/admin/clientes/${c.slug}`)}>
                  <td className="sticky">
                    <Link to={`/admin/clientes/${c.slug}`} className="adm-cli">{c.nombre}</Link>
                    <span className="adm-sub"><span className="muted">{c.plan.nombre}</span> {c.estado !== "activo" && <span className={ESTADO_CHIP[c.estado]}>{ESTADO_LABEL[c.estado]}</span>}</span>
                  </td>
                  {c.modulos.map((m) => {
                    const k = CELDA[m.estado];
                    const apagadaPorReq = m.sin_requisitos.length > 0;
                    return (
                      <td key={m.id} className="c">
                        <span className={`adm-cell ${k.cls}${apagadaPorReq ? " req" : ""}`} title={apagadaPorReq ? `${k.title} (apagada: falta requisito)` : k.title}>{k.sym}</span>
                      </td>
                    );
                  })}
                  <td className="r">{c.estado === "activo" ? clp(c.mrr) : <span className="muted">{clp(0)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="adm-hint">Desliza la tabla para ver todas las islas →</p>
        <div className="adm-legend">
          {Object.values(CELDA).map((k) => <span key={k.cls}><span className={`adm-cell ${k.cls}`}>{k.sym}</span> {k.title.replace("Incluida en el plan", "Plan")}</span>)}
        </div>
      </div>
      <p className="muted">Toca un cliente para cambiar su plan, estado o islas. El MRR solo cuenta clientes activos.</p>
    </>
  );
}
