# Auditoría E2E — 16 de agosto de 2026

**Contra:** `master` @ `dfc2fff` y el principal `auxlnexhkmtoedrzfsnz`.
**Método:** lectura de lógica + consultas de sólo lectura a la base + medición del DOM en producción.
**Regla:** nada se afirma sin verificarlo. Lo que no pude verificar está marcado como tal, y las
hipótesis que se cayeron al medirlas también.

---

## Resumen

| | Hallazgo | Gravedad |
|---|---|---|
| 1 | El pago que el cliente ya entregó puede no quedar registrado | 🔴 Alta |
| 2 | La banda «evidencia limitada» se pierde en la nota clínica | 🟠 Media |
| 3 | 27 de 32 pantallas no tienen título de pestaña | 🟡 Baja |
| 4 | Dos `<h1>` visibles por pantalla, diciendo cosas distintas | 🟡 Baja |
| 5 | 14 páginas anidan `<main>` dentro de `<main>` | 🟡 Baja |
| 6 | Los recordatorios de cobro salen a las 07:00, no a las 09:00 | 🟢 Menor |

**Lo que salió limpio:** los invariantes cruzados (`service_role` + `clinic_id`, escrituras sin
`await`, errores tragados) pasan **enteros** — los 8 candidatos que levantó el barrido eran falsos
positivos míos. Y el interruptor de desactivación quedó **verificado funcionando en producción**.

---

## 1 · 🔴 El pago que el cliente ya entregó puede no quedar registrado

**Qué se rompe.** En `issueInvoice`, el pago declarado se registra DESPUÉS de tres escrituras que
pueden fallar. Si cualquiera falla, la factura queda emitida y numerada, y la plata que el cliente
ya puso sobre el mostrador no queda anotada en ningún lado.

**Evidencia.** `src/lib/facturacion/invoices.ts`, en orden de ejecución:

| Línea | Paso | Si falla |
|---|---|---|
| 658 | Se quema el consecutivo fiscal | recuperación a medida ✅ |
| 717 | La factura pasa a `EMITIDA` | recuperación a medida ✅ |
| **773** | Inventario | **`throw`** |
| **808** | Componentes de receta | **`throw`** |
| **896** | Documento fiscal | **`throw`** |
| 912 | **Se registra el pago declarado** | nunca se llega |
| 934 | `refreshInvoiceStatus` | nunca se llega |

La cadena completa, verificada:

- El borrador nace con `balance_cents = total` (`invoices.ts:224`).
- `refreshInvoiceStatus`, que lo corregiría, está **después** del `throw`.
- `src/lib/cartera/scheduler.ts:100-102` levanta facturas con
  `status='EMITIDA' AND followup_enabled AND balance_cents > 0`.

**Consecuencia.** En un **abono parcial** (`ABONO_PARCIAL` → `payment_terms='CREDIT'` →
`followup_enabled` puede quedar en `true`), el motor de cobranza le escribe al cliente **por el
total**, habiendo pagado una parte en efectivo.

**Agravante.** Los tres mensajes de error dicen «No se pudo descontar inventario» o «No se pudo
registrar el documento fiscal». **Ninguno menciona el pago.** El vet no tiene cómo saber que eso
quedó sin registrar.

**Honestidad sobre el disparador.** Busqué una vía determinista y **no la hay**. Dos hipótesis mías
se cayeron al medirlas contra la base:

- *«Una línea con cantidad 0 rompe el `CHECK (qty <> 0)` del movimiento»* → falso:
  `invoice_lines_qty_check` exige `qty > 0`.
- *«Borrar un ítem del catálogo rompe el FK»* → falso: `invoice_lines_catalog_item_id_fkey` es
  `ON DELETE SET NULL`, y el código filtra los nulos.

Queda el fallo transitorio de red. **Eso no lo vuelve teórico:** esta misma función ya trata los
fallos transitorios como esperables — tiene recuperación escrita a mano para el paso del
consecutivo, con comentarios explicando por qué. La falla es que ese cuidado no se extendió a los
tres pasos siguientes.

`issueInvoice` **no tiene ningún test**.

