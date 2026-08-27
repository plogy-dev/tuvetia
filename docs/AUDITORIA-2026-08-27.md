# Auditoría — 27 de agosto de 2026

**Contra:** `master` @ `5d0910b` y el principal `auxlnexhkmtoedrzfsnz`.
**Alcance:** delta. Ya existen `AUDITORIA-COMPLETA-2026-08-16.md`, `AUDITORIA-E2E-2026-08-16.md`
(rescatada hoy) y las correcciones del 26-ago (`0bd2ac2`). Re-derivarlas no aporta; lo que aporta
es lo que cambió y lo que ninguna cubrió.
**Método:** lectura del código + consultas de **sólo lectura** al principal. El MCP quedó en
`read_only=true` durante toda la auditoría: nada de lo que sigue escribió una fila.
**Regla:** nada se afirma sin verificarlo, y las hipótesis que se cayeron se registran.

---

## Resumen

| | Hallazgo | Gravedad |
|---|---|---|
| 1 | `delete from clinics` no puede completarse — y el teardown de la suite de pruebas está roto por eso | 🔴 Alta |
| 2 | `/admin` sub-reporta los mensajes de WhatsApp **hoy**, sin que su propia guarda avise | 🟠 Media |
| 3 | Una tabla con 19.649 filas reales tiene una sola defensa en vez de dos | 🟠 Media |
| 4 | 73 claves foráneas sin índice; una ya está en un camino caliente | 🟠 Media |
| 5 | El `statement_timeout` de `service_role` es ilimitado — cualquier medición hecha con esa credencial miente | 🟡 Baja |
| 6 | `docs/API.md` declara 22 rutas; el árbol tiene 41 | 🟡 Baja |

**Cuatro hipótesis se cayeron al medirlas** (§7). Tres de ellas habrían generado trabajo
destructivo o duplicado.

---

## 1 · 🔴 `delete from clinics` no puede completarse

**Qué se rompe.** Borrar una clínica falla con violación de clave foránea si esa clínica tuvo
alguna vez un titular, un paciente, una consulta o una cita.

**La cadena, verificada contra el principal:**

- De las **61** claves foráneas que apuntan a `public.clinics`, **60 son `ON DELETE CASCADE` y una
  no**: `audit_logs_clinic_id_fkey` es `NO ACTION`, que bloquea.
- La migración `0063_traza_de_lo_que_hacen_las_personas.sql` puso triggers **`AFTER DELETE`** en
  cuatro tablas — verificado en `pg_trigger`: `appointments_traza`, `consultations_traza`,
  `owners_traza`, `patients_traza`.
- Esos triggers **insertan en `audit_logs`** con el `clinic_id` de la clínica que se está
  borrando. Al cerrar el statement, la comprobación de la FK ya no encuentra la clínica.

O sea: el propio cascade genera las filas que impiden que el cascade termine.

**Consecuencia medida — la suite de pruebas del microservicio no limpia.**
`athos-service/tests/conftest.py:170` hace exactamente `delete from public.clinics where id in
(%s,%s)` sobre dos clínicas que la misma fixture acaba de poblar con titulares y pacientes. Ese
teardown no vuelve en cero: vuelve con error. Es coherente con lo ya documentado en
`ENTORNOS-QUE-APUNTA-A-DONDE.md:155` («6 pruebas de base fallan a propósito»), pero la causa no
era ésa.

**Además hay 9 cadenas `RESTRICT` dentro de la clínica** (`credit_notes.invoice_id`,
`fiscal_documents.invoice_id`, `payment_applications.invoice_id`, `invoices.payer_id`,
`invoices.numbering_range_id`, `purchase_items.catalog_item_id`,
`health_plan_items.catalog_item_id`, `health_plan_uses.catalog_item_id`,
`patient_health_plans.plan_id`). `RESTRICT` se evalúa de inmediato, así que gana contra cualquier
cascade del mismo statement: una clínica con facturación es imposible de borrar de un saque.

**Por qué importa más allá de las pruebas.** Es el mecanismo que cualquiera asumiría para dar de
baja a un cliente. Hoy no existe forma documentada de borrar una clínica, y la que parece obvia
falla a mitad, dejando la clínica sin sus hijos pero existente.

---

## 2 · 🟠 `/admin` sub-reporta los mensajes de WhatsApp hoy

`src/lib/admin/metrics.ts:7,13,16`:

```ts
const CAP = 10000
const { data } = await admin.from(table).select(columns).limit(CAP)
if (rows.length === CAP) console.warn(`[admin] ${table} alcanzó el tope…`)
```

