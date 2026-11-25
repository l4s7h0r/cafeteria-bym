import { useEffect, useMemo, useState } from "react";
import type { Api, ClientModule, ModuleProps } from "../../core/types";
import { clp } from "../../core/api";
import "./conta.css";

// ---------- catálogos (espejo de server/modules/contabilidad/catalogo.ts) ----------
type Medio = "efectivo" | "debito" | "credito" | "transferencia";
type Categoria = "insumos" | "sueldos" | "arriendo" | "servicios" | "mantencion" | "otros";
const MEDIOS: { id: Medio; label: string; ic: string }[] = [
  { id: "debito", label: "Débito", ic: "💳" },
  { id: "efectivo", label: "Efectivo", ic: "💵" },
  { id: "credito", label: "Crédito", ic: "💳" },
  { id: "transferencia", label: "Transferencia", ic: "📲" },
];
const CATEGORIAS: { id: Categoria; label: string; ic: string }[] = [
  { id: "insumos", label: "Insumos", ic: "☕" },
  { id: "sueldos", label: "Sueldos", ic: "👥" },
  { id: "arriendo", label: "Arriendo", ic: "🏠" },
  { id: "servicios", label: "Servicios básicos", ic: "💡" },
  { id: "mantencion", label: "Mantención", ic: "🔧" },
  { id: "otros", label: "Otros", ic: "📦" },
];
const medioLabel = (m: string) => MEDIOS.find((x) => x.id === m)?.label ?? m;
const catInfo = (c: string) => CATEGORIAS.find((x) => x.id === c) ?? { id: c, label: c, ic: "📦" };

// ---------- fechas ----------
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaCorta(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const h = ymd(new Date());
  const ay = new Date(); ay.setDate(ay.getDate() - 1);
  if (s === h) return "Hoy";
  if (s === ymd(ay)) return "Ayer";
  return `${DIAS[dt.getDay()]} ${d} ${MESES[m - 1]}`;
}

type PeriodoId = "hoy" | "semana" | "mes" | "mesPasado";
const PERIODOS: { id: PeriodoId; label: string }[] = [
  { id: "hoy", label: "Hoy" }, { id: "semana", label: "Últimos 7 días" }, { id: "mes", label: "Este mes" }, { id: "mesPasado", label: "Mes pasado" },
];
function rangoDe(p: PeriodoId) {
  const t = new Date();
  if (p === "hoy") return { desde: ymd(t), hasta: ymd(t) };
  if (p === "semana") { const d = new Date(t); d.setDate(d.getDate() - 6); return { desde: ymd(d), hasta: ymd(t) }; }
  if (p === "mes") return { desde: ymd(new Date(t.getFullYear(), t.getMonth(), 1)), hasta: ymd(t) };
  return { desde: ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), hasta: ymd(new Date(t.getFullYear(), t.getMonth(), 0)) };
}

// Monto escrito con puntos de miles mientras se tipea
const soloDigitos = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "").slice(0, 10);
const conPuntos = (s: string) => (s ? Number(s).toLocaleString("es-CL") : "");

// ---------- tipos de la API ----------
interface Resumen {
  ingresos: number; egresos: number; propinas: number; resultado: number;
  ventas_sin_boleta: { monto: number; cantidad: number };
  gastos_sin_documento: { monto: number; cantidad: number };
  iva_ventas_estimado: number;
  por_medio: { medio: string; label: string; monto: number }[];
  por_categoria: { categoria: string; label: string; monto: number }[];
}
interface Movimiento { tipo: "ingreso" | "egreso"; id: number; fecha: string; monto: number; clase: string; proveedor: string | null; descripcion: string | null; con_documento: number }
interface PropinaDia { id: number; fecha: string; total: number; modo: string; nota: string | null; reparto: { garzon: string; monto: number }[] }
interface Propinas { total: number; dias: PropinaDia[]; por_garzon: { garzon: string; monto: number; dias: number }[] }

