import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Api, ClientModule, ModuleProps } from "../../core/types";
import { clp } from "../../core/api";

// Isla "facturas": escaneo (OCR real con Claude, o simulado si no hay API key) de facturas, boletas y otros comprobantes de gasto, revisión,
// confirmación como egreso, y catálogo de productos con último costo, historial e alertas de alza.

type TipoDoc = "factura" | "boleta" | "otro";
const TIPO_LABEL: Record<TipoDoc, string> = { factura: "Factura", boleta: "Boleta", otro: "Comprobante" };
const TIPO_ICONO: Record<TipoDoc, string> = { factura: "🧾", boleta: "🧾", otro: "📝" };
// Mismas categorías de egreso que la isla contabilidad
const CAT_EGRESO = [["insumos", "Insumos"], ["servicios", "Servicios básicos"], ["mantencion", "Mantención y aseo"], ["arriendo", "Arriendo"], ["sueldos", "Sueldos"], ["otros", "Otros"]] as const;
const catLabel = (c: string) => CAT_EGRESO.find(([v]) => v === c)?.[1] ?? c;

interface LineaRev { producto: string; cantidad: number; unidad: string; precio_unitario: number; total: number; costo_anterior: number | null; variacion_pct: number | null; alza: boolean; nuevo: boolean }
interface Extraida {
  tipo_doc: TipoDoc; categoria_egreso: string; descripcion?: string;
  proveedor: string; rut: string; giro: string; folio: string; fecha: string; categoria: string;
  neto: number; iva: number; total: number; condicion_pago: string; lineas: LineaRev[];
  confianza: number; motor: string; archivo: string | null; ejemplo: boolean; alza_pct: number; ocr_real?: boolean;
}
interface Factura { id: number; tipo_doc: TipoDoc; categoria_egreso: string; proveedor: string; rut: string; folio: string; fecha: string; categoria: string; neto: number; iva: number; total: number; estado: "pagada" | "por_pagar"; condicion_pago: string | null; archivo: string | null; egreso_id: number | null }
interface Producto { id: number; nombre: string; unidad: string; categoria: string | null; proveedor: string | null; ultimo_costo: number; costo_anterior: number | null; variacion_pct: number; ultima_compra: string | null; compras: number }
interface Resumen {
  por_pagar: { n: number; monto: number }; mes: { n: number; monto: number; iva: number }; por_tipo?: Record<TipoDoc, { n: number; monto: number }>; alzas: number; productos: number;
  proveedores: { proveedor: string; facturas: number; total: number }[]; alza_pct: number; contabilidad_conectada: boolean;
  ocr_real?: boolean; planilla?: boolean;
}

const fechaCl = (f: string) => { const [a, m, d] = f.split("-"); return `${d}-${m}-${a}`; };
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

