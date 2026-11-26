# ☕ Cafetería ByM

Software de gestión para cafeterías, **multi-cliente** y vendido por **planes**. Está programado **por islas**: cada módulo funciona aislado y se activa según el plan que contrate cada cafetería.

> Estado: prototipo local con base SQLite y datos de prueba de 4 cafeterías.

<p>
  <img src="docs/capturas/conta.png" width="190" alt="Contabilidad">
  <img src="docs/capturas/reportes.png" width="190" alt="Reportes">
  <img src="docs/capturas/llamado.png" width="190" alt="Llamado a mesa">
  <img src="docs/capturas/pub-mesa.png" width="190" alt="QR de la mesa">
  <img src="docs/capturas/admin.png" width="190" alt="Admin: resumen">
  <img src="docs/capturas/admin-clientes.png" width="190" alt="Admin: clientes por isla">
</p>

## Islas (módulos)

| Isla | Qué hace | Requiere |
|---|---|---|
| **Contabilidad** | Ingresos por medio de pago, gastos por categoría, propinas y reparto por garzón | — |
| **Reportes** | Resumen diario, semanal y mensual, con comparación contra el periodo anterior | Contabilidad |
| **Reservas** | Mesas, agenda del día, ocupación y página pública para reservar | — |
| **Llamado a mesa** | QR por mesa: el comensal ve el menú, llama al garzón o pide la cuenta; cola en vivo y editor del menú | — |
| **Facturas y boletas** | Escaneo con foto del celular o archivo (OCR con Claude) de facturas, boletas (ferretería, gas, luz, aseo…) y otros comprobantes; todo queda como egreso en su categoría. Catálogo de productos con costo y alertas de alza | Contabilidad |
| **Plano del local** | Editor visual: el dueño dibuja la forma del local y ubica mesas, barra, baños, terraza. El cliente elige mesa al reservar y ve "estás aquí" al escanear el QR. Vista en vivo de mesas libres, reservadas y llamando | — (se conecta con Reservas y Llamado si están) |

Además incluye un **dashboard de administración interna** (`/admin`) para el equipo que vende el software: MRR, clientes por plan, matriz de qué cliente tiene cada isla, cambio de plan o estado, y add-ons o bloqueos por cliente.

## Planes (precios referenciales, CLP + IVA)

| Plan | Mensual | Islas |
|---|---|---|
| Emprende | $14.990 | Contabilidad, Reportes |
| Local | $29.990 | + Reservas y Plano del local |
| Pro | $49.990 | Todas |
| Cadena | $99.990 (2 locales) + $39.990 por local extra | Todas + consolidado |

Pago anual: 12 meses al precio de 10. Prueba gratis de 14 días. Detalle completo, add-ons, límites e implementación en [`docs/planes.md`](docs/planes.md).

## Cómo correrlo

Requisitos: [Bun](https://bun.sh) 1.1 o superior.

```bash
bun install
bun run seed          # crea data/cafeteria.db con datos de prueba
bun server/index.ts   # API en http://localhost:3001
bunx vite             # web en http://localhost:5173
```

| Ruta | Qué es |
|---|---|
| `/` | Elegir cliente de prueba |
| `/c/papa-kike` | Sistema del local (solo muestra las islas de su plan) |
| `/admin` | Administración interna |
| `/p/papa-kike/mesa/5` | Página pública del QR de una mesa |
| `/p/papa-kike/reservar` | Página pública para reservar |

Clientes de prueba: **Papa Kike** (Pro, piloto), **Café Los Andes** (Local), **La Tetera** (Local + add-on Llamado) y **Barista del Sur** (Emprende).

## Arquitectura

```
shared/modules.ts          catálogo de islas y dependencias
server/
  core/                    núcleo: DB SQLite, router, tenancy, planes
  modules/<isla>/          backend de cada isla (tablas, datos de prueba, rutas)
  admin/                   API de administración interna
web/src/
  core/                    shell de la app, cliente HTTP
  modules/<isla>/          pantallas de cada isla
  admin/                   dashboard interno
docs/planes.md             propuesta de planes y precios
CONTRATOS.md               cómo construir una isla nueva
```

- **Islas activas de un cliente** = islas de su plan **+ add-ons − bloqueos**, y solo si el cliente está activo. Una isla sin sus requisitos queda apagada.
- El núcleo monta cada isla en `/api/m/<isla>` y responde **403** si el cliente no la tiene. La web solo muestra en el menú las islas activas.
- Una isla nunca importa código de otra. Si necesita datos de otra, los lee en modo solo lectura.
- El cliente activo viaja en el header `x-tenant` (slug).

Para agregar una isla nueva: ver [`CONTRATOS.md`](CONTRATOS.md).

## Stack

Bun · bun:sqlite · React 19 · Vite · TypeScript · React Router. Sin librerías de gráficos ni de QR (generador QR propio).

## Pendiente

- Login y permisos (hoy la administración está abierta).
- OCR real para facturas: hecho con Claude (visión) y copia a Google Sheets; configuración en `docs/ocr-y-planilla.md`.
- Validar precios contra la competencia.
- Islas futuras: inventario, fidelización, delivery, boleta electrónica SII, turnos.

## Publicar la demo (Vercel)

- El frontend compilado (`dist/`) lo sirve Vercel como sitio estático.
- La API corre como función con runtime Bun (`api/index.ts`, configurado en `vercel.json`).
- SQLite vive en `/tmp` y se siembra con los datos de prueba en cada arranque en frío: los cambios que se hagan en la demo no son permanentes.

```bash
bunx vercel        # vista previa
bunx vercel --prod # URL pública
```

Fuera de Vercel también corre como un solo servicio: `bun run build && bun run start`, o con Docker (`docker build -t cafe . && docker run -p 3001:3001 cafe`).