// =====================================================================
function Pantalla({ tenant, api }: ModuleProps) {
  const [tab, setTab] = useState<"mov" | "propinas">("mov");
  const [periodo, setPeriodo] = useState<PeriodoId>("mes");
  const [version, setVersion] = useState(0);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const { desde, hasta } = useMemo(() => rangoDe(periodo), [periodo]);
  const recargar = () => setVersion((v) => v + 1);

  useEffect(() => {
    let vivo = true;
    api.get<Resumen>(`/resumen?desde=${desde}&hasta=${hasta}`).then((r) => vivo && setResumen(r)).catch(() => vivo && setResumen(null));
    return () => { vivo = false; };
    // api se recrea en cada render del contenedor; dependemos del cliente
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.slug, desde, hasta, version]);

  return (
    <div className="stack">
      <div className="between">
        <h2 className="display" style={{ fontSize: 22 }}>Contabilidad</h2>
        <span className="muted">{tenant.nombre}</span>
      </div>
      <div className="cb-chips scroll" role="group" aria-label="Periodo">
        {PERIODOS.map((p) => <button key={p.id} aria-pressed={periodo === p.id} onClick={() => setPeriodo(p.id)}>{p.label}</button>)}
      </div>

      <Kpis r={resumen} />

      <div className="cb-seg" role="tablist">
        <button aria-pressed={tab === "mov"} onClick={() => setTab("mov")}>Ingresos y gastos</button>
        <button aria-pressed={tab === "propinas"} onClick={() => setTab("propinas")}>Propinas</button>
      </div>

      {tab === "mov" ? (
        <div className="cb-cols">
          <FormMovimiento api={api} onSaved={recargar} />
          <div className="stack">
            <ListaMovimientos api={api} slug={tenant.slug} desde={desde} hasta={hasta} version={version} onChange={recargar} />
            {resumen && <EnQueSeVa r={resumen} />}
          </div>
        </div>
      ) : (
        <TabPropinas api={api} slug={tenant.slug} desde={desde} hasta={hasta} version={version} onChange={recargar} />
      )}
    </div>
  );
}

// ---------- KPIs ----------
function Kpis({ r }: { r: Resumen | null }) {
  if (!r) return <div className="cb-tiles"><div className="cb-tile dif"><span className="muted">Cargando…</span></div></div>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="cb-tiles">
        <div className="cb-tile ing"><span className="lbl"><i className="cb-dot" style={{ background: "#2E8B5E" }} />Ingresos</span><span className="val">{clp(r.ingresos)}</span></div>
        <div className="cb-tile gas"><span className="lbl"><i className="cb-dot" style={{ background: "#E08A2E" }} />Gastos</span><span className="val">{clp(r.egresos)}</span></div>
        <div className="cb-tile dif">
          <span className="lbl">Ingresos menos gastos</span>
          <span className="val" style={r.resultado < 0 ? { color: "#FF9B8A" } : undefined}>{clp(r.resultado)}</span>
          {r.iva_ventas_estimado > 0 && <span className="muted">De esto, cerca de {clp(r.iva_ventas_estimado)} es IVA de las ventas con boleta.</span>}
        </div>
      </div>
      <div className="row">
        <span className="chip">🤝 Propinas {clp(r.propinas)} · para el equipo, no suman a ventas</span>
        {r.ventas_sin_boleta.cantidad > 0 && <span className="chip warn">{r.ventas_sin_boleta.cantidad} ventas sin boleta ({clp(r.ventas_sin_boleta.monto)})</span>}
        {r.gastos_sin_documento.cantidad > 0 && <span className="chip warn">{r.gastos_sin_documento.cantidad} gastos sin documento</span>}
      </div>
    </div>
  );
}

