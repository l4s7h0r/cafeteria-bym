import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./styles.css";
import Home from "./core/Home";
import ClientShell from "./core/ClientShell";
import PublicPage from "./core/PublicPage";
import AdminApp from "./admin/AdminApp";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/c/:slug/*" element={<ClientShell />} />
      <Route path="/p/:slug/*" element={<PublicPage />} />
      <Route path="/admin/*" element={<AdminApp />} />
    </Routes>
  </BrowserRouter>
);
