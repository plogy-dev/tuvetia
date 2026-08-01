# Panel /admin — correcciones y ampliación

> **Para ejecutar DESPUÉS de la tanda de UI.** Escrito ahora para no perder el detalle mientras
> tanto. Nada de esto está empezado.

## Contexto

Felipe entró a `/admin` por primera vez (la variable `PLATFORM_ADMIN_EMAILS` ya está puesta, el
smoke lo confirma) y encontró cuatro problemas. Los verifiqué todos en código y en producción:

1. **Supabase figura en $0 "free tier"** — y sí se está pagando. `src/lib/admin/pricing.ts:20` tiene
   `supabaseMonthly: 0` con el comentario *"pasará a $25 al migrar el corpus"*. **Ese supuesto ya
   venció**: `ESTADO.md:42-43` confirma que el corpus ya está en el proyecto principal.
2. **Kapso no debería estar** — `pricing.ts:16` cobra `$29/mes` y `costos/page.tsx:39-41` lo muestra
   con un condicional mal atado: se dispara con **cualquier** fila de `whatsapp_integrations`,
   incluidas las de Evolution y Meta. `metrics.ts:49` ni siquiera lee la columna `provider`, que
   existe desde la migración `0028`. Hoy usan Evolution, así que el cargo es doblemente incorrecto.
3. **No aparecen Gemini ni Anthropic** — y la causa es más profunda que una fila faltante (ver §3).
4. Faltan **lista de usuarios con sus contactos** y **envío de correos** desde el panel.

**El panel es hoy 100% de solo lectura**: 4 páginas, 401 líneas, sin acciones ni mutaciones. Todo
sale de `loadPlatformMetrics()` (`src/lib/admin/metrics.ts`), que usa `service_role` y ve todas las
clínicas. Los datos son reales; **lo único "inventado" son las constantes de `pricing.ts`**.

**Límite de fondo, que conviene decir antes que nada:** ninguna tabla guarda tokens
(`rag_answer_log` tiene `model` pero no `prompt_tokens`/`completion_tokens`). Todo costo del panel
es **una estimación por número de llamadas × tarifa supuesta**, nunca el costo real. La página ya lo
advierte, pero muestra `$0` para Supabase como si fuera un hecho — que es justo lo que confundió.

---

## 1. Quitar Kapso

- Borrar `kapsoMonthly` de `pricing.ts:15-16` y su línea condicional en `costos/page.tsx:29,39-41`.
- Kapso es legado en retirada (`WHATSAPP.md:1,12`, `.env.example:116`). Si en algún momento vuelve a
  haber un tenant en Kapso, el cargo debe salir de `whatsapp_integrations.provider`, no de la mera
  existencia de una fila.

## 2. Corregir el costo de Supabase

- `pricing.ts:20` → el valor real del plan que se está pagando (Pro son $25/mes; **confirmar la
  cifra con la factura** antes de escribirla).
- Quitar el texto "free tier (→ $25 al migrar el corpus)" de `costos/page.tsx:38`.
- **Revisar también los otros fijos, que están igual de desactualizados:**
  - `railwayMonthly: 5` cuenta **un solo** servicio ("backend Athos"), pero Evolution añadió otro
    contenedor **y un Postgres propio** (`docs/EVOLUTION.md:10-17`) → hay 2-3 servicios facturando
    contra una línea de $5.
  - `vercelMonthly: 0` "plan free" es frágil con crons y funciones serverless.

## 3. Anthropic y Gemini — y por qué no basta con añadir una fila

Hay **dos causas distintas**, y sólo una se arregla en la página:

**(a) La tarifa es única y la etiqueta está congelada.** `costos/page.tsx:33` rotula todo como
"LLM (DeepSeek)" y aplica `llmPerCall` a cada fila de `rag_answer_log`. Pero con la cascada activa
el modelo **varía por llamada**, y ese dato ya está en la BD: `rag_answer_log.model`, que
`metrics.ts:44` ya trae y que `/admin/uso:74` **ya desglosa por modelo**. Arreglo: pasar de tarifa
única a **tarifa por modelo** (`Record<string, number>`) y agrupar con `countBy(m.answers, a => a.model)`.

