import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useParams } from "react-router-dom";
import { clientModules } from "../modules";
import { makeApi } from "./api";
import type { TenantInfo } from "./types";

// Contenedor del cliente: solo muestra las islas que su plan habilita.
export default function ClientShell() {
  const { slug = "" } = useParams();
  const [me, setMe] = useState<{ tenant: TenantInfo; modulos: string[] } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch(`/api/me?t=${slug}`).then(async (r) => (r.ok ? setMe(await r.json()) : setErr("Cliente no encontrado")));
  }, [slug]);
  const mods = useMemo(() => clientModules.filter((m) => me?.modulos.includes(m.id)), [me]);
  const apis = useMemo(() => Object.fromEntries(clientModules.map((m) => [m.id, makeApi(`/api/m/${m.id}`, slug)])), [slug]);
  if (err) return <div className="page">{err}</div>;
  if (!me) return <div className="page muted">Cargando…</div>;
  return (
    <div className="app">
      <header className="top">
        <div className="logo">{me.tenant.nombre.split(" ").map((w) => w[0]).join("").slice(0, 2)}</div>
        <div className="brand"><b className="display">{me.tenant.nombre}</b><span className="tiza">Plan {me.tenant.plan_id}</span></div>
      </header>
      <nav className="tabs">
        {mods.map((m) => <NavLink key={m.id} to={`/c/${slug}/m/${m.id}`}>{m.icon} {m.label}</NavLink>)}
      </nav>
      <main className="page">
        <Routes>
          {mods.map((m) => (
            <Route key={m.id} path={`m/${m.id}/*`} element={<m.Component tenant={me.tenant} api={apis[m.id]} />} />
          ))}
          <Route path="*" element={mods[0] ? <Navigate to={`m/${mods[0].id}`} replace /> : <p>Sin módulos activos.</p>} />
        </Routes>
      </main>
    </div>
  );
}