**Conteos reales de hoy**, de las 13 tablas que `/admin` agrega:

| tabla | filas |
|---|---|
| **`whatsapp_messages`** | **10.157** |
| `athos_messages` | 262 |
| `rag_retrieval_log` | 108 |
| `consultations` | 98 |
| el resto | menos de 80 |

`whatsapp_messages` **ya pasó el tope**. Y la guarda no puede avisar bien en ninguno de los dos
escenarios posibles:

- Si PostgREST corta en 1.000 —que es lo que el propio repo afirma haber medido,
  `src/lib/facturacion/queries.ts:78`— entonces `rows.length` es 1.000, la comparación
  `=== 10000` es falsa, **el aviso nunca sale**, y el panel reporta ~1.000 donde hay 10.157.
- Si no corta, `rows.length` es 10.000, el aviso sí sale, y el panel reporta 10.000 de 10.157.

En los dos casos la cifra está mal. En el primero, por un factor de diez y en silencio.

**Lo que falta para cerrarlo.** Distinguir entre los dos escenarios exige una petición autenticada
a PostgREST; con la anon key no alcanza, porque las tablas con más de 1.000 filas
(`glossary_synonym`, 7.353) tienen su policy restringida a `authenticated`.

**El defecto de fondo no es el número.** Una guarda que sólo dispara con `=== CAP` no puede
detectar un truncado impuesto por una capa de más abajo. La comparación correcta es contra el
tope real de la respuesta, no contra el que se pidió.

---

## 3 · 🟠 19.649 filas reales protegidas por una sola cosa

`public.appointments_importadas_respaldo`: **19.649 filas de 2 clínicas distintas**, con las
columnas completas de una cita (`clinic_id, patient_id, owner_id, vet_id, title, reason, notes,
starts_at…`). Es el respaldo de una importación.

- **RLS: desactivada.** Cero policies.
- `anon` no tiene `SELECT`. `authenticated` tampoco. **Hoy no está expuesta.**

No es una filtración. Es una asimetría: todas las demás tablas de clínica tienen **dos** defensas
—el grant y la RLS— y ésta tiene una. Un `grant select on all tables in schema public to
authenticated`, que es la clase de comando que alguien corre para desatascar algo, la convierte en
una fuga entre clínicas al instante y sin que nada más falle.

Es además la única tabla con `clinic_id` sin FK a `clinics`: no aparece en ningún recuento por
clínica ni se iría con ella.

---

## 4 · 🟠 73 claves foráneas sin índice

Reportadas por el advisor de rendimiento del propio Supabase. Con los volúmenes de hoy (79
pacientes, 36 citas) no cuestan nada, y por eso no se ven.

**La que ya está en un camino caliente:** `vaccines.clinic_id`. La tabla sólo tiene
`vaccines_pkey` y `vaccines_patient_idx`, y `src/lib/avisos/audiencia.ts:155-161` filtra por
`clinic_id` + `next_dose_at` para armar el segmento de vacunas por vencer. Es un recorrido
secuencial garantizado en cuanto una clínica tenga volumen.

El advisor reporta además **6 `multiple_permissive_policies`**: cada policy permisiva extra se
evalúa por fila.

Cuantificar cuáles de las 73 duelen de verdad es el objetivo de la prueba de carga; sin volumen,
el plan del optimizador no las distingue.

---

## 5 · 🟡 Medir con `service_role` da un resultado que no le pasa a nadie

`statement_timeout` por rol en el principal:

| rol | `statement_timeout` |
|---|---|
| `anon` | 3 s |
| `authenticated` | **8 s** |
| `authenticator` | 8 s (y `lock_timeout` 8 s) |
| `service_role` | **sin límite** |

Dos consecuencias:

1. **El corte duro de las pantallas son 8 segundos.** Lo que lo pase devuelve
   `57014 canceling statement due to statement timeout`, `data = null`, y el `?? []` de turno
   pinta una pantalla vacía sin error visible. Eso da un umbral de fallo objetivo, sin discutirlo.
2. Una consulta de 14 s «funciona» para un script con `service_role` y muere para el veterinario.
   Cualquier medición de rendimiento hecha con esa credencial **no mide el producto**.

---

## 6 · 🟡 `docs/API.md` declara 22 rutas; hay 41

El árbol tiene 41 `route.ts` bajo `src/app/api/` más 3 en `src/app/auth/`. El documento cubre poco
más de la mitad.

