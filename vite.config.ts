import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: { port: Number(process.env.WEB_PORT ?? 5173), proxy: { "/api": `http://localhost:${process.env.PORT ?? 3001}` } },
  build: { outDir: "../dist", emptyOutDir: true },
});