**El arreglo es barato:** mover el bloque 912-932 a inmediatamente después del
`appendEvent('ISSUED')` de la línea 751. La plata ya ocurrió en el mundo real; registrarla no
debería depender de que el inventario cuadre.

---

## 2 · 🟠 La banda «evidencia limitada» se pierde en la nota clínica

**Qué se rompe.** El juez de evidencia de Athos devuelve tres bandas —`none`, `limited`,
`sufficient`—. El chat avisa cuando es `limited`. **La nota clínica no**, y es la que entra a la
historia del paciente.

**Evidencia.**

- El servicio devuelve `evidence_level` (contrato en `athos-service/CLAUDE.md`).
- `src/lib/athos.ts:113-124` — el tipo `PhantomResponse` **no declara** `evidence_level`. Sólo tiene
  `insufficient_evidence`, que equivale a `evidence_level === 'none'`.
- `grep evidence_level src/` sólo aparece en el agente (`tools.ts:399`, que sí lo consume bien) y en
  su prompt. **Cero usos en la ruta del Fantasma.**

**Ya ocurrió.** Consulta al principal:

```sql
select coalesce(evidence_level,'(null)'), count(*), count(*) filter (where status='approved')
from clinical_notes group by 1;
```

| Banda | Notas | Ya aprobadas |
|---|---|---|
| `sufficient` | 39 | 22 |
| `limited` | **1** | **1** |
| `none` | 1 | 0 |

Hay **una nota `limited` ya aprobada**: entró a la historia clínica de un paciente y el vet que la
aprobó nunca vio que la literatura no cubría el cuadro. La banda `none` sí se frena (0 aprobadas),
porque para ésa el front sí tiene señal.

**Por qué importa más de lo que parece.** El mismo veredicto del mismo juez produce un aviso visible
en el chat y **nada** en el documento que queda archivado.

---

## 3 · 🟡 27 de 32 pantallas no tienen título de pestaña

**Qué se rompe.** Sólo 5 de 32 páginas del dashboard exportan `metadata`. Las otras 27 caen al
título del layout raíz: **«Tuvetia»**. Un vet con pacientes, una consulta, la agenda y cartera
abiertos ve cuatro pestañas idénticas.

**Evidencia.** Medido en producción: `document.title === "Tuvetia"` en `/dashboard/facturacion` y en
`/dashboard/facturacion/cartera`. Las 5 que sí lo definen: `asistente`, `comunicaciones`,
`comunicaciones/correo`, `facturacion/inventario/importar`, `owners/[id]`.

Afecta también el historial del navegador y los marcadores. **`/admin` no lo tiene:** sus 5 páginas
sí definen título («Admin · Usuarios» se verificó en pantalla).

---

## 4 · 🟡 Dos `<h1>` visibles por pantalla, diciendo cosas distintas

**Qué se rompe.** `src/components/site-header.tsx:46` pinta un `<h1>` con el nombre de la sección, y
`src/components/ui/page-shell.tsx:63` pinta otro con el de la página. Los dos quedan visibles.

**Evidencia.** Medido en `/dashboard/facturacion/cartera`: `h1 = ["Ventas", "Cartera"]`, alturas 24px
y 34px, los dos visibles. Un lector de pantalla anuncia dos encabezados de nivel 1 en una página que
tiene un solo tema.

---

## 5 · 🟡 14 páginas anidan `<main>` dentro de `<main>`

**Qué se rompe.** `SidebarInset` (`src/components/ui/sidebar.tsx:310`) renderiza `<main>`. Catorce
páginas del dashboard —todas bajo `facturacion/`— renderizan además su propio
`<main className="flex-1 min-w-0">` adentro. La especificación de HTML dice que `main` no puede ser
descendiente de otro `main`.

**Evidencia.** Medido en `/dashboard/facturacion`: 3 elementos `<main>`, uno contenido en otro.

> **Lo que NO es un hallazgo, aunque lo pareció.** El tercer `<main>` está duplicado en el DOM pero
> su contenedor tiene `display:none`, así que un lector de pantalla no lo anuncia. Mi primera
> medición miraba sólo el elemento y no el ancestro, y daba un falso positivo.