Relacionado: `DATABASE.md:15` documenta el MCP **sin** `read_only=true`, y `DATABASE.md:47` lo
nombra como la vía para «consultas, seeds, fixes» — las dos cosas contradicen los `.mcp.json`
reales, que están en sólo-lectura desde el incidente del 30-jul.

También siguen vivas en 4 archivos referencias al proyecto de dev `ghmpjyuchwkrvnjvdeum`, que **fue
borrado** y reemplazado por `gdiiagioiukadifejewv` el 31-jul (`ATHOS_CONTEXTO_EQUIPO.md:172,302`,
`ESTADO-PLATAFORMA-2026-07-28.md:32`, `athos-service/tests/test_db_guard.py:16`). Quien copie de
ahí apunta a un proyecto que no existe.

---

## 7 · Las cuatro hipótesis que se cayeron

Se registran porque tres de ellas habrían generado trabajo destructivo o duplicado.

**7.1 «Hay 85 ramas con trabajo sin subir.»** Falso. `git branch -r --no-merged` devuelve 85, pero
eso sólo dice que su punta no es ancestro de master — y con squash-merge ninguna punta lo es. La
prueba que decide es *qué archivos agrega cada rama que master no tenga*: de las 85, **una sola**
aportaba un archivo ausente (`docs/AUDITORIA-E2E-2026-08-16.md`, rescatado en `5d0910b`).
Fusionar las otras 84 habría resucitado código viejo por encima de correcciones nuevas.

**7.2 «Las migraciones 0091–0096 no están aplicadas.»** Falso. `ESTADO.md:1207` sólo declara
aplicadas hasta la 0090, pero la introspección del catálogo dice otra cosa: las tres columnas de la
0093 existen, `clinics.meta_ventas_mensual_cents` (0094) existe, y el trigger
`appointments_dia_completo` (0096) existe. **El documento está desactualizado, no la base.**

**7.3 «Hay un choque de numeración 0095 en master.»** Falso. Existe sólo en copias de trabajo
desactualizadas: origin renumeró `la_cita_sin_hora_cubre_el_dia` a **0096** en `ef06041`. El test
`numeracion-de-migraciones` falla en un árbol viejo y pasa en CI, que es exactamente lo que hay que
esperar.

**7.4 «El hallazgo alto del 16-ago sigue abierto.»** Falso — ver §8.

---

## 8 · Re-verificación de los 6 hallazgos de la auditoría E2E rescatada

| # | Hallazgo del 16-ago | Estado al 27-ago |
|---|---|---|
| 1 🔴 | El pago entregado puede no quedar registrado | **CORREGIDO.** En `src/lib/facturacion/invoices.ts` el pago declarado se registra en la línea 816, **antes** del inventario (881) y del documento fiscal (1004), que son los pasos que lanzan |
| 2 🟠 | La banda «evidencia limitada» se pierde en la nota clínica | Sin verificar en esta pasada |
| 3 🟡 | 27 de 32 pantallas sin título de pestaña | **Mayormente corregido.** Hoy **51 de 60** páginas declaran `metadata`. Faltan 9, entre ellas `/dashboard`, `/dashboard/settings` y `/signup` |
| 4 🟡 | Dos `<h1>` visibles por pantalla | Sin confirmar: el barrido por texto da falsos positivos — las apariciones en `calendario/page.tsx` están dentro de un comentario que explica por qué ahí NO hay `<h1>` |
| 5 🟡 | 14 páginas anidan `<main>` dentro de `<main>` | **Corregido.** Quedan 6 archivos con `<main>`, y son layouts y páginas de error, sin anidamiento |
| 6 🟢 | Los recordatorios de cobro salen a las 07:00, no a las 09:00 | **Sigue igual.** `.github/workflows/cartera-sweep.yml:22` es `*/15 12-23 * * *` UTC = desde las 07:00 de Bogotá. La ventana de la Ley 2300 la respeta el código; que arranque a las 7 y no a las 9 es una decisión de producto, no un defecto |

---

## Lo que queda abierto

- **§2** necesita una petición autenticada a PostgREST para distinguir el truncado de 1.000 del de
  10.000. Depende de una cuenta de prueba.
- **§4** necesita volumen para separar las 73 FK sin índice en «duelen» y «no duelen».
- **§8.2 y §8.4** quedaron sin verificar.
- El teardown de **§1** hay que rediseñarlo hoja→raíz **antes** de cualquier siembra: no se
  escribe nada que no se sepa borrar.
