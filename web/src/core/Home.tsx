import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

export default function Home() {
  const [tenants, setTenants] = useState<{ slug: string; nombre: string }[]>([]);
  useEffect(() => { fetch("/api/tenants").then((r) => r.json()).then(setTenants); }, []);
  return (
    <div className="page">
      <h1 className="display">Cafetería ByM</h1>
      <p className="muted">Prototipo local. Elige un cliente para entrar a su sistema, o abre la administración interna.</p>
      <div className="stack">
        {tenants.map((t) => <Link key={t.slug} className="card link" to={`/c/${t.slug}`}>{t.nombre}</Link>)}
        <Link className="card link dark" to="/admin">⚙️ Administración interna</Link>
      </div>
    </div>
  );
}
