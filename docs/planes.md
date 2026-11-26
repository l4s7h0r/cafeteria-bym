# Planes y precios — Cafetería BYM

Propuesta comercial v1 (nov 2026). Precios referenciales en CLP, **+IVA** (19%). Fuente de verdad en código: `server/core/plans.ts`.

## 1. Niveles

| Plan (id) | Para quién | Islas | Precio mensual + IVA | Anual (2 meses gratis) |
|---|---|---|---|---|
| **Emprende** (`basico`) | Café chico, carro, 1 caja | Contabilidad, Reportes | $14.990 | $149.900 |
| **Local** (`pro`) | Cafetería con mesas y clientela de fin de semana | Contabilidad, Reportes, Reservas, Plano del local | $29.990 | $299.900 |
| **Pro** (`full`) | Cafetería con alto flujo y muchos proveedores | Todas (incl. Llamado a mesa y Facturas) | $49.990 | $499.900 |
| **Cadena** (`cadena`) | 2+ locales | Todas + consolidado multi-local | $99.990 (incluye 2 locales) + $39.990 por local adicional | $999.900 (2 locales) |

- **Descuento anual:** pago adelantado de 12 meses al precio de 10 (≈17%).
- **Prueba gratis:** 14 días con todas las islas (equivalente a Pro), sin tarjeta. Al terminar, el cliente elige plan; si no elige, queda en modo solo lectura 30 días (no se borran datos).

## 2. Límites

| | Emprende | Local | Pro | Cadena (por local) |
|---|---|---|---|---|
| Usuarios | 2 | 6 | 15 | Ilimitados |
| Mesas (reservas / QR) | 10 | 30 | 60 | 60 |
| Locales | 1 | 1 | 1 | 2 incluidos, ampliable |
| Facturas escaneadas/mes | — | — (add-on: 100) | 150 | 200 |
| Soporte | Email/WhatsApp hábil | WhatsApp hábil | WhatsApp prioritario | Ejecutivo asignado |

Excedente de facturas: $150 + IVA por factura sobre el límite (o subir de plan). Mesas extra: $490/mesa/mes.

## 3. Islas como add-on (mensual, + IVA, sobre cualquier plan)

| Isla | Precio | Nota |
|---|---|---|
| Contabilidad | incluida | Base de todos los planes |
| Reportes | $5.990 | Requiere Contabilidad |
| Reservas | $14.990 | Incluye sitio público de reservas |
| Llamado a mesa | $9.990 | Requiere kit QR (ver §4). Incluye menú digital en el QR |
| Plano del local | $6.990 | Incluido en Local, Pro y Cadena. Sirve más junto a Reservas o Llamado |
| Facturas y productos | $19.990 | Requiere Contabilidad; incluye 100 facturas/mes |

Regla de precio: armar el plan superior con add-ons siempre sale más caro que subir de plan (ej. Local + Llamado + Facturas = $59.970 vs Pro $49.990).

## 4. Implementación e instalación QR (pago único, + IVA)

| Concepto | Emprende | Local | Pro | Cadena |
|---|---|---|---|---|
| Puesta en marcha | Autoservicio gratis | Autoservicio gratis (remota opcional $29.990) | $49.990 (remota, carga de productos y proveedores) | $89.990 por local (incluye visita en RM) |
| Kit QR de mesa | — | — | Hasta 20 QR acrílicos incluidos | Hasta 20 QR por local incluidos |
| QR adicional / reposición | $2.500 c/u | $2.500 c/u | $2.500 c/u | $2.500 c/u |
| Instalación presencial (fuera de RM) | — | — | + viático según ciudad | + viático según ciudad |

Con pago anual, la puesta en marcha de Pro va **gratis**.

## 5. Referencia de mercado

- Los software POS/gestión para restaurantes que se venden en Chile suelen cobrar mensualidades en el rango aproximado de **$15.000 a $80.000 + IVA por local**, con planes de entrada cerca de $15–25 mil y planes completos sobre $50 mil (estimación propia del rubro).
- **No logré validar estos rangos con fuentes públicas**: la búsqueda web (nov 2026) solo devolvió fichas de Capterra y avisos sin precios visibles. Antes de publicar, revisar a mano las páginas de precios de 3–4 competidores locales y ajustar.
- Posicionamiento: entrada barata (Emprende bajo $15 mil) para captar volumen, y el valor diferencial (Facturas + Llamado QR) concentrado en Pro.

## 6. Clientes tipo

| Cliente | Situación | Plan recomendado | Costo mensual aprox. + IVA |
|---|---|---|---|
| Barista del Sur (Concepción) | Café de paso, 6 mesas, dueño + 1 barista, compra a 3 proveedores | **Emprende** | $14.990 |
| La Tetera (Valparaíso) | 20 mesas, se llena los fines de semana, quiere que el cliente llame al garzón | **Local + Llamado** | $39.980 |
| Papa Kike (Santiago, piloto) | 35 mesas, 10 personas, muchas facturas de proveedores al mes | **Pro** (anual) | $41.658 equivalente/mes |

Si Papa Kike abre un segundo local, pasa a **Cadena** ($99.990 por ambos, vs $99.980 de dos Pro, con usuarios ilimitados y consolidado).

## 7. Cómo crecer el cliente (upsell)

1. **Emprende → Local:** cuando llega a 2 usuarios o 10 mesas, o pide reservas. Aviso en la app al tocar el límite.
2. **Local → Pro:** cuando contrata 2 add-ons (Llamado + Facturas), mostrar que Pro sale más barato.
3. **Pro → Cadena:** al crear un segundo local; ofrecer el 1er mes del local nuevo gratis.
4. **Anual:** ofrecer al mes 3 de uso continuo (2 meses gratis + implementación gratis en Pro).
5. Reporte mensual al dueño con "lo que ahorraste" (horas de digitación de facturas, propinas cuadradas) como gancho de renovación.

## 8. Islas futuras (no disponibles aún)

| Isla futura | Qué hace | Precio add-on tentativo |
|---|---|---|
| *(futura)* Inventario | Stock por insumo, mermas, alertas de quiebre (se alimenta de Facturas) | $9.990 |
| *(futura)* Fidelización | Tarjeta de sellos digital, cupones, base de clientes | $9.990 |
| *(futura)* Delivery / pedidos web | Menú online y pedidos para retiro o reparto propio | $14.990 |
| *(futura)* Boleta electrónica SII | Emisión de boleta/factura electrónica integrada a la caja | $9.990 |
| *(futura)* Turnos y personal | Horarios, asistencia y reparto de propinas por turno | $7.990 |
