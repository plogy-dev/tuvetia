---
titulo: Ventas y facturación
seccion: guias
orden: 70
resumen: El módulo más grande del sistema: facturas, notas crédito, inventario por lote, compras y cartera.
---

# Ventas y facturación

`/dashboard/facturacion` — 16 pantallas y 39 archivos de lógica. Es el módulo más grande.

## El mapa de pantallas

| Ruta | Qué es |
|---|---|
| `/facturacion` | El listado |
| `/facturacion/nueva` | Emitir una factura |
| `/facturacion/[id]` | El detalle |
| `/facturacion/[id]/imprimir` | La vista de impresión |
| `/facturacion/cartera` | Cobranza: lo que está por cobrar |
| `/facturacion/finanzas` | El resumen financiero |
| `/facturacion/catalogo` | Productos y servicios |
| `/facturacion/inventario` | Existencias |
| `/facturacion/inventario/movimientos` | El historial de movimientos |
| `/facturacion/inventario/importar` | Carga masiva |
| `/facturacion/compras` | Compras a proveedores |
| `/facturacion/compras/nueva` · `/[id]` · `/[id]/editar` | Alta y edición |
| `/facturacion/compras/proveedores` | Proveedores |
| `/facturacion/configuracion` | Datos fiscales, numeración, impuestos |

## Activar el módulo

`billing_settings.module_status` decide si la clínica factura desde Tuvetia. Esa bandera además
gobierna si el tablero **ofrece** las cifras de plata: a una clínica que no lo activó serían ceros
permanentes.

## Facturar

Una factura (`invoices`) tiene líneas (`invoice_lines`) que salen del catálogo (`catalog_items`).
Los eventos de su ciclo quedan en `invoice_events`.

### Numeración fiscal

`numbering_ranges` guarda los rangos autorizados. La numeración es correlativa y no se puede saltar:
es un requisito fiscal, no una preferencia.

### Notas crédito

`credit_notes` permite anular una factura o **corregir un importe sin anularla** (nota crédito
parcial).

Hay una guarda en la base —`la_nota_credito_cabe_en_la_factura()`— que impide acreditar más de lo que
la factura vale. Sin ella, dos notas parciales podrían sumar más que el total.

## Inventario

`catalog_items` con `catalog_lots`: el inventario es **por lote**, no un único contador. Eso es lo que
permite manejar vencimientos y trazabilidad, que en insumos veterinarios importa.

`inventory_movements` registra cada entrada y salida. Facturar descuenta existencias.

Hay un aviso de **existencia insuficiente** al facturar algo que no hay. (Ese aviso existió un tiempo
sin llegar a ninguna parte: se emitía y nadie lo veía.)

## Compras

`purchases` / `purchase_items` con `suppliers`. Entran mercadería al inventario y quedan como gasto.

`expenses` y `receipt_attachments` completan el lado de egresos.

### Receta o factura por foto

Se puede cargar una factura de compra o una receta **sacándole una foto**: un modelo con visión la
lee y la convierte en ítems. Es una capacidad de plan Pro (`receta-por-foto`) y usa
`ATHOS_VISION_MODEL`.

## Cobranza (cartera)

`/facturacion/cartera` muestra lo pendiente. El motor:

1. Recorre las facturas vencidas.
2. Manda recordatorios por los canales que el titular autorizó (`channel_authorizations`).
3. **Lee las respuestas y clasifica la intención** con IA (`cartera-ia`) — si alguien contesta "el
   viernes te pago", eso no es lo mismo que "ya pagué".
4. Lo que no puede resolver, lo escala a una persona.

Corre en el cron de las **14:00**. `CARTERA_MESSAGING_SIMULATED=1` lo deja sin enviar nada real.

Las facturas y los recordatorios salen por **Resend**, a nombre de la clínica y con Reply-To a sus
administradores. Los titulares se pueden dar de baja (`/baja/[token]`).

## Pagos

`payments` y `payment_applications`: un pago puede aplicarse a varias facturas. `billing_payers`
permite que quien paga no sea el titular.

## Exportar

`/api/facturacion/inventario/export` exporta el inventario. El export general de la clínica
(`/api/export`) incluye lo demás.

## Dónde está la lógica

`src/lib/facturacion/` (39 archivos) y `src/lib/cartera/` (16). Como en el resto del repositorio, la
lógica pura está separada de las pantallas y tiene tests: los cálculos de impuestos, la numeración y
el encaje de las notas crédito no son cosas para verificar a ojo.

## Documento de referencia

`BILLING.md`, publicado en la sección **Documentos del repositorio**.