function Pantalla({ api }: ModuleProps) {
  const [vista, setVista] = useState<"escanear" | "facturas" | "productos">("escanear");
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const cargarResumen = useCallback(() => { api.get<Resumen>("/resumen").then(setResumen).catch(() => {}); }, [api]);
  useEffect(() => { cargarResumen(); }, [cargarResumen]);

  return (
    <div className="stack">
      <div className="grid">
        <div className="card"><p className="muted">Gastos por pagar</p><p className="kpi">{clp(resumen?.por_pagar.monto ?? 0)}</p><p className="muted">{resumen?.por_pagar.n ?? 0} documentos</p></div>
        <div className="card"><p className="muted">Gastos del mes</p><p className="kpi">{clp(resumen?.mes.monto ?? 0)}</p>
          <p className="muted">{resumen?.por_tipo?.factura.n ?? 0} facturas · {resumen?.por_tipo?.boleta.n ?? 0} boletas · {resumen?.por_tipo?.otro.n ?? 0} otros · IVA crédito {clp(resumen?.mes.iva ?? 0)}</p></div>
        <div className="card" style={resumen?.alzas ? { background: "var(--naranjoClaro)", borderColor: "var(--naranjo)" } : undefined}>
          <p className="muted">Productos que subieron</p><p className="kpi">{resumen?.alzas ?? 0}</p><p className="muted">más de {resumen?.alza_pct ?? 8}% desde la compra anterior</p></div>
        <div className="card"><p className="muted">Productos en el catálogo</p><p className="kpi">{resumen?.productos ?? 0}</p>
          <p className="muted">{resumen?.contabilidad_conectada ? "egresos van a contabilidad" : "contabilidad aún no conectada"}</p></div>
      </div>

      <div className="row">
        <button className={vista === "escanear" ? "btn alt" : "btn ghost"} onClick={() => setVista("escanear")}>Escanear documento</button>
        <button className={vista === "facturas" ? "btn alt" : "btn ghost"} onClick={() => setVista("facturas")}>Documentos</button>
        <button className={vista === "productos" ? "btn alt" : "btn ghost"} onClick={() => setVista("productos")}>Productos y precios</button>
      </div>

      {vista === "escanear" && <Escanear api={api} ocrReal={!!resumen?.ocr_real} planilla={!!resumen?.planilla} onGuardada={() => { cargarResumen(); setVista("facturas"); }} />}
      {vista === "facturas" && <Facturas api={api} onCambio={cargarResumen} />}
      {vista === "productos" && <Productos api={api} />}

      {vista === "facturas" && !!resumen?.proveedores.length && (
        <div className="card">
          <h3>Proveedores (últimos 90 días)</h3>
          <div className="scroll-x">
            <table>
              <thead><tr><th>Proveedor</th><th>Facturas</th><th>Total</th></tr></thead>
              <tbody>{resumen.proveedores.map((p) => <tr key={p.proveedor}><td>{p.proveedor}</td><td>{p.facturas}</td><td>{clp(p.total)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Achica la foto antes de subirla (las del celular pesan 3-8 MB): lado mayor 1800 px, JPEG 85%.
// Así entra en el límite del servidor y el OCR responde más rápido. Los PDF se suben tal cual.
async function prepararArchivo(f: File): Promise<File> {
  if (!f.type.startsWith("image/") || f.type === "image/gif") return f;
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const escala = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    if (escala === 1 && f.size < 1_500_000 && f.type === "image/jpeg") return f;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * escala); c.height = Math.round(bmp.height * escala);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
    if (!blob) return f;
    return new File([blob], f.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch { return f; }
}

const esTactil = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

// ---------------- Escanear + revisar + confirmar ----------------
function Escanear({ api, ocrReal, planilla, onGuardada }: { api: Api; ocrReal: boolean; planilla: boolean; onGuardada: () => void }) {
  const [datos, setDatos] = useState<Extraida | null>(null);
  const [estado, setEstado] = useState<"por_pagar" | "pagada">("por_pagar");
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState("");
  const [resultado, setResultado] = useState<any>(null);
  const [tipoSubida, setTipoSubida] = useState<"auto" | TipoDoc>("auto");
  const file = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);
  const [vista, setVista] = useState<string | null>(null);
  useEffect(() => () => { if (vista) URL.revokeObjectURL(vista); }, [vista]);

  const escanear = async (archivo?: File, tipo?: TipoDoc) => {
    setCargando(true); setErr(""); setResultado(null);
    try {
      let r: Extraida;
      if (archivo) {
        const listo = await prepararArchivo(archivo);
        setVista(listo.type.startsWith("image/") ? URL.createObjectURL(listo) : null);
        const fd = new FormData();
        fd.append("archivo", listo);
        if (tipoSubida !== "auto") fd.append("tipo", tipoSubida);
        const res = await fetch("/api/m/facturas/escanear", { method: "POST", headers: { "x-tenant": tenantSlug() }, body: fd });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "No se pudo leer el archivo");
        r = j;
      } else {
        setVista(null);
        r = await api.post<Extraida>("/escanear", { tipo: tipo ?? "factura" });
      }
      setDatos(r);
    } catch (e: any) { setErr(e.message); } finally { setCargando(false); }
  };

  const confirmar = async () => {
    if (!datos) return;
    setCargando(true); setErr("");
    try {
      const r = await api.post("/facturas", {
        tipo_doc: datos.tipo_doc, categoria_egreso: datos.categoria_egreso, descripcion: datos.descripcion,
        proveedor: datos.proveedor, rut: datos.rut, folio: datos.folio, fecha: datos.fecha, categoria: datos.categoria,
        neto: datos.neto, iva: datos.iva, total: datos.total, condicion_pago: datos.condicion_pago, archivo: datos.archivo,
        confianza: datos.confianza, motor: datos.motor, estado,
        lineas: datos.lineas.map((l) => ({ producto: l.producto, cantidad: l.cantidad, unidad: l.unidad, precio_unitario: l.precio_unitario, total: l.total })),
      });
      setResultado(r); setDatos(null); onGuardada();
    } catch (e: any) { setErr(e.message); } finally { setCargando(false); }
  };

  const editarLinea = (i: number, campo: "cantidad" | "precio_unitario", valor: number) => {
    if (!datos) return;
    const lineas = datos.lineas.map((l, k) => (k === i ? { ...l, [campo]: valor, total: Math.round((campo === "cantidad" ? valor : l.cantidad) * (campo === "precio_unitario" ? valor : l.precio_unitario)) } : l));
    setDatos(recalcular({ ...datos, lineas }));
  };
  const cambiarTipo = (t: TipoDoc) => datos && setDatos(recalcular({ ...datos, tipo_doc: t,
    categoria_egreso: t === "factura" && datos.tipo_doc !== "factura" ? "insumos" : datos.categoria_egreso }));
  const esFactura = datos?.tipo_doc === "factura";

  return (
    <div className="stack">
      {resultado && (
        <div className="card" style={{ background: "var(--verdeClaro)", borderColor: "var(--verde)" }}>
          <b>{resultado.tipo_label}{resultado.folio ? ` ${resultado.folio}` : ""} registrada por {clp(resultado.total)}.</b>
          <p className="muted">{resultado.egreso.ok ? `El egreso quedó anotado en contabilidad como ${catLabel(resultado.categoria_egreso)}.` : `Egreso no registrado en contabilidad (${resultado.egreso.motivo}).`}</p>
          {resultado.planilla?.ok
            ? <p className="muted">También quedó como fila en la planilla de Google Drive.</p>
            : planilla && resultado.planilla && <p style={{ color: "var(--rojo)" }}>No se pudo copiar a la planilla de Google: {resultado.planilla.motivo}.</p>}
          {!!resultado.alzas?.length && (
            <ul style={{ marginTop: 8 }}>
              {resultado.alzas.map((a: any) => <li key={a.producto}>⚠️ {a.producto} subió {pct(a.variacion_pct)}: {clp(a.anterior)} → {clp(a.nuevo)} por {a.unidad}</li>)}
            </ul>
          )}
        </div>
      )}

      {!datos && (
        <div className="card">
          <h3>Escanear un gasto</h3>
          <p className="muted" style={{ marginTop: 4 }}>Sirve para facturas de proveedores, boletas (ferretería, supermercado, gas, luz) y otros comprobantes como recibos o vales. Saca una foto o sube el PDF: leemos los datos y lo dejamos listo como egreso.</p>
          <input ref={file} type="file" accept="image/*,application/pdf" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void escanear(f); e.target.value = ""; }} />
          <input ref={camara} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void escanear(f); e.target.value = ""; }} />
          <div className="row" style={{ marginTop: 12 }}>
            <span className="muted">¿Qué vas a subir?</span>
            {([["auto", "Detectar solo"], ["factura", "Factura"], ["boleta", "Boleta"], ["otro", "Otro comprobante"]] as const).map(([v, l]) => (
              <button key={v} className={tipoSubida === v ? "btn alt" : "btn ghost"} style={{ padding: "6px 10px" }} onClick={() => setTipoSubida(v)}>{l}</button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            {esTactil() && <button className="btn alt" disabled={cargando} onClick={() => camara.current?.click()}>📷 Sacar foto</button>}
            <button className={esTactil() ? "btn ghost" : "btn alt"} disabled={cargando} onClick={() => file.current?.click()}>📎 Subir foto o PDF</button>
            <button className="btn ghost" disabled={cargando} onClick={() => escanear(undefined, "factura")}>Factura de ejemplo</button>
            <button className="btn ghost" disabled={cargando} onClick={() => escanear(undefined, "boleta")}>Boleta de ejemplo</button>
            <button className="btn ghost" disabled={cargando} onClick={() => escanear(undefined, "otro")}>Comprobante de ejemplo</button>
          </div>
          {cargando && <p className="muted" style={{ marginTop: 10 }}>{ocrReal ? "Leyendo el documento (puede tardar unos 10 segundos)…" : "Leyendo el documento…"}</p>}
          {err && <p style={{ color: "var(--rojo)", marginTop: 10 }}>{err}</p>}
          {ocrReal
            ? <p className="muted" style={{ marginTop: 12 }}>La lectura la hace Claude (IA con visión). Revisa siempre los datos antes de confirmar.{planilla ? " Cada documento confirmado se copia a la planilla de Google Drive." : ""}</p>
            : <p className="muted" style={{ marginTop: 12 }}>⚠️ Lectura simulada: falta configurar la API key del OCR en el servidor, así que los datos de una foto real serán inventados.</p>}
        </div>
      )}

      {datos && (
        <div className="card">
          <div className="between">
            <h3>Revisa lo que leímos</h3>
            <span className="chip">{Math.round(datos.confianza * 100)}% de confianza</span>
          </div>
          <p className="muted">{datos.archivo ? `Archivo: ${datos.archivo}` : `${TIPO_LABEL[datos.tipo_doc]} de ejemplo`} · {datos.motor === "claude" ? "leído por Claude" : "lectura simulada"}</p>
          {vista && <img src={vista} alt="Documento subido" style={{ marginTop: 10, maxWidth: "100%", maxHeight: 260, borderRadius: 8, border: "1px solid var(--borde, #ddd)", objectFit: "contain" }} />}

          <div className="row" style={{ marginTop: 12 }}>
            {(["factura", "boleta", "otro"] as const).map((t) => (
              <button key={t} className={datos.tipo_doc === t ? "btn alt" : "btn ghost"} style={{ padding: "6px 10px" }} onClick={() => cambiarTipo(t)}>{TIPO_ICONO[t]} {t === "otro" ? "Otro comprobante" : TIPO_LABEL[t]}</button>
            ))}
          </div>

          <div className="grid" style={{ marginTop: 12 }}>
            <label className="stack" style={{ gap: 4 }}><span className="muted">{esFactura ? "Proveedor" : "Comercio o persona"}</span>
              <input className="input" value={datos.proveedor} onChange={(e) => setDatos({ ...datos, proveedor: e.target.value })} /></label>
            <label className="stack" style={{ gap: 4 }}><span className="muted">RUT{esFactura ? "" : " (opcional)"}</span>
              <input className="input" value={datos.rut} onChange={(e) => setDatos({ ...datos, rut: e.target.value })} /></label>
            <label className="stack" style={{ gap: 4 }}><span className="muted">{esFactura ? "Folio" : "N° de boleta o comprobante (opcional)"}</span>
              <input className="input" value={datos.folio} onChange={(e) => setDatos({ ...datos, folio: e.target.value })} /></label>
            <label className="stack" style={{ gap: 4 }}><span className="muted">Tipo de gasto (egreso)</span>
              <select className="input" value={datos.categoria_egreso} onChange={(e) => setDatos({ ...datos, categoria_egreso: e.target.value })}>
                {CAT_EGRESO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></label>
            <label className="stack" style={{ gap: 4 }}><span className="muted">Fecha</span>
              <input className="input" type="date" value={datos.fecha} onChange={(e) => setDatos({ ...datos, fecha: e.target.value })} /></label>
            <label className="stack" style={{ gap: 4 }}><span className="muted">Condición de pago</span>
              <input className="input" value={datos.condicion_pago} onChange={(e) => setDatos({ ...datos, condicion_pago: e.target.value })} /></label>
            <label className="stack" style={{ gap: 4 }}><span className="muted">Estado</span>
              <select className="input" value={estado} onChange={(e) => setEstado(e.target.value as any)}>
                <option value="por_pagar">Por pagar</option><option value="pagada">Pagada</option>
              </select></label>
          </div>

          <div className="scroll-x" style={{ marginTop: 14 }}>
            <table>
              <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio unitario</th><th>Total</th><th>Vs. compra anterior</th></tr></thead>
              <tbody>
                {datos.lineas.map((l, i) => (
                  <tr key={i}>
                    <td>{l.producto} <span className="muted">({l.unidad})</span></td>
                    <td><input className="input" style={{ width: 80 }} type="number" step="0.1" value={l.cantidad} onChange={(e) => editarLinea(i, "cantidad", Number(e.target.value))} /></td>
                    <td><input className="input" style={{ width: 110 }} type="number" value={l.precio_unitario} onChange={(e) => editarLinea(i, "precio_unitario", Number(e.target.value))} /></td>
                    <td>{clp(l.total)}</td>
                    <td>
                      {datos.categoria_egreso !== "insumos" ? <span className="muted">no es insumo</span>
                        : l.nuevo ? <span className="chip off">producto nuevo</span>
                        : l.variacion_pct === null ? <span className="muted">—</span>
                          : <span className={l.alza ? "chip bad" : l.variacion_pct < 0 ? "chip" : "chip off"}>{pct(l.variacion_pct)} · antes {clp(l.costo_anterior ?? 0)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row between" style={{ marginTop: 14 }}>
            <div>
              {esFactura
                ? <p className="muted">Neto {clp(datos.neto)} · IVA 19% {clp(datos.iva)}</p>
                : <p className="muted">Total con IVA incluido (sin crédito fiscal)</p>}
              <p className="kpi">{clp(datos.total)}</p>
              <p className="muted">Se anota como egreso: {catLabel(datos.categoria_egreso)}</p>
            </div>
            <div className="row">
              <button className="btn ghost" onClick={() => setDatos(null)}>Descartar</button>
              <button className="btn alt" disabled={cargando} onClick={confirmar}>{cargando ? "Guardando…" : "Confirmar y registrar"}</button>
            </div>
          </div>
          {datos.lineas.some((l) => l.alza) && (
            <p style={{ marginTop: 10, color: "var(--rojo)" }}>⚠️ Hay productos que subieron más de {datos.alza_pct}%. Al confirmar quedan marcados en la lista de alzas.</p>
          )}
          {err && <p style={{ color: "var(--rojo)", marginTop: 10 }}>{err}</p>}
        </div>
      )}
    </div>
  );
}

// Factura: neto + IVA 19%. Boleta o comprobante: la suma de líneas ya es el total (IVA incluido).
function recalcular(d: Extraida): Extraida {
  const suma = d.lineas.reduce((a, l) => a + l.total, 0);
  if (d.tipo_doc === "factura") { const iva = Math.round(suma * 0.19); return { ...d, neto: suma, iva, total: suma + iva }; }
  return { ...d, neto: suma, iva: 0, total: suma };
}

// El slug del cliente activo viene en la URL /c/:slug/...
const tenantSlug = () => location.pathname.split("/")[2] ?? "";

// ---------------- Lista de facturas ----------------
function Facturas({ api, onCambio }: { api: Api; onCambio: () => void }) {
  const [filtro, setFiltro] = useState<"" | "por_pagar" | "pagada">("");
  const [tipo, setTipo] = useState<"" | TipoDoc>("");
  const [lista, setLista] = useState<Factura[]>([]);
  const [abierta, setAbierta] = useState<any>(null);
  const [err, setErr] = useState("");

  const cargar = useCallback(() => {
    const q = new URLSearchParams({ ...(filtro ? { estado: filtro } : {}), ...(tipo ? { tipo } : {}) }).toString();
    api.get<Factura[]>(`/facturas${q ? `?${q}` : ""}`).then(setLista).catch((e) => setErr(e.message));
  }, [api, filtro, tipo]);
  useEffect(() => { cargar(); }, [cargar]);

  const marcar = async (f: Factura, estado: "pagada" | "por_pagar") => {
    try { await api.patch(`/facturas/${f.id}`, { estado }); cargar(); onCambio(); } catch (e: any) { setErr(e.message); }
  };
  const ver = async (f: Factura) => {
    if (abierta?.id === f.id) return setAbierta(null);
    try { setAbierta(await api.get(`/facturas/${f.id}`)); } catch (e: any) { setErr(e.message); }
  };

  return (
    <div className="card">
      <div className="between">
        <h3>Documentos de gasto</h3>
        <div className="row">
          {([["", "Todas"], ["por_pagar", "Por pagar"], ["pagada", "Pagadas"]] as const).map(([v, l]) => (
            <button key={v} className={filtro === v ? "btn alt" : "btn ghost"} onClick={() => setFiltro(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        {([["", "Todos los tipos"], ["factura", "Facturas"], ["boleta", "Boletas"], ["otro", "Otros"]] as const).map(([v, l]) => (
          <button key={v} className={tipo === v ? "btn alt" : "btn ghost"} style={{ padding: "6px 10px" }} onClick={() => setTipo(v)}>{l}</button>
        ))}
      </div>
      {err && <p style={{ color: "var(--rojo)" }}>{err}</p>}
      <div className="scroll-x" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>Fecha</th><th>Comercio / proveedor</th><th>Documento</th><th>Total</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {lista.map((f) => (
              <tr key={f.id}>
                <td>{fechaCl(f.fecha)}</td>
                <td>{f.proveedor}<div className="muted">{f.rut ? `${f.rut} · ` : ""}{f.categoria} · {catLabel(f.categoria_egreso)}</div></td>
                <td><span className={f.tipo_doc === "factura" ? "chip" : "chip off"}>{TIPO_LABEL[f.tipo_doc] ?? "Factura"}</span> {f.folio || "s/n"}{f.archivo ? <div className="muted">📄 {f.archivo}</div> : null}</td>
                <td>{clp(f.total)}<div className="muted">{f.tipo_doc === "factura" ? `neto ${clp(f.neto)}` : "IVA incluido"}</div></td>
                <td><span className={f.estado === "pagada" ? "chip" : "chip warn"}>{f.estado === "pagada" ? "Pagada" : "Por pagar"}</span></td>
                <td>
                  <div className="row">
                    <button className="btn ghost" onClick={() => ver(f)}>{abierta?.id === f.id ? "Ocultar" : "Detalle"}</button>
                    {f.estado === "por_pagar"
                      ? <button className="btn" onClick={() => marcar(f, "pagada")}>Marcar pagada</button>
                      : <button className="btn ghost" onClick={() => marcar(f, "por_pagar")}>Por pagar</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={6} className="muted">Sin documentos registrados.</td></tr>}
          </tbody>
        </table>
      </div>
      {abierta && (
        <div className="card" style={{ marginTop: 12, background: "var(--fondo)" }}>
          <b>{TIPO_LABEL[abierta.tipo_doc as TipoDoc] ?? "Factura"} {abierta.folio || "s/n"} · {abierta.proveedor}</b>
          <p className="muted">{fechaCl(abierta.fecha)} · {abierta.condicion_pago ?? "sin condición"} · {abierta.egreso_id ? `egreso #${abierta.egreso_id} en contabilidad` : "sin egreso en contabilidad"}</p>
          <div className="scroll-x" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Total</th></tr></thead>
              <tbody>{abierta.lineas.map((l: any) => (
                <tr key={l.id}><td>{l.producto}</td><td>{l.cantidad} {l.unidad}</td><td>{clp(l.precio_unitario)}</td><td>{clp(l.total)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Productos, costos y alzas ----------------
function Productos({ api }: { api: Api }) {
  const [lista, setLista] = useState<Producto[]>([]);
  const [q, setQ] = useState("");
  const [alzaPct, setAlzaPct] = useState(8);
  const [detalle, setDetalle] = useState<any>(null);
  const [soloAlzas, setSoloAlzas] = useState(false);

  useEffect(() => { api.get<Producto[]>("/productos").then(setLista).catch(() => {}); }, [api]);
  useEffect(() => { api.get<{ alza_pct: number }>("/alzas").then((a) => setAlzaPct(a.alza_pct)).catch(() => {}); }, [api]);

  const filtrada = useMemo(() => lista
    .filter((p) => p.nombre.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((p) => !soloAlzas || p.variacion_pct > alzaPct), [lista, q, soloAlzas, alzaPct]);

  const ver = async (p: Producto) => {
    if (detalle?.id === p.id) return setDetalle(null);
    setDetalle(await api.get(`/productos/${p.id}`));
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="between">
          <h3>Productos e insumos</h3>
          <div className="row">
            <input className="input" style={{ width: 180 }} placeholder="Buscar producto" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className={soloAlzas ? "btn alt" : "btn ghost"} onClick={() => setSoloAlzas((v) => !v)}>Solo alzas</button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>El catálogo se arma solo con cada factura o boleta de insumos que confirmas. Avisamos cuando un producto sube más de {alzaPct}%.</p>
        <div className="scroll-x" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Producto</th><th>Último costo</th><th>Variación</th><th>Proveedor</th><th>Última compra</th><th></th></tr></thead>
            <tbody>
              {filtrada.map((p) => (
                <tr key={p.id} style={p.variacion_pct > alzaPct ? { background: "var(--naranjoClaro)" } : undefined}>
                  <td>{p.nombre}<div className="muted">por {p.unidad} · {p.compras} {p.compras === 1 ? "compra" : "compras"}</div></td>
                  <td><b>{clp(p.ultimo_costo)}</b>{p.costo_anterior ? <div className="muted">antes {clp(p.costo_anterior)}</div> : null}</td>
                  <td>{p.costo_anterior
                    ? <span className={p.variacion_pct > alzaPct ? "chip bad" : p.variacion_pct < 0 ? "chip" : "chip off"}>{pct(p.variacion_pct)}</span>
                    : <span className="chip off">sin historial</span>}</td>
                  <td>{p.proveedor}</td>
                  <td>{p.ultima_compra ? fechaCl(p.ultima_compra) : "—"}</td>
                  <td><button className="btn ghost" onClick={() => ver(p)}>{detalle?.id === p.id ? "Ocultar" : "Historial"}</button></td>
                </tr>
              ))}
              {!filtrada.length && <tr><td colSpan={6} className="muted">No hay productos que coincidan.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {detalle && (
        <div className="card">
          <div className="between">
            <div><b>{detalle.nombre}</b><p className="muted">Precio por {detalle.unidad} · {detalle.historial.length} registros</p></div>
            <button className="btn ghost" onClick={() => setDetalle(null)}>Cerrar</button>
          </div>
          <Sparkline puntos={detalle.historial.map((h: any) => h.precio)} />
          <div className="scroll-x" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>Fecha</th><th>Precio</th><th>Proveedor</th></tr></thead>
              <tbody>{[...detalle.historial].reverse().map((h: any, i: number) => (
                <tr key={i}><td>{fechaCl(h.fecha)}</td><td>{clp(h.precio)}</td><td>{h.proveedor}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Sparkline({ puntos }: { puntos: number[] }) {
  if (puntos.length < 2) return <p className="muted" style={{ marginTop: 8 }}>Falta historial para mostrar la curva.</p>;
  const w = 320, h = 70, min = Math.min(...puntos), max = Math.max(...puntos), rango = max - min || 1;
  const d = puntos.map((p, i) => `${i ? "L" : "M"}${(i / (puntos.length - 1)) * w} ${h - ((p - min) / rango) * (h - 8) - 4}`).join(" ");
  const sube = puntos[puntos.length - 1] > puntos[0];
  return (
    <div style={{ marginTop: 10 }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="Historial de precios">
        <path d={d} fill="none" stroke={sube ? "var(--rojo)" : "var(--verde)"} strokeWidth={2.5} strokeLinejoin="round" />
      </svg>
      <p className="muted">{clp(min)} mínimo · {clp(max)} máximo</p>
    </div>
  );
}

const mod: ClientModule = { id: "facturas", label: "Facturas y boletas", icon: "🧾", Component: Pantalla };
export default mod;
