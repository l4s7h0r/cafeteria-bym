import { NavLink, Route, Routes } from "react-router-dom";
import ResumenView from "./Resumen";
import ClientesView from "./Clientes";
import ClienteDetalle from "./ClienteDetalle";
import NuevoCliente from "./NuevoCliente";
import PlanesView from "./Planes";
import "./admin.css";


// Dashboard de administración interna: lo usa el equipo que vende el software, no la cafetería.
export default function AdminApp() {
  return (
    <div className="app admin">
      <header className="top">
        <NavLink to="/" className="logo" aria-label="Inicio" style={{ textDecoration: "none" }}>⚙️</NavLink>
        <div className="brand"><b className="display">Administración</b><span className="tiza">Cafetería ByM · uso interno</span></div>
      </header>
      <nav className="tabs">
        <NavLink to="/admin" end>📊 Resumen</NavLink>
        <NavLink to="/admin/clientes">☕ Clientes</NavLink>
        <NavLink to="/admin/planes">🧾 Planes</NavLink>
      </nav>
      <main className="page">
        <Routes>
          <Route index element={<ResumenView />} />
          <Route path="clientes" element={<ClientesView />} />
          <Route path="clientes/nuevo" element={<NuevoCliente />} />
          <Route path="clientes/:slug" element={<ClienteDetalle />} />
          <Route path="planes" element={<PlanesView />} />
          <Route path="*" element={<p className="muted">Página no encontrada.</p>} />
        </Routes>
      </main>
    </div>
  );
}