**(b) El consumo de Anthropic es INVISIBLE, no sólo no mostrado.** El agente de Next
(`src/lib/athos-agent/model.ts` — 17 herramientas, modo auto de WhatsApp, visión de facturas) usa
Anthropic por defecto y **no escribe en `rag_answer_log` ni en ninguna otra tabla de uso**. Ninguna
página puede mostrar ese costo porque el dato no existe.
→ Para cubrirlo hay que **loguear primero**: una tabla (o columnas) de uso escrita desde el agente
de Next, idealmente con `tokens_in/out` que el AI SDK ya devuelve en `result.usage`. Eso resuelve de
paso el pendiente que el propio repo tiene anotado (`admin/uso/page.tsx:82-85`, `ESTADO.md`).

**Dos costos más que hoy no se cobran en ninguna línea:**
- **Cohere rerank** (`rerank-v3.5`) está en producción y sólo se cobra el embedding.
- Los servicios extra de Railway del punto 2.

## 4. Lista de usuarios con contactos

Nueva página `src/app/admin/usuarios/page.tsx`. **La RLS no es obstáculo** (el panel ya usa
`service_role`), pero el email tiene truco.

**Qué está disponible y dónde:**

| Dato | Fuente | Nota |
|---|---|---|
| Nombre, teléfono, rol, activo, alta | `public.profiles` | `metrics.ts:40` hoy sólo pide `clinic_id`; ampliar el `select` |
| **Email** | `auth.users` | **No es alcanzable por PostgREST**, ni con service_role |
| Clínica(s) | `public.memberships` | Es la fuente de verdad multi-clínica; `profiles.clinic_id` es sólo la **activa** |
| Contacto de la clínica | `public.clinics` (`phone`, `email`, `city`) | Ya en `public`, hoy sin traer |
| Usuarios pendientes | `public.invitations` | Invitados que aún no aceptaron |
| Último acceso / confirmación | `auth.users` | Señal útil: hay usuarios que se registraron y nunca entraron |

**Para el email, dos caminos** (elegir al ejecutar):
- `admin.auth.admin.listUsers({page, perPage})` — API Admin de GoTrue. Paginada (50/página) y hay
  que cruzar en JS contra `profiles` por `id`, que es el patrón que `metrics.ts` ya usa. **No se usa
  en ninguna parte del repo todavía.**
- Una RPC `security definer` tipo `get_platform_users()`, copiando
  `0040_team_management.sql:9-21` **sin** el `where clinic_id = private.my_clinic_id()` y con
  `grant execute` sólo a `service_role`. Más consistente con el repo, pero roza la regla dura
  *"service_role siempre con clinic_id explícito"* — habría que justificarlo en un comentario.

⚠️ **`get_clinic_members()` NO sirve acá**: filtra por `private.my_clinic_id()`, que bajo
service_role es NULL → devuelve 0 filas. Está pensada para el vet en su sesión.

**Nota práctica:** `profiles.phone` está **vacío en los 15 perfiles** de producción. Hoy "contactos"
es, en la práctica, sólo el correo.

**Reusar:** `ExportCsvButton` (`src/components/export-csv-button.tsx`) para bajar la lista, `TrLink`
para filas clicables, `Badge` para estados.

## 5. Enviar correos desde el panel

**Hoy no existe ningún remitente de plataforma.** Los dos transportes que hay:
- **SMTP por clínica** (`src/lib/email/smtp.ts` + `integrations.ts`), con credenciales cifradas por
  tenant. `sendEmail(creds, input)` **ya es agnóstico** — no sabe de facturas ni de cartera.