// ---------- Formulario rápido ----------
function FormMovimiento({ api, onSaved }: { api: Api; onSaved: () => void }) {
  const [tipo, setTipo] = useState<"ingreso" | "egreso">("ingreso");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(ymd(new Date()));
  const [medio, setMedio] = useState<Medio>("debito");
  const [boleta, setBoleta] = useState(true);
  const [categoria, setCategoria] = useState<Categoria>("insumos");
  const [proveedor, setProveedor] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!monto) return setMsg({ ok: false, t: "Escribe el monto." });
    setEnviando(true);
    try {
      if (tipo === "ingreso") await api.post("/ingresos", { fecha, monto: Number(monto), medio, con_boleta: boleta, descripcion });
      else await api.post("/egresos", { fecha, monto: Number(monto), categoria, proveedor, descripcion, con_documento: boleta });
      setMsg({ ok: true, t: `${tipo === "ingreso" ? "Ingreso" : "Gasto"} de ${clp(Number(monto))} registrado.` });
      setMonto(""); setDescripcion(""); setProveedor("");
      onSaved();
    } catch (err: any) {
      setMsg({ ok: false, t: err.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="card stack" onSubmit={guardar}>
      <div className="between"><h3 className="cb-h2">Registrar movimiento</h3><span className="muted">rápido</span></div>
      <div className="cb-seg">
        <button type="button" aria-pressed={tipo === "ingreso"} onClick={() => { setTipo("ingreso"); setMsg(null); }}>＋ Ingreso</button>
        <button type="button" aria-pressed={tipo === "egreso"} onClick={() => { setTipo("egreso"); setMsg(null); }}>− Gasto</button>
      </div>
      <div className="cb-form">
        <label className="cb-field span2">Monto
          <input className="input cb-monto" inputMode="numeric" placeholder="$0" value={monto ? "$" + conPuntos(monto) : ""} onChange={(e) => setMonto(soloDigitos(e.target.value))} aria-label="Monto en pesos" />
        </label>
        {tipo === "ingreso" ? (
          <div className="cb-field span2">¿Cómo pagaron?
            <div className="cb-chips">{MEDIOS.map((m) => <button type="button" key={m.id} aria-pressed={medio === m.id} onClick={() => setMedio(m.id)}>{m.label}</button>)}</div>
          </div>
        ) : (
          <>
            <div className="cb-field span2">Tipo de gasto
              <div className="cb-chips">{CATEGORIAS.map((c) => <button type="button" key={c.id} aria-pressed={categoria === c.id} onClick={() => setCategoria(c.id)}>{c.ic} {c.label}</button>)}</div>
            </div>
            <label className="cb-field span2">Proveedor (opcional)
              <input className="input" value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Ej: Lácteos del Sur" maxLength={80} />
            </label>
          </>
        )}
        <label className="cb-field">Fecha
          <input className="input" type="date" value={fecha} max={ymd(new Date())} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <div className="cb-field">{tipo === "ingreso" ? "Boleta" : "Documento"}
          <div className="cb-seg">
            <button type="button" aria-pressed={boleta} onClick={() => setBoleta(true)}>Sí</button>
            <button type="button" aria-pressed={!boleta} onClick={() => setBoleta(false)}>No</button>
          </div>
        </div>
        <label className="cb-field span2">Detalle (opcional)
          <input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder={tipo === "ingreso" ? "Ej: Cierre de caja, pedido de oficina" : "Ej: Café en grano 5 kg"} maxLength={120} />
        </label>
      </div>
      {!boleta && <p className="muted">Quedará marcado como {tipo === "ingreso" ? "venta sin boleta" : "gasto sin documento"}.</p>}
      {msg && <div className={`cb-msg ${msg.ok ? "ok" : "err"}`} role="status">{msg.t}</div>}
      <button className={`btn cb-big ${tipo === "ingreso" ? "alt" : ""}`} disabled={enviando}>
        {enviando ? "Guardando…" : tipo === "ingreso" ? "Registrar ingreso" : "Registrar gasto"}
      </button>
    </form>
  );
}

// ---------- Lista reciente ----------
function ListaMovimientos({ api, slug, desde, hasta, version, onChange }: { api: Api; slug: string; desde: string; hasta: string; version: number; onChange: () => void }) {
  const [filtro, setFiltro] = useState<"todos" | "ingreso" | "egreso">("todos");
  const [items, setItems] = useState<Movimiento[] | null>(null);
  const [limite, setLimite] = useState(12);

  useEffect(() => {
    let vivo = true;
    api.get<Movimiento[]>(`/movimientos?desde=${desde}&hasta=${hasta}&limit=${limite * 3}`).then((r) => vivo && setItems(r)).catch(() => vivo && setItems([]));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, desde, hasta, version, limite]);

  const visibles = (items ?? []).filter((m) => filtro === "todos" || m.tipo === filtro);

  async function borrar(m: Movimiento) {
    if (!confirm(`¿Borrar ${m.tipo === "ingreso" ? "el ingreso" : "el gasto"} de ${clp(m.monto)}?`)) return;
    try { await api.del(`/${m.tipo === "ingreso" ? "ingresos" : "egresos"}/${m.id}`); onChange(); } catch (e: any) { alert(e.message); }
  }

  return (
    <section className="card stack">
      <div className="between"><h3 className="cb-h2">Últimos movimientos</h3><span className="muted">{items ? `${visibles.length} en el periodo` : ""}</span></div>
      <div className="cb-chips">
        {(["todos", "ingreso", "egreso"] as const).map((f) => <button key={f} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>{f === "todos" ? "Todos" : f === "ingreso" ? "Ingresos" : "Gastos"}</button>)}
      </div>
      {!items ? <div className="cb-empty">Cargando…</div> : visibles.length === 0 ? <div className="cb-empty">No hay movimientos en este periodo.</div> : (
        <ul className="cb-list">
          {visibles.slice(0, limite).map((m) => {
            const ing = m.tipo === "ingreso";
            const titulo = ing ? medioLabel(m.clase) : (m.descripcion || catInfo(m.clase).label);
            const sub = ing ? `${fechaCorta(m.fecha)}${m.descripcion ? " · " + m.descripcion : ""}` : `${fechaCorta(m.fecha)} · ${catInfo(m.clase).label}${m.proveedor ? " · " + m.proveedor : ""}`;
            return (
              <li key={m.tipo + m.id}>
                <span className={`cb-ic ${ing ? "ing" : "gas"}`} aria-hidden>{ing ? MEDIOS.find((x) => x.id === m.clase)?.ic ?? "💵" : catInfo(m.clase).ic}</span>
                <span className="cb-grow">
                  <span className="cb-name">{titulo}</span>
                  <span className="muted">{sub}{!m.con_documento && <> · <b className="cb-neg">{ing ? "sin boleta" : "sin documento"}</b></>}</span>
                </span>
                <span className={`cb-amount ${ing ? "cb-pos" : "cb-neg"}`}>{ing ? "+" : "−"}{clp(m.monto)}</span>
                <button className="cb-x" title="Borrar" aria-label={`Borrar ${m.tipo}`} onClick={() => borrar(m)}>×</button>
              </li>
            );
          })}
        </ul>
      )}
      {items && visibles.length > limite && <button className="btn ghost" onClick={() => setLimite((l) => l + 20)}>Ver más</button>}
    </section>
  );
}

// ---------- ¿En qué se va la plata? ----------
function EnQueSeVa({ r }: { r: Resumen }) {
  const cats = r.por_categoria.filter((c) => c.monto > 0);
  const maxM = Math.max(1, ...r.por_medio.map((m) => m.monto));
  return (
    <section className="card stack">
      <div className="between"><h3 className="cb-h2">¿En qué se va la plata?</h3><span className="muted">{clp(r.egresos)}</span></div>
      {cats.length === 0 ? <div className="cb-empty">Sin gastos en este periodo.</div> : cats.map((c) => {
        const pct = r.egresos ? (c.monto / r.egresos) * 100 : 0;
        return (
          <div key={c.categoria} className="stack" style={{ gap: 4 }} title={`${c.label}: ${clp(c.monto)} (${pct.toFixed(1)}%)`}>
            <div className="between"><span style={{ fontSize: 14 }}>{catInfo(c.categoria).ic} {c.label}</span><span style={{ fontSize: 14, fontWeight: 700 }}>{clp(c.monto)} <span className="muted">{Math.round(pct)}%</span></span></div>
            <div className="cb-bar"><i style={{ width: `${pct}%`, background: "#E08A2E" }} /></div>
          </div>
        );
      })}
      <div className="between" style={{ marginTop: 6 }}><h3 className="cb-h2">Ingresos por medio de pago</h3></div>
      {r.por_medio.map((m) => (
        <div key={m.medio} className="stack" style={{ gap: 4 }} title={`${m.label}: ${clp(m.monto)}`}>
          <div className="between"><span style={{ fontSize: 14 }}>{m.label}</span><span style={{ fontSize: 14, fontWeight: 700 }}>{clp(m.monto)} <span className="muted">{r.ingresos ? Math.round((m.monto / r.ingresos) * 100) : 0}%</span></span></div>
          <div className="cb-bar"><i style={{ width: `${(m.monto / maxM) * 100}%` }} /></div>
        </div>
      ))}
    </section>
  );
}

// ---------- Propinas ----------
function TabPropinas({ api, slug, desde, hasta, version, onChange }: { api: Api; slug: string; desde: string; hasta: string; version: number; onChange: () => void }) {
  const [data, setData] = useState<Propinas | null>(null);
  const [garzones, setGarzones] = useState<string[]>([]);
  useEffect(() => {
    let vivo = true;
    api.get<Propinas>(`/propinas?desde=${desde}&hasta=${hasta}`).then((r) => vivo && setData(r)).catch(() => vivo && setData(null));
    api.get<string[]>(`/garzones`).then((g) => vivo && setGarzones(g)).catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, desde, hasta, version]);

  async function borrar(p: PropinaDia) {
    if (!confirm(`¿Borrar las propinas del ${fechaCorta(p.fecha).toLowerCase()} (${clp(p.total)})?`)) return;
    try { await api.del(`/propinas/${p.id}`); onChange(); } catch (e: any) { alert(e.message); }
  }

  const maxG = Math.max(1, ...(data?.por_garzon ?? []).map((g) => g.monto));
  return (
    <div className="cb-cols">
      <FormPropina api={api} garzones={garzones} onSaved={onChange} />
      <div className="stack">
        <section className="card stack">
          <div className="between"><h3 className="cb-h2">Por garzón</h3><span className="muted">{data ? clp(data.total) + " en el periodo" : ""}</span></div>
          {!data ? <div className="cb-empty">Cargando…</div> : data.por_garzon.length === 0 ? <div className="cb-empty">Sin propinas en este periodo.</div> : (
            <ul className="cb-list">
              {data.por_garzon.map((g, i) => (
                <li key={g.garzon}>
                  <span className={`cb-rank ${i === 0 ? "r1" : ""}`}>{i + 1}</span>
                  <span className="cb-grow stack" style={{ gap: 4 }}>
                    <span className="between"><span className="cb-name">{g.garzon}</span><span className="cb-amount">{clp(g.monto)}</span></span>
                    <span className="cb-bar"><i style={{ width: `${(g.monto / maxG) * 100}%` }} /></span>
                    <span className="muted">{g.dias} {g.dias === 1 ? "día" : "días"} · promedio {clp(g.monto / g.dias)} por día</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card stack">
          <h3 className="cb-h2">Día por día</h3>
          {data && data.dias.length === 0 && <div className="cb-empty">Sin registros.</div>}
          <ul className="cb-list">
            {(data?.dias ?? []).slice(0, 14).map((p) => (
              <li key={p.id}>
                <span className="cb-grow">
                  <span className="between"><span className="cb-name">{fechaCorta(p.fecha)}</span><span className="cb-amount">{clp(p.total)}</span></span>
                  <span className="cb-reparto">{p.reparto.map((r) => <span key={r.garzon}>{r.garzon} {clp(r.monto)}</span>)}</span>
                  {p.nota && <span className="muted">{p.nota}</span>}
                </span>
                <button className="cb-x" title="Borrar" aria-label="Borrar propina" onClick={() => borrar(p)}>×</button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function FormPropina({ api, garzones, onSaved }: { api: Api; garzones: string[]; onSaved: () => void }) {
  const [fecha, setFecha] = useState(ymd(new Date()));
  const [total, setTotal] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [extra, setExtra] = useState<string[]>([]);
  const [nuevo, setNuevo] = useState("");
  const [manual, setManual] = useState(false);
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const todos = [...new Set([...garzones, ...extra])];
  const toggle = (g: string) => setSel((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]));
  const parte = sel.length && total ? Math.floor(Number(total) / sel.length / 10) * 10 : 0;
  const sumaManual = sel.reduce((a, g) => a + Number(montos[g] || 0), 0);

  function agregar() {
    const n = nuevo.trim();
    if (!n) return;
    setExtra((e) => [...e, n]);
    setSel((s) => (s.includes(n) ? s : [...s, n]));
    setNuevo("");
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (!sel.length) throw new Error("Elige quiénes trabajaron.");
      const body = manual
        ? { fecha, reparto: sel.map((g) => ({ garzon: g, monto: Number(montos[g] || 0) })) }
        : { fecha, total: Number(total), garzones: sel };
      const r = await api.post<{ total: number }>("/propinas", body);
      setMsg({ ok: true, t: `Propinas por ${clp(r.total)} repartidas entre ${sel.length}.` });
      setTotal(""); setMontos({});
      onSaved();
    } catch (err: any) {
      setMsg({ ok: false, t: err.message });
    }
  }

  return (
    <form className="card stack" onSubmit={guardar}>
      <div className="between"><h3 className="cb-h2">Repartir propinas</h3><span className="muted">no suman a ventas</span></div>
      <div className="cb-seg">
        <button type="button" aria-pressed={!manual} onClick={() => setManual(false)}>Partes iguales</button>
        <button type="button" aria-pressed={manual} onClick={() => setManual(true)}>A mano</button>
      </div>
      <div className="cb-form">
        {!manual && (
          <label className="cb-field span2">Total del día
            <input className="input cb-monto" inputMode="numeric" placeholder="$0" value={total ? "$" + conPuntos(total) : ""} onChange={(e) => setTotal(soloDigitos(e.target.value))} />
          </label>
        )}
        <label className="cb-field span2">Fecha
          <input className="input" type="date" value={fecha} max={ymd(new Date())} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <div className="cb-field span2">¿Quiénes trabajaron?
          <div className="cb-chips">
            {todos.map((g) => <button type="button" key={g} aria-pressed={sel.includes(g)} onClick={() => toggle(g)}>{g}</button>)}
          </div>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input className="input" value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Agregar garzón" maxLength={40}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregar(); } }} />
            <button type="button" className="btn ghost" onClick={agregar}>Agregar</button>
          </div>
        </div>
      </div>
      {sel.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="muted">{manual ? "Monto para cada uno" : "Reparto"}</span>
          {sel.map((g, i) => (
            <div key={g} className="between">
              <span style={{ fontSize: 14, fontWeight: 600 }}>{g}</span>
              {manual ? (
                <input className="input" style={{ maxWidth: 150, textAlign: "right" }} inputMode="numeric" placeholder="$0"
                  value={montos[g] ? "$" + conPuntos(montos[g]) : ""} onChange={(e) => setMontos((m) => ({ ...m, [g]: soloDigitos(e.target.value) }))} />
              ) : (
                <b>{clp(i === 0 ? Number(total || 0) - parte * (sel.length - 1) : parte)}</b>
              )}
            </div>
          ))}
          {manual && <div className="between" style={{ borderTop: "1px solid var(--borde)", paddingTop: 8 }}><span>Total</span><b>{clp(sumaManual)}</b></div>}
        </div>
      )}
      {msg && <div className={`cb-msg ${msg.ok ? "ok" : "err"}`} role="status">{msg.t}</div>}
      <button className="btn alt cb-big">Guardar propinas</button>
    </form>
  );
}

const mod: ClientModule = { id: "contabilidad", label: "Contabilidad", icon: "💰", Component: Pantalla };
export default mod;