---

## 6 · 🟢 Los recordatorios de cobro salen a las 07:00, no a las 09:00

**Qué se rompe.** `src/lib/cartera/scheduler.ts:141` hace
``new Date(`${inv.due_date}T09:00:00`)`` — **sin zona**. Node lo parsea como hora local del proceso,
y en Vercel el proceso corre en UTC. Las 09:00 pretendidas son en realidad **04:00 de Bogotá**.

**Verificado:**

```
$ TZ=UTC node -e "console.log(new Date('2026-08-20T09:00:00').toISOString())"
2026-08-20T09:00:00.000Z     → 04:00 en Bogotá
```

**Consecuencia real, y es menor de lo que sospeché.** Mi primera hipótesis fue «se le manda un cobro
a un cliente a las 4 de la mañana». **Falso:** la ventana de la Ley 2300 (7:00–19:00, sábados
8:00–15:00, en `facturacion/domain/reminders.ts:112`) los reprograma. El efecto neto es que salen al
abrir la ventana en vez de a las 9.

Vale anotarlo igual porque es el mismo bug que el repo ya arregló dos veces —`invoices.ts:696` y
todo `cartera/business-timezone.ts` existen por esto— y acá quedó uno suelto.

---

## Lo que salió limpio

**Los invariantes cruzados pasan enteros.** El barrido levantó 8 candidatos y **los 8 eran falsos
positivos míos**:

- `service_role` sin `clinic_id`: 2 candidatos. Uno usa la sesión del vet (la RLS aplica), el otro
  sí tiene `clinic_id` — mi regex no lo veía porque el objeto se define arriba del `.from()`.
- Escrituras sin `await`: 6 candidatos, todos el mismo patrón `const query = …; await query.select()`.
- `catch` vacíos: uno solo, el bootstrap del tema en `layout.tsx`, y es correcto — `localStorage`
  lanza en modo privado.

**El interruptor de desactivación, verificado en producción.** En `/admin/usuarios`: 17 filas, las
17 con sus dos controles, y **exactamente una deshabilitada** — `Plogy App / devsplogy@gmail.com`,
la cuenta con la que estaba conectado, con el texto «No podés desactivar tu propia cuenta». La
guarda que escribí funciona de verdad.

**La aritmética del dinero está cubierta.** `money.ts`, `invoice.ts`, `dian-rules.ts`, `finance.ts`,
`invoice-status.ts` y `reminders.ts` tienen tests y pasan. No la toqué a propósito: el riesgo estaba
en el cableado, no en las cuentas.

**athos-service está bien cubierto.** 31 archivos de test, 261 casos, y de sus 40 módulos sólo 3
quedan sin test — dos son scripts de CLI y el tercero es `auth.py` (68 líneas).

---

## Lo que NO verifiqué

- **Móvil.** El navegador reportaba `clientWidth = 0` y anchos de contenedor absurdos, así que
  cualquier conclusión habría sido inventada. El único dato limpio: las tablas sí tienen contenedor
  con scroll horizontal. **Queda pendiente y hay que mirarlo con un teléfono de verdad.**
- **`facturacion/queries.ts` (982 líneas) y `actions.ts` (809)** en profundidad. Prioricé
  `invoices.ts` por ser el que orquesta la emisión. Siguen sin tests.
- **Las 18 rutas del dashboard** que no recorrí una por una. Fui a las de mayor riesgo (facturación,
  cartera, pacientes, admin).
- **Contraste de color y foco de teclado.** Necesitan herramientas que este contexto no tiene.

---

## Orden sugerido

1. **El hallazgo 1** — mover 20 líneas. Es plata de un cliente y hoy no hay red.
2. **El hallazgo 2** — pasar `evidence_level` al front y pintarlo en la nota. Es historia clínica.
3. **Los tests de `issueInvoice`**, que es lo que habría atajado el hallazgo 1 antes de que yo lo
   leyera.
4. **3, 4 y 5** juntos: son de una tarde y los tres son de accesibilidad y oficio.
5. **El 6**, una línea.