- **`inviteUserByEmail`** (Supabase Auth), que es un martillo de un solo clavo: sólo manda la
  plantilla de invitación, **no permite asunto ni cuerpo propios**, y está fuertemente
  rate-limited.

**Camino de menor fricción:** un `loadPlatformEmailCredentials()` que arme el mismo objeto
`EmailCredentials` desde variables de entorno, y reusar `sendEmail()` **sin tocarlo**.

**DECISIÓN PENDIENTE (Felipe la tomará al ejecutar):** SMTP propio de `esvdt.com` (reusa todo, cero
transporte nuevo, entregabilidad limitada al enviar a muchos) vs. Resend o similar (mejor
entregabilidad y métricas de rebote, ~$20/mes pasados 3k correos, exige verificar el dominio con
SPF/DKIM/DMARC).

**Alcance pedido: individual Y masivo.** El masivo no es "lo mismo pero en bucle" — hay que resolver
también:
- **Consentimiento**: si el contenido es comercial y no operativo, hace falta base legal. El equipo
  ya trata esto para cobranza (Ley 2300); aquí aplica el régimen de datos personales (Ley 1581).
- **Rebotes y bajas**: un envío masivo sin manejo de rebotes quema la reputación del dominio, y sin
  enlace de baja no debería salir.
- **Ritmo**: enviar en lote satura cualquier SMTP; hay que espaciar y reintentar.
- **Registro**: dejar traza de a quién se le envió qué y cuándo.

Sugerencia de orden: **entregar primero el envío individual** (desde la fila del usuario, con el
molde de `team-settings.tsx:103-116`: confirmar → acción → `router.refresh()`), y el masivo como
segunda fase una vez elegido el transporte.

---

## Archivos principales

| Archivo | Qué cambia |
|---|---|
| `src/lib/admin/pricing.ts` | Quitar Kapso; corregir Supabase y Railway; tarifas **por modelo** |
| `src/app/admin/costos/page.tsx` | Quitar la línea de Kapso; agrupar por `model`; añadir rerank y los Railway extra |
| `src/lib/admin/metrics.ts` | Ampliar los `select` de `profiles` y `clinics`; añadir `provider` a `whatsapp_integrations`; traer `memberships` e `invitations` |
| `src/app/admin/usuarios/page.tsx` | **Nueva** — lista con contactos y export CSV |
| `src/lib/email/platform-sender.ts` | **Nuevo** — credenciales de plataforma desde env, reusando `sendEmail` |
| `src/lib/athos-agent/` + migración | **Sólo si se quiere el costo real de Anthropic**: loguear uso del agente de Next |

## Verificación

1. **Costos**: contrastar el total del panel contra las facturas reales del mes de Supabase, Railway
   y Vercel. El objetivo no es que cuadre al centavo —es una estimación— sino que **ningún proveedor
   que se paga aparezca en $0** y que no se cobre ninguno que no se use.
2. **Kapso**: con integraciones de Evolution activas, la línea de Kapso **no debe aparecer**.
3. **Usuarios**: la lista debe traer los 15 perfiles de producción con su correo, y cuadrar con
   `select count(*) from profiles`. Verificar que un usuario en dos clínicas aparezca correctamente.
4. **Correo**: enviarse uno a sí mismo desde el panel y confirmar recepción, remitente y que quede
   registrado. Antes del masivo, revisar SPF/DKIM del dominio.
5. **Gates**: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`.

## Fuera de alcance

- **Acciones sobre clínicas** (suspender, borrar). `clinics.subscription_status` existe en el esquema
  (`trial|active|past_due|canceled`) y el panel ni lo lee — es el candidato natural, pero es otra
  tanda.
- **Costo real por tokens**: exige loguear `tokens_in/out` en todo el pipeline, no sólo en el agente.
- **Escala**: `metrics.ts` trae todas las filas a memoria en cada render. El propio archivo lo
  advierte (`metrics.ts:3`): con >100 clínicas o >100k filas hay que mover las agregaciones a SQL.
