import { useParams } from "react-router-dom";
import { clientModules } from "../modules";

// Páginas públicas de las islas (QR de mesa, reservar). /p/:slug/<path>
export default function PublicPage() {
  const { slug = "", "*": rest = "" } = useParams();
  for (const m of clientModules) for (const p of m.publicPages ?? []) {
    const keys: string[] = [];
    const re = new RegExp("^" + p.path.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "/?$");
    const hit = rest.match(re);
    if (hit) return <p.Component slug={slug} params={Object.fromEntries(keys.map((k, i) => [k, hit[i + 1]]))} />;
  }
  return <div className="page">Página no encontrada.</div>;
}
