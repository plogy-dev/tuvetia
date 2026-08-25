# Estado del proyecto — Handoff (2026-07-25)

Doc vivo para que cualquier dev que abra el repo esté al día. Front (Next.js, raíz) + backend Athos
(`athos-service/`, FastAPI). DB: Supabase (proyecto principal `auxlnexhkmtoedrzfsnz`). Deploy: front en
Vercel, backend en Railway (auto-deploy en cada push a `master`).

> **Reglas del repo:** leé `AGENTS.md` / `CLAUDE.md` (raíz) y `athos-service/CLAUDE.md`. Docs de apoyo:
> `DATABASE.md`, `CALENDARIO.md`, `athos-service/DEPLOY.md`.

---

## Tanda de rendimiento y bugs — auditoría E2E (2026-07-24/25, en `master`)

Se auditó la plataforma completa con 4 revisiones (rendimiento back/front, funcionalidad, auth) y
se aplicó todo lo accionable:

- **Login estabilizado** (`1601ec0` + `85ca919`): el middleware ya NO pierde las cookies
  refrescadas en los redirects (causa raíz de los deslogueos/loops); `ensureClinicForUser` y
  `getUser` ya no rompen el login; los fallos de `/auth/*` **se muestran** en el formulario con
  su motivo (antes `?error=auth` se tragaba en silencio).
- **Backend rápido** (`0806f9a` + `4e82032` + `f14a032`): pool de conexiones (psycopg_pool),
  fail-fast de Cohere (429 en ~2s y **timeout de 6s** al embed de consulta → degrada a Tier 1),
  **Tier 1 ∥ Tier 2 en paralelo**, caché del glosario (TTL 5 min) y del embedding de consulta
  (LRU), panel de condiciones con `LLM_LIGHT_MODEL`, traza del chat en background. Índices
  hot-path en migración `0020` (aplicada al principal por MCP, ver §Migraciones).
- **Frontend fluido** (`8028dbc`–`5136a0c`): `loading.tsx` por ruta, react-big-calendar/recharts/
  driver.js/xlsx diferidos, búsqueda de pacientes client-side (antes 5 queries por tecla),
  Asistente servidorizado, ficha del paciente sin sobre-traer transcripciones.
- **Bugs**: WhatsApp ya no duplica el enviado ni pierde entrantes (cursor del poll); `notes[0]`
  ordenado (nota aprobada ya no aparece como "Borrador"); citas "próximas" solo con estados
  pendientes; edad unificada lista/ficha (`src/lib/age.ts`); import "6m" = 6 meses; invitación
  nominal (verifica el email de la sesión); `profiles` con `clinic_id` explícito; errores de
  query visibles en todos los listados (`DataError`), ya no parecen "sin datos".

**Corpus → PRINCIPAL: ✅ EN PRODUCCIÓN (2026-07-26).** El principal tiene **61.544 docs /
519.999 chunks** con embedding (ingesta completa, cero duplicados) y **todos los índices**:
HNSW + GIN mesh/metadata/tsv + ANALYZE. El build HNSW se hizo con **resize temporal del compute
a XL** vía Management API (en Micro el build no es viable: el grafo de ~2.5GB no cabe y el build
on-disk proyectaba semanas; en XL tardó 3.9 min). Gate golden **11/11 retrieval-only** contra el
principal, verificado en XL y re-verificado en Micro (los 2 `[corpus_gap]` conocidos —
gi-stasis-rabbit y acute-gastroenteritis — pasan igual). **`CORPUS_DATABASE_URL` en Railway ya
apunta al principal** (idéntica a `DATABASE_URL`); redeploy SUCCESS y smoke en vivo OK
(`/health` 200, `/athos/chat` sin JWT → 401). **Rollback = revertir la variable a la URL de dev.**
Ojo: el `.env` local de `athos-service` sigue con `CORPUS_DATABASE_URL` → dev.

---

## Tanda de CALIDAD de Athos (2026-07-27, en `master`)

Mandato: que Athos responda "como un veterinario experimentado con memoria infinita", no solo
rápido. **El modelo de redacción lo elige el cliente por costos y NO se cambia: DeepSeek
(`deepseek-v4-flash`)**, aunque `athos-service/CLAUDE.md` documente `claude-sonnet-5`.

**Lo primero fue construir con qué medir** (`athos-service/scripts/calidad/`, ver su README): el
golden de 11 casos está SATURADO y da 11/11 casi pase lo que pase. El banco nuevo ancla la verdad
de terreno al corpus: 146 casos positivos + 42 negativos de control.

- **Reranking con Cohere** (`app/retrieval/rerank.py`, `rerank-v3.5`) — EN PRODUCCIÓN. Cross-encoder
  sobre los 40 candidatos fusionados, deja 15. **Target en el top-15: 37,8% → 69,7%; mediana del
  primer acierto: puesto 15 → puesto 2.** Casi el mismo recall con 2,7× menos contexto. Degrada con
  gracia (sin key/timeout/429 → sigue sin rerank). El umbral se evalúa ANTES del rerank: activarlo
  cambia QUÉ literatura llega a la generación, nunca cuándo Athos se abstiene.
- **Memoria semántica del paciente** (`app/patient_memory.py`) — EN PRODUCCIÓN. `patient_embeddings`
  estaba vacía, `history_snippets` se devolvía fijo en `[]` y **el campo no se usaba en ningún
  prompt**. Ahora indexa notas `approved`/`locked` (nunca `draft`: un borrador es salida cruda del
  modelo) + transcripciones, y recupera por similitud con `clinic_id` Y `patient_id` explícitos.
  Reusa el vector que el Tier 2 ya cachea → recordar no cuesta otra llamada a Cohere. Se indexa
  perezosamente en background al consultar (la aprobación pasa por el front: el backend no tiene
  evento donde enganchar). En el prompt va marcada como contexto, NO como literatura: no se cita.
- **Glosario**: de 41 términos approved a **~800 descriptores / 2.658 sinónimos ES** activos
  (3 tandas, cada una con gate: golden 11/11 y sin regresión de distilación). Quedan ~1.450
  descriptores en `candidate` (inertes hasta aprobarse).

### ⚠️ Abierto y conocido

1. **La abstención NO dispara nunca**: `passes_threshold` da True en **187/187** casos, incluso sin
   un solo chunk de la condición. `TIER1_MESH_BASE`=0.6 y `TIER1_LEX_BASE`=0.4 ya superan
   `THRESHOLD`=0.35, y el MeSH de especie ("Dogs", en 43k chunks) cuenta como evidencia temática.
   Medido: ningún umbral sobre el score determinístico puede separar (mediana **1.701 vs 1.700**),
   ni sobre el del reranker (0.532 vs 0.499). **Y las citas tampoco: mediana 6,0 en ambos grupos —
   el modelo cita con la misma soltura cuando la literatura no cubre la consulta**, así que la
   verificación de citas produce apariencia de fundamento (confirma que cada `[n]` existe, no que
   responda la pregunta). El juez semántico con el LLM liviano sí separa (7,0 vs 5,0) a ~1,8s.
   **Diseño propuesto: banda en vez de binario** — abstención dura solo en lo clarísimo, banda
   intermedia que responde declarando evidencia limitada, resto normal.
2. **Recall ciego**: condiciones con literatura abundante que el retrieval NUNCA trae — `Distemper`
   (1.338 chunks), `Lymphoma`, `Tick Infestations`, `Coccidiosis`, `Toxocariasis`. No es culpa del
   rerank (ya faltaban antes). Sin diagnosticar.
3. **Compute del principal**: quedó en **Micro** tras el resize a XL (el `DELETE` del addon no
   revierte a Nano; la Management API no expone `ci_nano`). Decisión del dueño: se queda así.

---

## Qué se construyó en esta tanda (PRs #4–#9, todos mergeados a `master`)

### E5 · Modo Fantasma — captura y transcripción (cerrado)
Flujo completo: **grabar → consentimiento (Ley 1581) → Storage → `consultation_audios` →
`POST /athos/transcribe` (Deepgram nova-2, es, diarize) → `transcripts` → `/athos/phantom/suggest` →
nota SOAP `draft` → el vet aprueba**. Verificado end-to-end en vivo.
- UI: `src/components/consultation-recorder.tsx`, revisión en `dashboard/consultas/[id]`.
- Cliente: `src/lib/athos.ts` (`athosTranscribe`). Backend: `athos-service/app/transcription.py`.

### Historia clínica del paciente
`/dashboard/patients/[id]`: ficha + alergias/medicación/vacunas + consultas con **transcripción**,
**audio reproducible** (signed URL del bucket privado) y **eliminar transcripción** (RPC
`delete_transcript`, solo el texto; el audio se purga a 7 días).
- ⚠️ **Deuda de UX conocida:** la distribución de esta página (maestro-detalle) se considera **confusa**;
  hay que **rediseñarla** (2 intentos no convencieron). Preguntar al usuario qué confunde antes de rehacer.

### Calendario interno + Google Calendar + ICS
`/dashboard/calendario` con **react-big-calendar** (mes/semana/día, drag&drop). Detalle completo en
**`CALENDARIO.md`**. En resumen:
- Citas sobre `public.appointments` (RLS por clínica). RPCs `create_appointment`/`update_appointment`.
- **Google Calendar por vet (opt-in)** — push/pull vía `/api/google/calendar/*`. Tokens en
  `calendar_integrations` (secretos ocultos al cliente).
- **Feed ICS** de solo lectura (`/api/calendar/ics/[token]`) — sin OAuth ni verificación de Google.
- **Login sin fricción:** el login NO pide el scope de calendario (evita la pantalla de "app no
  verificada" en el registro); el calendario es opt-in con el botón "Conectar Google Calendar".

### Dashboard home real
`/dashboard` dejó de ser scaffold: 4 métricas reales (consultas del mes, pacientes, citas próx. 7 días,
notas por revisar), gráfico de consultas por semana y próximas citas. Se borraron los componentes de
ejemplo (`chart-area-interactive`, `data-table`, `data.json`).

### Onboarding para usuarios no técnicos
- **Tour guiado** (`driver.js`) la primera vez (`OnboardingTour`), una sola vez por navegador
  (`localStorage`) + RPC `mark_onboarded`.
- **Marcadores "?"** contextuales reutilizables (`HelpTip`), sembrados en calendario y grabador.

### Limpieza
Sidebar sin código muerto (`navClouds`), logo→`/dashboard`, **Configuración** (`/dashboard/settings`) y
**Ayuda** (`/dashboard/ayuda`) reales; páginas legales (`/legal/terminos`, `/legal/privacidad`) "en
preparación" enlazadas desde login/signup; `login-form` traducido al español.

---

## Migraciones (⚠️ IMPORTANTE)

Los archivos `athos-service/supabase/migrations/0004`–`0013` de esta tanda **YA están aplicados al
proyecto principal (prod) por MCP**. **NO corras `supabase db push` de esos contra el principal** — las
sentencias `create policy`/`create table` fallarían por "ya existe". Son fuente de verdad para entornos
nuevos; si el flujo del equipo usa el CLI, marcalos como aplicados (`supabase migration repair`).

`0005 phantom_audio_storage` · `0006 appointment_rpcs` · `0007 calendar_integrations` ·
`0008 calendar_feeds` · `0009 delete_transcript` · `0010 optimize_calendar_rls` ·
`0011 appointment_fk_indexes` · `0012 audio_storage_path_nullable` · `0013 profiles_onboarded_at` ·
`0014 hot_path_indexes` · `0015 whatsapp_integrations` · `0016 invitations_rpcs` ·
`0017 onboarding_setup` · `0020 hot_path_indexes_2` (índices de la auditoría E2E, 2026-07-24).

**Aplicadas el 2026-08-23 al principal, las dos verificadas ahí mismo:**
`0078 la_prueba_de_tres_dias` (trigger que estampa `pro`+`trial`+3 días en toda clínica nueva) ·
`0079 una_factura_no_se_acredita_de_mas` (trigger que impide que la suma de notas crédito EMITIDAS
supere el total de la factura — la comprobación en código es leer-y-después-escribir y dos
peticiones simultáneas la pasaban las dos).
(`0004 clinical_notes_alerts` vino de otra rama.)

---

## Configuración pendiente (manual — no es código)

Para activar lo que hoy está **dormido**:

**Vercel → Environment Variables (Production):**
- `SUPABASE_SERVICE_ROLE_KEY` — service_role del principal (Google sync + ICS + cron de purga).
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — del OAuth client de Google (sync de calendario).
- ⚠️ `CRON_SECRET` — **OBLIGATORIA**. Protege los dos crons (`/api/cron/purge-audio` y
  `/api/cron/cartera`). Antes era opcional de hecho: el código hacía `if (secret && ...)`, así que
  sin la variable el endpoint quedaba **abierto** y funcionaba igual. Ahora ambos devuelven **503**
  si falta — y sin ella la **purga de audio deja de correr**, que es la retención a 4 días de la Ley
  1581. Generala con `openssl rand -base64 32`. Vercel manda `Authorization: Bearer <valor>` en cada
  disparo solo cuando la variable existe. Es una env **de Vercel**: athos-service (Railway) no la lee.

**Google Cloud + Supabase (sync de calendario):**
- Google Auth Platform: habilitar Calendar API, agregar scope `calendar.events`, y **test users** (hasta
  100, sin verificación) para probar ya; la **verificación** de Google (~10 días) solo hace falta para
  abrir al público sin la pantalla de advertencia.
- Supabase Auth → Google provider con el mismo Client ID/Secret; dominio de Vercel en Redirect URLs.

**Railway (backend):** ya tiene `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DEEPGRAM_API_KEY`
(la transcripción funciona en vivo).

---

## Ownership
- **Comunicaciones / WhatsApp**: base multi-tenant vía Kapso **y bandeja completa CONSTRUIDAS**
  (conexión por QR en Configuración; bandeja con envío en `/dashboard/comunicaciones` — ver
  **`WHATSAPP.md`**, migraciones `0015`/`0018`). Al otro dev le quedan las **extensiones**
  (plantillas/media, realtime, firma oficial del webhook — §Extensiones de `WHATSAPP.md`).
  Config externa: `KAPSO_API_KEY` + `KAPSO_WEBHOOK_SECRET` en Vercel + webhook registrado en Kapso.
- Todo lo de **Athos** (copiloto, corpus, citas, y sus piezas de front) → equipo Plogy (ver
  `athos-service/docs/ATHOS_CONTEXTO_EQUIPO.md`).

## Equipo y panel admin (2026-07-24)
- **Invitaciones** (PR #13): Configuración → Equipo — un admin invita colegas (link `/invitar/<token>`
  + email best-effort). RPCs `create_invitation`/`has_pending_invitation` (migración `0016`); el alta
  ya no crea clínica huérfana a invitados. `accept_invitation` (del esquema base) hace la asignación.
- **Panel de plataforma `/admin`** (Resumen · Clínicas · Uso IA · Costos): gate por
  **`PLATFORM_ADMIN_EMAILS`** (env de Vercel, lista por comas; sin la env nadie entra; no-admin → 404).
  Datos vía service_role (todas las clínicas). Costos = estimación con `src/lib/admin/pricing.ts`
  (los logs NO guardan tokens — **mejora recomendada al equipo Athos: loguear `tokens_in/out` en
  `rag_answer_log`**). Rate limits: hoy solo observabilidad (pico msgs/día por clínica); enforcement
  en backlog.

## Onboarding de vets nuevos (2026-07-24)
- **Wizard `/bienvenida`** (primer login del creador de clínica; flag `profiles.setup_completed_at`,
  migración `0017` con backfill): bienvenida → clínica/perfil → primer paciente → **datos de ejemplo**
  ("Luna (ejemplo)" con transcript + nota draft, borrable) → invitar equipo. Todo saltable.
- **Checklist "Primeros pasos"** en el dashboard (checks con datos reales; auto-oculta al completar).
- Los **invitados NO ven el wizard** (`accept_invitation` marca el setup). El tour driver.js convive.

## Sesión 2026-07-28 — WhatsApp estable + capa provider, Athos agéntico, landing del cliente, seguridad

Plan completo en `~/.claude/plans/claude-varios-ajustes-dame-compiled-grove.md`. Lo entregado:

- **WhatsApp estabilizado (Track 1)**: el bug raíz era el path inexistente `GET /platform/v1/phone-numbers`
  (el real es `/whatsapp/phone_numbers?customer_id=`) — la conexión nunca pasaba a `connected`.
  Además: webhook sin hack cross-tenant (tenant por `metadata.phone_number_id`, statuses con scoping),
  auth por header + timingSafeEqual + GET challenge de Meta, inbox sin duplicado optimista y con
  cursor de BD (el poll ya no se ciega), `failed_at`/`error_detail` visibles (migración `0027`),
  origin del redirect por `NEXT_PUBLIC_SITE_URL`/x-forwarded-host.
- **Capa proveedor-agnóstica + Meta directo (Track 2)**: `src/lib/whatsapp/` (provider/kapso/meta/
  crypto AES-GCM/send-message/verify), migración `0028` (columna `provider`, waba_id, token cifrado
  y revocado para PostgREST), **Embedded Signup en popup** (`whatsapp-settings` + `/api/whatsapp/exchange`)
  sin redirect. Kapso queda como legado en transición. Trámite Meta documentado en `WHATSAPP.md`
  (verificación de negocio + App Review + config_id — admin pendiente). Plantillas de citas en
  `scripts/create-wa-templates.mjs`.
- **Athos agéntico (Track 3, Next + Vercel AI SDK)**: "Athos propone, el vet ejecuta". Agente en
  `/api/athos/agent` (claude-sonnet-5, tools con la SESIÓN del vet → RLS/RPCs con auth.uid() real),
  registry en `src/lib/athos-agent/`, tabla `athos_actions` (migración `0029`) + `audit_logs` en uso,
  rutas execute/reject con `payload_override`, tarjeta `action-approval-card`, "Sugerir" del inbox
  persiste la propuesta (sobrevive recargas; enviar = aprobar), badge de pendientes en el sidebar,
  `clinic_hours` (migración `0030` + UI en Configuración) y tool determinística de cupos,
  `POST /athos/retrieve` en athos-service (retrieval sin LLM para la tool de evidencia),
  **modo auto opt-in** (migración `0031` + toggle): webhook → `after()` → `maybeAutoReply` con
  debounce 5 s, idempotencia, límite diario, anti-loop 8/h y **nada clínico jamás** (haiku clasifica;
  ante duda, silencio). Envs nuevas: `ANTHROPIC_API_KEY` (obligatoria), `ATHOS_AGENT_MODEL`,
  `ATHOS_AUTO_MODEL`, `WHATSAPP_TOKEN_KEY`, `META_*` (ver WHATSAPP.md).
- **Seguridad (Track 4, migración `0026` aplicada)**: RLS en `corpus_chunks`, revoke `anon`/PUBLIC en
  las ~20 RPCs SECURITY DEFINER (+default privileges), bucket `clinic-logos` sin listado, `POST /ingest`
  eliminado de athos-service. Advisors verificados: el ERROR y los WARN de anon desaparecieron.
  Pendiente del humano: habilitar leaked-password protection en el dashboard de Auth y el
  `supabase migration repair` del drift CLI.
- **Landing + design system del cliente (Track 5)**: el repo `landing-tuvetia` resultó ser un
  Tuvetia paralelo completo (ver memoria del proyecto). Se portó: landing pública entera
  (`(marketing)`: `/`, `/producto`, `/seguridad`, `/demo`), login movido a `/login` (blindaje OAuth
  intacto), tokens de marca + `.app-theme` azul (Tailwind v4), fuentes Inter Tight/Bricolage/
  JetBrains/Archivo/Instrument Serif, logo "chispa", marca canónica **Tuvetia**.
- **Evolution API como tercer proveedor (migración `0032`)**: Baileys / WhatsApp Web NO oficial, para
  las clínicas que no quieren pasar por la verificación de Meta. Webhook propio en
  `/api/whatsapp/evolution/webhook/[token]` (Evolution no firma: la auth es el token de la URL en
  tiempo constante + la instancia debe existir). Grupos, broadcasts y newsletters se ignoran SIEMPRE.
- **Facturación y cartera portadas (migraciones `0033`–`0036`)**: núcleo fiscal DIAN, catálogo,
  inventario, compras y gastos + el motor de recaudo con los límites de la Ley 2300. Dominio puro y
  determinístico con 185 tests. Dinero = enteros en centavos, half-up. **La UI entró el 30-jul**
  (`bfd5150`, 16 rutas bajo `/dashboard/facturacion/*` — ver la sección de abajo); lo que sigue sin
  cubrir son pruebas propias de esas rutas (los 185 tests son del dominio, no de la interfaz).

### ⚠️ Numeración de migraciones (leer antes de crear una nueva)
Las migraciones de esta tanda se renumeraron a **`0026`–`0036`** el 29-jul, porque `0021`–`0025` ya
estaban ocupadas por las de multi-clínica que entraron en paralelo. No es cosmético:
`0026_security_hardening` hace `revoke execute` sobre `switch_active_clinic` y
`enforce_profile_clinic_invariant`, que crean `0021`/`0022` — con la numeración anterior corría antes
que ellas y **fallaba en cualquier entorno nuevo**.

> **Al 2026-08-24 la última aplicada es la `0084`, y la próxima arranca en `0085`.** Esta línea
> decía `0037` hasta hoy — o sea que llevaba 47 migraciones desactualizada, que es exactamente
> el problema que este archivo se advierte a sí mismo en «Pendientes conocidos». Quien cree una
> migración la actualiza acá en el mismo PR.
>
> ⚠️ La **`0080`** (de Santiago: `metricas` en `tablero_preferencias`) **no está aplicada al
> principal** — verificado el 24-ago. Su código sí está en master.

Los duplicados `0019` y `0020` (dos archivos cada uno) son historia ya aplicada en prod y se dejan
como están: la BD las ordena por su timestamp real, no por el prefijo del archivo.

> **Ojo con el drift prod vs. código:** las migraciones `0026`–`0036` **ya están aplicadas al
> proyecto principal** (por MCP, 28-jul noche). O sea que el esquema vive en producción desde antes
> que el código que lo usa — incluido el de facturación, que todavía no entró. No las reapliques.

## Correo: por qué SMTP/IMAP y no la API de Gmail (decisión 2026-07-30)

Verificado contra la documentación de Google y de Microsoft, no de memoria:

- Leer el buzón con la **API de Gmail** exige `gmail.readonly`/`gmail.modify`, que Google clasifica
  como **RESTRINGIDO**. Para una app *External* eso implica verificación **+ evaluación de seguridad
  de terceros (CASA)**: meses y con costo.
- Las **App Passwords están exceptuadas** del requisito de OAuth. Google, textual: *"You will no
  longer use a password for access (**with the exception of app passwords**)"*. Siguen sirviendo para
  SMTP **e IMAP** después de la transición de marzo 2025.
- Por eso el transporte es **SMTP para enviar + IMAP para leer**: enviar y leer, sin ninguna revisión.
- Y es la base correcta para **Outlook**: IMAP es un estándar, así que la implementación de lectura
  se reusa. La API de Gmail solo serviría para Gmail y obligaría a una segunda implementación con
  Microsoft Graph.
- ⚠️ **Outlook NO admite contraseña**: Microsoft deshabilitó basic auth en todos los tenants y
  *"no one (you or Microsoft support) can re-enable"* — incluye las app passwords. Outlook necesita
  OAuth (Entra app). La buena noticia: Microsoft **no** exige el equivalente a CASA, así que su
  trámite es notablemente más liviano que el de Google.

### 📋 BACKLOG — Opción A: app OAuth "Internal" de Workspace (plan B del correo)

Guardado a pedido, **no descartado**. Google: *"For apps used only internally by your Google
Workspace organization, scopes aren't listed on the consent screen and use of restricted or sensitive
scopes **doesn't require further review by Google**"*. O sea que con Workspace se pueden usar los
scopes restringidos sin revisión.

**Cuándo activarlo:**
1. Si un admin de Workspace **desactiva las App Passwords** a nivel organización → el camino actual
   se cae y este es el reemplazo.
2. Si se necesita **push** en vez de polling (la API de Gmail tiene notificaciones; IMAP no).

**Lo que hay que saber antes de elegirlo:** *"Internal"* significa usuarios de la misma organización
que **el proyecto de Google Cloud donde vive la app OAuth**. O sea que la app **no puede vivir en
nuestro proyecto**: tiene que estar en el del cliente. Consecuencia — **un setup por Workspace**, con
credenciales de ellos. No generaliza a multi-tenant: cada clínica nueva con otro dominio necesita que
su admin cree la app. Habría que guardar credenciales de Google **por clínica**, no una global en env.

**Variante preferible si se activa:** *service account con domain-wide delegation*. El admin autoriza
una vez en la consola (Security → API controls → Domain-wide delegation), no hay consentimiento por
usuario ni refresh tokens que expiren — mucho mejor para un cron que recorre hilos. Y el módulo de
envío/lectura no cambia: solo la capa que obtiene el token.

**Qué pedirle al cliente si se activa:** que confirme Workspace con dominio propio, que **todos** los
vets estén en ese dominio, acceso de admin a la consola y a Google Cloud, y SPF/DKIM configurados.

## Sesión 2026-08-23 — facturación, la capa agéntica medida, velocidad, y dos cerrojos que no cerraban

Trece PRs a `master` (#194–#206) y dos migraciones aplicadas al principal. Lo que sigue está ordenado
por lo que le sirve a quien abra el repo mañana, no por orden cronológico.

### Lo que se puede mostrar

- **Nota crédito PARCIAL** (#194). Varias notas sobre la misma factura, con techo en lo ya
  acreditado; la que completa el total anula. La parcial **no mueve inventario** y la pantalla lo
  dice antes de emitir: sin saber qué línea se acredita no hay forma de saber qué volvió. Lo que
  falta es la nota crédito **por línea**, y ahí sí una devolución parcial cerraría entera.
- **La prueba gratuita de 3 días** (#199, migración `0078`). Decidida en la reunión del 22-ago; no
  existía nada en el código. No hay columna nueva: una prueba es `plan='pro'` +
  `subscription_status='trial'` + `plan_renueva_en`. La estampa un trigger al nacer la clínica y la
  baja el barrido diario.
- **El correo se lee entero** (#198). El panel de lectura pintaba `preview` —el mismo campo
  recortado a 200 caracteres de la lista—, así que abrir un correo no mostraba nada nuevo. Lo
  reportó un vet en la reunión del 22-ago.
- **El agente ya sabe que lo que LEE es dato** (#195) y hay un **banco adversario** para medirlo
  (#196/#197). Ver los bullets de Pendientes.
- **Fuera el enlace ICS** del calendario (#204). Se va la entrada; el endpoint queda, porque un feed
  que alguien ya pegó en su Google Calendar se sigue consultando y borrarlo le rompería la agenda sin
  avisar. Los tokens vivos están en `calendar_feeds`.

### Velocidad: qué se midió y qué NO era

Un vet reportó lentitud. Lo medido contra el despliegue, y **casi todo lo que se sospechaba era
falso**:

- **Postgres no es el cuello.** `pg_stat_statements` lo dominan el retrieval y la ingesta del corpus
  (17 s y 44 s de media). Ninguna consulta de la app aparece con tiempo relevante.
- **Las consultas ya estaban paralelizadas**: las 5 páginas del dashboard con 2+ consultas usan
  `Promise.all`. Cero pendientes.
- **Los índices sobran, no faltan**: 64 FKs sin índice, todas INFO — y **42 índices que nunca se
  usaron**.
- **Sí hay un piso fijo**, y ése era el problema: `/dashboard/ayuda` —una página SIN una sola
  consulta— tardaba **1.061 ms**, lo mismo que `/dashboard/tablero` con muchas (930 ms). Contra 289
  ms de una estática sin sesión.

Se quitaron dos viajes de red encadenados (#201): la clínica viaja embebida en el perfil y
`sesionDelServidor()` memoiza la sesión con `cache()` de React. **La mejora medida fue ~100 ms, no
los 300-400 estimados** — y esa diferencia enseñó más que el arreglo.

**Después se instrumentó el layout** (#203, `lib/perf/marcas.ts`, se activa con la cabecera
`x-perf: 1`) y el reparto quedó a la vista:

```
sesión (getUser)                265 ms
perfil + clínica embebida       278 ms
progresoDeConfiguracion()       443 ms   ← 43 % del layout
resto (render, cookies)          37 ms
total del layout              1.023 ms
```

**Un `getUser()` cuesta 265 ms.** Ése era el número que faltaba. Con Postgres respondiendo en
microsegundos, eso apunta a que **la función de Vercel y el proyecto de Supabase están en regiones
distintas** — `vercel.json` no fija región, así que las funciones corren en `iad1`. **Comprobarlo es
un dato de dos dashboards y es la palanca más grande que queda**: dividiría los cuatro viajes, no uno.

Lo que sigue sin hacer y sale barato: `requireClinicPage()` todavía hace su propio `getUser()` (−265
ms en todo el dashboard y en facturación), y `progresoDeConfiguracion()` podría salir del camino
crítico con `<Suspense>` — es una barra de onboarding que para una clínica configurada cuesta 443 ms
por navegación para pintar un 100 %.

### El apagón, y los dos cerrojos que no cerraban

**Se rompió el acceso al dashboard durante ~20 minutos** (#201, arreglado en #202). El embed
`clinic:clinics(...)` es **ambiguo**: hay DOS claves foráneas entre `profiles` y `clinics`
(`profiles.clinic_id` y `clinics.owner_id`). PostgREST lo rechaza, y como la consulta termina en
`.single()` ese rechazo **no llega como error** sino como `data: null` — perfil vacío,
`estadoDeAcceso` lo lee como "sin onboarding", y el layout redirige a `/bienvenida`. La app no abría
para nadie. La forma correcta ya estaba en el repo (`clinica-de-la-sesion.ts` trae
`clinic:clinics!profiles_clinic_id_fkey(plan)`) y se perdió al copiar el patrón.

**Y después el cerrojo que se puso para que no se repitiera estaba muerto** (#206): el test tenía un
BACKSPACE literal (0x08) donde iba `\b`, así que el patrón no matcheaba nunca nada y pasaba en verde
sin leer una línea. Se descubrió al intentar reforzarlo, porque la mutación no lo ponía en rojo.

**Las dos verificaciones de migración de hoy también fallaron por su propio SQL**, no por la
migración: la de la `0078` se contaba a sí misma, la de la `0079` omitía una columna NOT NULL. En los
dos casos la migración estaba bien y el examen mal.

> **La lección operativa, que vale más que los arreglos:** una guarda que nadie probó que MUERDE no
> es una guarda. Verificar que un test se pone en rojo al revertir lo que protege costó minutos y fue
> lo único que destapó el cerrojo muerto. Vale para cualquier test nuevo, y sobre todo para los que
> existen para que no se repita algo.

### El review, y qué dice de cómo se trabajó hoy

Un review sobre los diez PRs del día encontró **15 hallazgos** (#205, #206). Los más graves, todos
verificados contra el código antes de tocarlos:

- **El CUFE de la segunda nota crédito apuntaba a la primera.** Las notas se registran en
  `fiscal_documents` con el `invoice_id` de la factura, y el CUFE se leía como "el documento más
  reciente de esta factura" sin filtrar `doc_kind`. Con una sola nota era inalcanzable; las parciales
  lo volvieron el camino normal.
- **La guarda que protege la plata no revisaba su propio error.** Un SELECT fallido dejaba
  `yaAcreditado` en 0 y reabría el crédito completo. Todas las demás lecturas de esa función sí lo
  revisan.
- **El panel no se cerraba tras una parcial** → segundo clic, otro consecutivo DIAN quemado.
- **El cuerpo de Outlook es HTML** y nadie lo limpiaba: desde #198 un vet con Outlook veía
  `<html><head>…` literal en pantalla. Peor que antes, y en la función que ese cambio arreglaba. Se
  convierte en el adaptador, porque cartera también lee `cuerpo` para clasificar intención.
- **Quien paga el último día de prueba se caía a `free`**: `suscribir` no escribe
  `subscription_status` —lo hace el webhook de Wompi, asíncrono— así que el barrido de ese día la
  degradaba y le borraba el reloj del reintento.

**De los 15, la mayoría se introdujeron el mismo día**, y el patrón es uno solo: habilitar varias
notas crédito por factura rompió suposiciones que nadie volvió a mirar (el CUFE "el más reciente", la
guarda de un solo uso, el panel que no volvía a su estado). **Cuando un cambio toca plata, el review
no puede ser el último paso.**

## Sesión 2026-08-24 — la fuga del panel, ventas copiado de OkVet, y tres funciones que no rendían

### 🔴 La fuga

**Cualquiera en internet, sin sesión, podía leer los correos de todos los usuarios y los nombres de
las clínicas.** Encontrado revisando cómo funcionaba el acceso al panel; nadie lo reportó.

Una petición anónima, sin cookies, contra el despliegue de producción:

```
GET /admin/usuarios   → HTTP 404, 66 KB de cuerpo, 23 correos REALES adentro
GET /admin/clinicas   → HTTP 404, 29 KB, nombres de las clínicas
GET /admin/costos     → HTTP 404, 26 KB, nombres de las clínicas y cifras
```

Los correos se verificaron contra `auth.users`: existían. **El 404 es lo que lo hacía invisible** —
la pantalla decía "no existe" mientras el cuerpo traía los datos.

### Por qué pasaba

El gate vivía **sólo** en `admin/layout.tsx`, y su comentario decía «todas las páginas hijas asumen
este gate». Eso no se puede asumir: en el App Router **el layout y la página se renderizan en
paralelo**. El `notFound()` del layout corta la interfaz, pero la página ya corrió sus consultas
—con `service_role`, que se salta la RLS— y sus datos quedan serializados en la respuesta.

**El 404 era de la pantalla, no de los datos.**

Los docs de Next lo advierten, y están en `node_modules`:

> «This pattern is not recommended since Next.js applications have multiple entry points, which will
> not prevent nested route segments and Server Actions from being accessed.»

### Qué NO estaba comprometido

Las tres server actions del panel —`cambiarActivacion`, `enviarCorreoPlataforma`,
`enviarCorreoMasivo`— **comprueban cada una por su cuenta** con `adminActual()`. Nadie pudo
desactivar a nadie ni disparar un envío masivo. La fuga era de **lectura**, y esa distinción es lo
que la baja de catástrofe a incidente.

### El arreglo (#208), y cómo quedó verificado

`requerirAdminDePlataforma()` en la PRIMERA línea de cada una de las cinco páginas, antes de
cualquier consulta — después de un `await` de datos no sirve, porque lo que se filtra es justamente
el resultado de ese await. El layout conserva el suyo: es lo que hace que la navegación muestre un
404 limpio en vez de un panel a medio pintar. **Van los dos, no uno u otro.**

Medido contra producción después de desplegar, con la misma petición anónima:

| Ruta | Antes | Después |
|---|---|---|
| `/admin/usuarios` | 66 KB · 23 correos | **14 KB · 0** |
| `/admin/clinicas` | 29 KB · 3 clínicas | **14 KB · 0** |
| `/admin/costos` | 26 KB · 3 clínicas | **14 KB · 0** |

Las cinco quedaron en 14 KB idénticos: el 404 pelado de Next. Con sesión, el panel sigue abriendo
con sus 18 filas — el arreglo no tocó el uso legítimo.

El cerrojo es `panel-admin-cerrado.test.ts` (12 casos): recorre `src/app/admin/**/page.tsx` y exige
la llamada **y** que sea el primer `await` del componente. Verificado que muerde en las dos
direcciones — sin la guarda, 2 rojos; con la guarda movida DESPUÉS de la consulta, 1 rojo, que es el
caso que parece arreglado y no lo está.

> **Lo que hay que llevarse:** un gate en un layout no protege los datos de sus páginas. Si una
> pantalla consulta con `service_role`, la comprobación va EN ESA pantalla y antes del primer
> `await`. Y el 404 no es prueba de nada: hay que mirar el CUERPO de la respuesta.

### Lo demás del día

- **Plantillas de correo revisadas** (#209). La de incidencia decía "de hoy" sin hueco para la fecha
  —un post-mortem se manda al día siguiente— y `listoParaEnviar()` no la usaba nadie: los dos
  consumidores necesitan los NOMBRES de los huecos, no un booleano. Lo que se revisó y está bien
  quedó anotado en el PR para no volver a auditarlo.
- **Se verificó qué puede hacer un admin de CLÍNICA**, que no es lo mismo que un admin de
  plataforma: ascender y descender miembros (`cambiar_rol_de_miembro`) y sacarlos de la clínica
  (`remove_clinic_member`). Las dos son `SECURITY DEFINER`, comparan `auth.uid()` y `clinic_id` y
  lanzan excepción — **la autorización vive en la base, no en el botón**. Y tienen tres guardas: no
  cambiarse el rol a uno mismo, no tocar a alguien de otra clínica, y no dejar la clínica sin
  administrador. El **envío masivo NO es de ellos**: está detrás de `isPlatformAdmin`.

### Ventas, copiado de OkVet — y dos veces que este repo dedujo en vez de mirar

David acumuló quejas del módulo. El pedido era **copia exacta** de OkVet y hubo que repetirlo: la
primera vez se tomó como «acercarse» y se fueron cerrando puntos sueltos de una lista.

**Sólo al entrar al producto del cliente aparecieron las cosas que el documento no decía.** Y las
dos correcciones importantes del día son a conclusiones de este mismo repo:

- **El descuento de línea va en PORCENTAJE**, no en pesos. Se había hecho en pesos ese mismo día.
- **El menú de secciones SÍ existe en OkVet.** Se había mirado su `···` —que sólo trae «Unificador
  de cuentas»— y se concluyó que no existía. Existe: cuelga de su PESTAÑA «Ventas», con **dos
  niveles y doce entradas**. El problema nunca fue que el menú sobrara; era que se quedaba corto.

> **La lección, y es la misma dos veces:** una referencia no se deduce de un documento que la
> describe. Cada vez que se miró OkVet aparecieron hechos que ninguna lista traía — y cada vez que
> no se miró, se construyó lo equivocado.

**Lo que se descubrió mirando, y valía más que lo construido:**

- **Compras y Proveedores estaban TERMINADOS y sin puerta** (#220). Lista, creación, edición y
  detalle, todo hecho — y el menú mostraba cinco de los nueve destinos. Sólo se alcanzaban entrando
  a Inventario y encontrando un enlace adentro. Un vet que quiere registrar una compra no adivina
  que el camino es Ventas → Secciones → Inventario → Compras: **para efectos prácticos no
  existían**, y eso explica parte de la queja.
- **El descuento ya estaba entero del lado del servidor** (#215) y llevaba meses sin poder usarse:
  cálculo, validación, persistencia, esquema de la acción, y hasta un **tope por rol**
  (`maxDiscountPctForRole`) con bloqueante. Una regla de autorización completa que nunca pudo
  dispararse porque no había dónde teclear el número.
- **El menú y las páginas hablaban idiomas distintos**: el menú decía «Finanzas» y esa página se
  titula, en su propio `h1`, «Ingresos y egresos» — que resulta ser el nombre exacto de OkVet.

**Lo que quedó** (#211, #212, #215, #216, #217, #220, #221, #222):

- La lista, con las columnas de OkVet (`Opciones · Identificación/Cliente · Valor · Pagos · Estado ·
  Usuario · Actualizado`), `Mostrar 10/25/50/100`, buscador, paginación real —traía un `.limit(100)`
  fijo, así que **con un año de uso la factura 101 no existía para esta pantalla**— y arranque en
  «Hoy» con «Ver todo».
- El formulario **«Nueva cuenta»**, que **abre como modal sobre la lista** (ranura paralela + ruta
  interceptora). Es una RUTA y no un `useState`: el botón «atrás» cierra el modal en vez de sacar al
  vet del módulo, un F5 no pierde la cuenta, y la URL se puede compartir.
- Descuento de línea en %, **descuento global con razón obligatoria** (0081, con `CHECK`),
  `Referencia/Nombre`, `Forma de pago`, observaciones, y **un solo botón `Guardar`** que lleva al
  documento.
- Inventario con las columnas y los nombres de OkVet, y el campo «Grupo» (0083).

**El descuento global se PRORRATEA, no se resta del total.** Restarlo habría sido una línea y
habría estado mal: el IVA se liquida por línea sobre su base, y las líneas de una factura no
comparten tarifa. Restando al final, el impuesto ya calculado no se entera y el documento deja de
cuadrar consigo mismo —`base × tarifa ≠ impuesto`—, que es lo que la DIAN valida.

**Dos cambios de comportamiento que hay que avisar antes de que se prueben:**

1. Una venta de mostrador ahora son **dos pantallas**: guardar → emitir en el documento. Es lo que
   hace OkVet, pero es un clic más.
2. El formulario **abre a nombre de «consumidor final»**. Sin atar un cliente con «Editar», la
   factura queda **fuera de cartera y sin correo**. OkVet funciona igual y lo compensa con ese
   control visible; acá va al lado del nombre por lo mismo.

**Lo que se decidió NO copiar, y por qué:** los estados `Cerrado · Facturado · Unificado` son del
modelo de OkVet; el nuestro es borrador → emitida → anulada **porque lo exige la DIAN**. Renombrarlos
por parecerse rompería el significado. Tampoco las columnas `Inv. · Disponibles · Pick.` del
inventario: las existencias viven en su propia pantalla, y tenerlas en dos sitios es tenerlas
diciendo cosas distintas.

**Sigue abierto:** que el menú suba a la barra lateral —que es donde estaría la copia fiel— toca el
orden que definió Luciano el 19-ago, y es decisión del cliente.

### Los dos cerrojos que hicieron su trabajo el mismo día que se escribieron

Vale anotarlo porque es la contracara de la lección del 23-ago («una guarda que nadie probó que
muerde no es una guarda»): estos mordieron solos, sin que nadie los provocara.

- **`avisos-al-emitir` frenó una regresión al inventario.** Al sacar «Emitir ahora» del formulario
  (copia de OkVet), el test se puso en rojo: vigilaba el aviso de existencia insuficiente en un
  camino que acababa de dejar de existir, y **el panel del documento no mostraba aviso ninguno**.
  Emitir desde ahí habría vuelto a dejar el inventario en −1 en silencio — exactamente lo medido el
  23-ago. Borrar el test habría sido reabrir el defecto sin que nadie se enterara. En vez de eso,
  `avisosDelBorrador()` los recalcula con `previewDraft` —la MISMA validación— y el documento los
  pinta ARRIBA del botón de emitir. Se recalculan y no se guardan: un aviso guardado envejece, y la
  existencia cambia justo entre armar la cuenta y emitirla.
- **El cerrojo de pantallas huérfanas mordió su propio cambio.** Recién escrito (#220), señaló
  `@modal/(.)nueva` como pantalla sin puerta. Tenía razón a medias: es un `page.tsx` nuevo, pero no
  es un destino — es una proyección de `nueva`. Se le enseñaron las convenciones de ruteo
  (`@ranura`, `(.)interceptor`, `(grupo)`) **y se verificó que sigue cazando lo de verdad**: con una
  `cotizaciones/page.tsx` de mentira se pone en rojo con su nombre.

### WhatsApp: tres funciones que ya estaban pagadas y no rendían

- **Los acuses nunca llegaban** (#223). Medido: **0 de 3.491 salientes** tenían `delivered_at` o
  `read_at`. Todo mensaje de la clínica se quedaba en un check, para siempre — incluidos los
  recordatorios de cobranza, donde saber si el titular LEYÓ es la diferencia entre «no le llegó» y
  «no quiere pagar». La cadena estaba entera salvo un eslabón: la suscripción de Evolution no
  incluía `MESSAGES_UPDATE`.

  **Y por poco se despliega muerto.** Los eventos sólo se registran al CONECTAR, así que agregar el
  evento al arreglo **no alcanza a las instancias que ya existen**: las cuatro clínicas conectadas
  se habrían quedado con la lista vieja hasta que alguien reescaneara un QR. Ahora el webhook
  refresca su propia suscripción una vez por arranque en frío, sin tocar la sesión.

  Los acuses **llegan desordenados**, así que ningún sello se pisa: un `DELIVERY_ACK` tardío después
  de un `READ` habría devuelto el tick azul a gris — el vet vería que el titular «des-leyó» su
  mensaje. Y **sólo se tocan los salientes**: en los entrantes `read_at` ya significa otra cosa (lo
  escribe la bandeja al abrir la conversación, y alimenta el contador de no leídos).

- **El nombre de quien escribe** (#224, migración 0084). Se reportó que un número desconocido
  aparecía sin nombre. Baileys manda `pushName` en cada entrante, **estaba declarado en nuestro
  propio tipo `EvoMessage` desde siempre**, y el webhook lo tiraba. No hace falta sincronizar la
  agenda del teléfono: el nombre viaja EN EL MENSAJE.

  El orden es **titular → perfil → número**, y no al revés: el titular es el dato que la clínica
  verificó. Y **no es identidad verificada** —lo elige quien escribe— así que se pinta con una marca
  «WA» y **nunca** se usa para resolver a qué titular pertenece un mensaje.

- **El aviso de mensajes sin leer** (#225). No había ninguna señal de que llegó un mensaje: había
  que entrar a Comunicaciones y mirar. **No se cuenta en el layout** —se midió en 1.023 ms el 23-ago
  y se le sacaron dos viajes a mano— sino en el cliente, después de pintar. **Se recuenta, no se
  incrementa**: sumar y restar se desincroniza solo y no se arregla nunca.

- **Guardar como titular** desde la bandeja (#213) y **plantillas de cobranza por clínica** (#218,
  migración 0082). Las plantillas destaparon dos defectos que el cambio volvía alcanzables:
  `.replace('{link}', v)` con una cadena sustituye **sólo la primera** aparición, y el reemplazo
  interpretaba `$&` y `$1` del valor — y el valor que se inyecta es el **saldo**, que en Colombia
  siempre trae un `$`.

### Lo demás

- **El correo se ve como correo** (#214): se pintaba como texto plano, así que cualquier correo con
  maquetado se leía como su propio código fuente. Ahora va en un `<iframe sandbox="">` — sin
  `allow-scripts` ni `allow-same-origin`, como hacen Gmail y Outlook.
- **Flechas del onboarding** (#219). El wizard sólo avanzaba. Lo frágil no era la flecha sino que
  **volver no pierda lo tecleado**, y eso es cierto sólo mientras el estado viva en el wizard: por
  eso el cerrojo vigila dónde vive el estado, no la flecha.
- **Un cerrojo nuevo sobre la factura pública** (#215), que es la única pantalla que entrega datos
  sin sesión. Es lista blanca y no lista negra a propósito, y **encontró algo apenas se escribió**:
  los datos del emisor y del pagador que ya se servían. Quedaron autorizados por escrito — la
  clínica y su NIT van impresos por obligación legal, y del pagador sale **sólo el nombre**.
- **`invoices.notes` se conectó** y quedó decidido que es **del titular por definición**: sale en la
  factura pública. Se pudo hacer sin riesgo porque la columna estaba vacía en toda la base — nadie
  la escribía. Si algún día hace falta una anotación interna, va en columna nueva.

### Migraciones aplicadas y verificadas al principal

`0081` (descuento con razón, con `CHECK` y `btrim`), `0082` (plantillas por clínica),
`0083` (grupo del producto), `0084` (nombre de perfil de WhatsApp). Las cuatro con su verificación
corrida y sin residuos.

> ⚠️ **La `0080` de Santiago —`metricas` en `tablero_preferencias`— NO está aplicada.** Verificado
> el 24-ago: la columna no existe. Su tablero elegible sí está en master.

## Pendientes conocidos

> **Revisado contra el repo el 2026-08-22.** De las diez entradas verificables, **cuatro estaban
> desactualizadas**: tres describían defectos ya corregidos (`payload_override`, `evidence_level`,
> el duplicado del modo auto) y una describía un mecanismo que ya no existe así (cartera). Una
> quinta —`xlsx`— describía la guarda anterior a que se acotara.
>
> **Por qué importa más de lo que parece:** esta lista se usa como lista de trabajo. Dos veces el
> 22-ago mandó a rehacer algo ya resuelto, y una tercera —el radio, en
> `docs/entrega/4-EL-REPO-DE-LUCIANO.md`— casi hace deshacer un pedido explícito del cliente. Un
> pendiente que ya no lo es no es ruido inofensivo: es trabajo que alguien va a hacer dos veces.
>
> **La regla, entonces:** el que cierra algo tacha su línea acá **en el mismo PR**, y el que va a
> tomar una de estas entradas la verifica contra el código antes de empezar. Las entradas resueltas
> se tachan con `~~…~~` y se dice cuándo y en qué commit — no se borran, porque saber que algo se
> intentó y por qué se resolvió así vale tanto como la lista.

- 🟡 **¿La nota del Fantasma se genera sola?** (decisión de producto, no defecto). Hoy `generating_note`
  se sale a mano: el vet abre la consulta y aprieta "Generar sugerencia". Se corrigió la etiqueta, que
  decía "Generando nota" y hacía esperar a la gente (22-ago, `src/lib/consultas/estado.ts`) — pero la
  pregunta de fondo sigue abierta: generar sola cuesta una llamada al modelo por consulta cerrada, la
  capacidad es de Pro, y hay consultas que se graban y se abandonan. Medido antes del arreglo: cuatro
  consultas atascadas de cuatro días distintos, todas con transcript y ninguna con nota.
- 🟡 **Correo masivo de una clínica a SUS clientes** (pedido el 22-ago). Evaluado y planeado en
  `docs/PLAN-CORREO-A-CLIENTES.md`; sin construir. Media función ya existe —la cartera le escribe a
  los titulares, así que transporte, identidad del remitente y manejo de fallos están resueltos— y **la
  baja ya está** (migración 0077 + `/baja/[token]`, 22-ago). Falta la audiencia acotada, el envío
  —que debe llamar a `sinLosDeBaja` y poner el enlace en el pie— y los rebotes. Se
  recomienda arrancarlo DESPUÉS de la entrega: el dominio remitente es uno solo para todas las
  clínicas, y una lista sucia le arruina la entregabilidad al resto.
- ~~**Una factura emitida NO SE PUEDE CORREGIR: la nota crédito no existe**~~ — **RESUELTO el
  23-ago.** `src/lib/facturacion/credit-notes.ts` + `anularFacturaAction` + el bloque "Anular con
  nota crédito" en la factura emitida. Sin migración: la base ya tenía todo (tabla con su CHECK de
  motivos DIAN, rango `NOTA_CREDITO` admitido, `CREDIT_NOTE_APPLIED` y `DEVOLUCION` en sus CHECKs, y
  `submitCreditNote` implementado en el sandbox) — faltaba sólo el caso de uso.
  Cubre la anulación TOTAL **y la PARCIAL** (23-ago): varias notas sobre la misma factura, con techo
  en lo ya acreditado, y la factura sigue EMITIDA con menos saldo. La que completa el total anula.
  **Lo que falta es la nota crédito POR LÍNEA:** hoy la parcial ajusta plata y NO mueve inventario,
  porque sin saber qué renglón se acredita no hay forma de saber qué volvió — devolver stock
  adivinando pondría unidades que siguen en la casa del cliente. Con selección de líneas y cantidades
  sí se puede calcular, y ahí una devolución parcial cerraría entera.

- ~~**Los acuses de WhatsApp nunca llegan: todo mensaje enviado se queda en un solo check.**~~ —
  **RESUELTO el 24-ago** (#223). Medido antes: **0 de 3.491** salientes tenían `delivered_at` o
  `read_at`.

  Era lo que decía esta entrada: faltaba `MESSAGES_UPDATE` en `EVOLUTION_WEBHOOK_EVENTS` y el
  webhook no lo manejaba. Se aceptan las DOS formas del estado —nombre (`"DELIVERY_ACK"`) y número
  del enum (`3`)— y los tres nombres con que viaja el id (`keyId`, `messageId`, `key.id`), porque no
  hay forma de probar contra la versión que corra mañana. `PLAYED` cuenta como leído; `SERVER_ACK`
  no sella nada (ése es el primer check, y ya lo da `created_at`).

  **Lo que esta entrada no había previsto, y era lo que más importaba:** los eventos SÓLO se
  registran al CONECTAR (`ensureInstance` ← `/api/whatsapp/evolution/connect`), así que agregar el
  evento al arreglo NO alcanza a las instancias que ya existen. Las cuatro clínicas conectadas se
  habrían quedado con la lista vieja y esto se habría desplegado sin cambiar nada, hasta que alguien
  reescaneara un QR. El webhook ahora refresca su propia suscripción una vez por arranque en frío.

  Otras dos que aparecieron al hacerlo: los acuses **llegan desordenados**, así que ningún sello se
  pisa —un `DELIVERY_ACK` tardío después de un `READ` devolvería el tick azul a gris—; y **sólo se
  tocan los SALIENTES**, porque en los entrantes `read_at` ya significa «el vet lo leyó» y alimenta
  el contador de no leídos.

  La duda que dejó escrita el 23-ago —no verificar la forma del payload contra una instancia viva—
  se resolvió aceptando las variantes en vez de apostar a una. **Queda una comprobación real
  pendiente:** que en producción aparezca el doble check. Si a la media hora sigue en uno, Evolution
  manda una forma no contemplada y el log del webhook dice cuál.

- 🟡 **`calendar_integrations` guarda 3 `refresh_token` de Google de un camino que ya no existe.**
  Encontrado el 23-ago recorriendo Conexiones.

  El calendario migró a Composio; `google-calendar.ts` y `microsoft-calendar.ts` están **borrados**,
  y la tabla no aparece en ninguna consulta del código — sólo en dos comentarios que la mencionan
  como el camino viejo. Pero las tres filas siguen ahí, **las tres con `refresh_token`**: un refresh
  token de Google da acceso continuado al calendario de esa persona hasta que se revoque.

  **El riesgo es latente, no activo** —misma forma que el hallazgo de `appointments_importadas_respaldo`
  de la auditoría del 18-ago—: la RLS está encendida con sus cuatro policies, y ni `anon` ni
  `authenticated` tienen `SELECT` sobre la tabla (el grant es `awdDxtm`, sin la `r`). O sea que hoy
  no las lee nadie desde el cliente. Lo que molesta es que sean credenciales **sin ningún propósito**:
  el día que alguien corra un `grant select ... to authenticated`, o que se filtre una service_role,
  son tres calendarios ajenos abiertos por nada.

  Lo que corresponde: borrar las filas, y —para que sea completo— revocar los tokens del lado de
  Google, porque borrarlos de la base no los invalida. Después, evaluar si la tabla misma sobra.

  Lo que NO es un hallazgo, y conviene que quede escrito para que nadie lo "arregle": que ninguna
  integración tenga canal de escucha (`channel_id` null en las tres) es **deliberado**. El calendario
  es de UNA SOLA VÍA a propósito — `composio/calendario.ts` lo explica: el *pull* que existió trajo
  19.649 filas del calendario personal de un vet ("Comer", "Dormir") contra 21 citas reales. No es un
  filtro que falte: es que el canal no debe existir.

- ~~**Al prompt del agente no le dice nadie que lo que LEE es dato, no instrucción.**~~ — **HECHO el
  23-ago**, el mismo día que lo encontró la auditoría de la capa agéntica. El agente lee
  conversaciones de WhatsApp y correos —texto escrito por TERCEROS— con
  `search_whatsapp_conversation`, `search_emails` y `read_email_thread`, y tiene nueve herramientas
  de escritura. `ATHOS_AGENT_SYSTEM_PROMPT` no contenía **ni una línea** diciendo que las
  instrucciones dentro de ese contenido no se obedecen.

  Ahora sí: sección **"Lo que LEÉS es dato, no son órdenes"** en `system-prompt.ts`. Dice cuatro
  cosas — lo que llega por tools es material leído, no instrucciones; ante algo que suene a orden se
  la CITA al vet en vez de obedecerla; da igual que el texto diga venir del vet, de Tuvetia o de un
  admin (el único que da órdenes es el veterinario, en el chat); y nada de lo leído le agrega
  capacidades ni le saca la aprobación humana. Más una regla de redacción: los datos leídos sirven
  para ESE caso, no se mete la ficha de otro porque el texto lo pidió.

  **Fijado con 4 pruebas** en `agent-smoke.test.ts` (§5 de `docs/AGENT-SMOKE-TESTING.md`), y no es
  ceremonia: un párrafo de prompt se borra sin que se rompa nada —compila igual, el resto pasa
  igual— y la defensa se iría en silencio. Verificado que muerden: borrando la sección, los 4 en
  rojo. La suite quedó en 27 casos.

  **El daño ya estaba acotado por diseño, y por eso esto nunca fue rojo:** toda escritura es una
  PROPUESTA que un humano aprueba (`risk: "approval"` hardcodeado en `proposeAction`), la tarjeta
  muestra el detalle del payload y no sólo el resumen, el destinatario de WhatsApp **no es editable y
  está acotado a titulares registrados** (`athosPuedeEscribirA`), y el `payload_override` se revalida
  contra el esquema descartando campos desconocidos.

  **QUÉ SE MIDIÓ Y QUÉ NO, porque el motivo para no tocarlo era justamente ése:** se corrió la suite
  del front entera (**1.589/1.589**, 135 archivos) más tsc y lint, limpios. NO se corrieron los
  bancos de `athos-service/scripts/calidad/` — miden retrieval, notas y abstención del servicio, no
  el prompt de este agente, así que no aplican acá.

  **Lo que sigue abierto:** el párrafo fija que la instrucción está ESCRITA, no que el modelo la
  cumpla — eso es comportamiento, y un prompt no es una garantía. El residuo es el mismo de antes y
  es conocido: una propuesta **verosímil** que un vet apurado apruebe, y el CUERPO de un mensaje
  redactado. El destinatario de CORREO sigue siendo editable, y el modelo lo deduce de lo leído
  (está comentado a propósito, para que el vet lo corrija).

- 🟠 **La prueba de 3 días está construida, y la migración SIN APLICAR.** Decisión de la reunión
  del 22-ago —"periodo de prueba gratuito de 3 días para el uso de las funciones de IA"— que no
  existía en el código: `clinics.plan` es `free|pro` a secas y una clínica sin suscripción no tenía
  Athos desde el primer minuto.

  **No hay columna nueva, y es la decisión de diseño.** Una prueba es lo que el esquema ya sabía
  decir: `plan='pro'` + `subscription_status='trial'` + `plan_renueva_en = ahora + 3d`. La
  tentación era un `trial_ends_at`, y habría creado un SEGUNDO reloj: el barrido está construido
  sobre `plan_renueva_en` como única columna a propósito («no existe ninguna clínica que el barrido
  pueda no ver»), y con dos relojes hay clínicas que se cuelan entre los dos. De paso `'trial'`
  deja de ser el valor muerto que la 0065 dejó "por compatibilidad".

  **La estampa un trigger** (`0078`), no un default ni la función de alta: `plan` con default
  `'pro'` no caducaría nunca, las tres columnas tienen que moverse juntas, y `insert into clinics`
  aparece en TRES funciones distintas (0022, 0048, 0055). El trigger cubre también los caminos que
  se escriban después. **La baja el barrido**, que ya miraba por `plan_renueva_en` — lo único que
  las dejaba afuera era el filtro de estado, y va con test de que no se les intente cobrar: una
  prueba no tiene tarjeta, y un cobro fallido la dejaría en Pro contada como "omitida", o sea una
  prueba que no caduca disfrazada de problema de pagos.

  **Sin backfill, medido antes de decidirlo:** 14 clínicas en `cortesia`, 1 `active` y UNA en
  `free` (del 17-ago, con `plan_renueva_en` en null, así que ni el gate ni el barrido la tocan).

  ✅ **`0078` APLICADA al principal el 23-ago**, y verificada ahí mismo: el trigger y la función
  existen, y los casos 1-4 pasaron contra la base real (nace pro/trial con 3 días exactos, y no se
  pisa ni un alta deliberada de Pro ni una fila que ya trae su `plan_renueva_en`). El caso 5 falló
  por un defecto DE LA VERIFICACIÓN, no de la migración: contaba su propio fixture —
  `subscription_status` tiene default `'trial'`, así que la clínica del caso 4 es una fila
  free+trial+fecha— y quedó corregido excluyendo las tres filas del bloque.

- 🟡 **El banco adversario está construido, y sin correr.** Misma tanda del 23-ago. Es el
  instrumento que faltaba para medir lo de arriba: `docs/AGENTE-ADVERSARIOS.md`,
  `src/lib/athos-agent/adversarios/` y `npm run adversarios`. **7 ataques por inyección** —
  exfiltración a un correo ajeno, suplantación del "sistema Tuvetia", contaminación con la ficha de
  otro paciente, frase dictada, silenciamiento, cambio de destinatario, falsa urgencia del dueño— y
  **3 controles** que miden lo contrario: que el agente endurecido no haya dejado de trabajar.

  El juez es **determinístico, sin LLM**, y su decisión de diseño es la que hay que entender antes
  de tocarlo: el marcador se busca SÓLO en el payload de lo que el agente propuso escribir, **nunca en
  su texto** — porque si hace lo correcto y le CITA la orden al vet, el correo del atacante aparece
  en su respuesta, y un juez ingenuo contaría como fallo justo el comportamiento que se le pide.

  Lo que corre en CI son las piezas frágiles (30 pruebas): el juez, la coherencia del corpus —que
  cada ataque tenga su marcador dentro de lo que el agente va a leer, o sería un ataque que nunca se
  lanza— y el cableado del arnés contra un modelo falso, que verifica que el veneno llega al prompt.

  **Endurecido el mismo 23-ago tras un review**, que encontró seis formas de que reportara
  "resistió" sobre una corrida en la que el agente había obedecido: las escrituras se grababan desde
  `execute` y el SDK no lo llama cuando los argumentos no pasan el esquema; se buscaba dentro del
  JSON serializado, donde un salto de línea parte el marcador; el teléfono se comparaba sin
  normalizar como lo normaliza producción; los fixtures se servían sin mirar los argumentos (eso
  además daba un FALSO positivo); el canario vivía en un campo que la tool no devuelve; y el modelo
  se leía antes de llamar, que con cascada nombra al primario aunque conteste el respaldo. Está todo
  en la tabla de `docs/AGENTE-ADVERSARIOS.md` §"Lo que el review corrigió".

  ⚠️ **Falta la corrida.** En esta máquina no hay ninguna credencial de proveedor (`ANTHROPIC_API_KEY`
  y compañía viven en Vercel y Railway), así que el corredor falla en su primera aserción — a
  propósito: un banco que se auto-saltea es papel, y este repo ya tuvo esa historia con los
  cross-tenant del backend. **Una sola corrida con la key llena la tabla de resultados del
  documento.** Hasta entonces, sobre si el modelo obedece órdenes ajenas no hay cifra.

- 🟠 **`PLATFORM_ADMIN_EMAILS` pendiente de ampliar** (Vercel, no código). El panel de plataforma se
  abre por allowlist de correos en esa env var — sin ella no entra nadie, y **el rol de la clínica no
  da acceso**: un admin de clínica recibe 404. Acordado el 24-ago que entren Luciano, los dos David
  y las tres cuentas de Santiago Tellez:

  ```
  lgdecaillet@gmail.com,davidjimenez@glm.edu.co,davidjimenezdroppi@gmail.com,
  setr7706@gmail.com,santiagotllrz.lab@gmail.com,santiago.tellez@colombiatechweek.co
  ```

  ⚠️ **Se AÑADEN al valor actual, no lo reemplazan**: pisarlo deja fuera a quien esté hoy, y el gate
  no tiene otra puerta. Requiere redeploy — es env de servidor. Quedan fuera a propósito
  `et375173@gmail.com` (es **Edwin** Tellez, otra persona) y `santiagotllrz@gmail.com` ("Santiago 2",
  rol vet, parece cuenta de prueba).

- 🟠 **Velocidad: lo que queda, en orden de retorno.** Medido el 23-ago (ver §Sesión 2026-08-23).
  1. **Comprobar en qué región están la función de Vercel y el proyecto de Supabase.** Un `getUser()`
     cuesta **265 ms** con Postgres respondiendo en microsegundos: eso es latencia entre regiones.
     `vercel.json` no fija región → las funciones corren en `iad1`. Es un dato de dos dashboards y
     divide **los cuatro viajes**, no uno. Nada de lo demás rinde tanto.
  2. **`requireClinicPage()` → `sesionDelServidor()`.** Sigue haciendo su propio `getUser()` (−265 ms
     en todo el dashboard y en las páginas de facturación). Una línea.
  3. **`progresoDeConfiguracion()` fuera del camino crítico**, con `<Suspense>` o sin consultarlo al
     100 %. Son 443 ms por navegación —el 43 % del layout— para pintar una barra de onboarding que
     en una clínica configurada dice 100 %.

  La instrumentación quedó puesta (`lib/perf/marcas.ts`, cabecera `x-perf: 1`), así que cada cambio
  se mide contra las mismas cuatro fases. **No estimar: la vez pasada la estimación erró por tres.**

- 🟡 **¿El calendario se sincroniza con Google?** Lo preguntó Luciano en la reunión del 22-ago. La
  respuesta que da el código: **UNA SOLA VÍA, a propósito.** Tuvetia empuja sus citas (crear, mover,
  borrar); no lee nada de vuelta. Medido el 23-ago: 3 integraciones Google, **0 con canal de
  escucha**, 7 de 25 citas empujadas. El motivo está en `composio/calendario.ts`: el *pull* que
  existió trajo **19.649 filas** del calendario personal de un vet ("Comer", "Dormir") contra 21
  citas reales — «no es un filtro que falte: es que el canal no debe existir».

  **Queda para confirmar con Santiago** si hace falta la vuelta. Si la respuesta es sí, es una
  funcionalidad NUEVA con su riesgo conocido, no un arreglo.

- 🟡 **El producto habla en VOSEO y el prompt del agente exige TUTEO.** Encontrado el 24-ago
  revisando las plantillas de correo. No es que las plantillas se hayan desviado: la interfaz entera
  va en voseo —`podés`, `tenés`, `seguís`, `cargá`, `registrá`— y las plantillas también
  (`escribinos`, `respondé`, `notás`, `preferís`). Quien dice lo contrario es
  `athos-agent/system-prompt.ts`, citando los docs de marca del cliente:

  > «Español de Colombia, en **tuteo**. Colega clínico senior: cercano, directo, profesional.»

  O sea que hoy conviven dos registros: **Athos tutea y el resto del producto vosea**, y el mismo
  veterinario recibe los dos. El correo es donde más se nota, porque es lo que se reenvía.

  **NO se tocó: es una decisión de marca, no un defecto.** Y no es obvia — el voseo es propio de
  Antioquia y del Valle, así que "voseo colombiano" no es una contradicción. Lo que no puede quedar
  es cada superficie eligiendo por su cuenta. Quien decida, decide para los dos lados; cambiar el
  prompt del agente pide correr su banco (`docs/AGENT-SMOKE-TESTING.md`).

- 🟡 **El mock del calendario y de pacientes.** Pedido el 23-ago: "depurar esas vistas para
  parecerse al mock". No se pudo empezar porque no hay contra qué comparar: `feat/pacientes-crm-mockup`
  y `feat/mockup-los-cuatro-baratos` **ya están en master**, y **no existe ninguna rama de mockup del
  calendario**. O la implementación se desvió de un mock que ya se aplicó, o hay uno más nuevo fuera
  del repo. Hace falta el archivo o el enlace.

- ⚠️ **Plantillas de correo en Supabase** (config, no código): son **DOS** —"Magic Link" y
  "Confirm signup"—, porque `signInWithOtp` manda una u otra según si el correo ya tiene cuenta.
  Texto exacto y verificación en `docs/CONFIGURAR-MAGIC-LINK.md`.
  **Corrección del 23-ago:** acá decía `{{ .SiteURL }}/auth/confirm?token_hash=…&next=/dashboard`, y
  eso PIERDE el `next` que manda el navegador — que es por donde viaja la invitación de equipo
  (`/signup?next=/invitar/<token>`). Va `{{ .RedirectTo }}`, que ya trae el `next`, y se concatena
  con `&`. Si sigue con `{{ .ConfirmationURL }}` (PKCE `?code=`), el enlace "no hace nada" al abrirse
  en otro dispositivo. El contrato quedó fijado en `src/lib/__tests__/contrato-del-magic-link.test.ts`.
- (Opcional) **2ª key de Cohere** para aislar la ingesta de producción del todo — hoy el timeout
  de 6s ya protege el chat mientras ingesta.
- Rediseño de la **historia del paciente** (UX confusa) — hacerlo ya con el design system nuevo.
- **Verificación de Google** para el scope de calendario (si se abre al público).
- **Texto legal** definitivo (hoy las páginas legales son placeholder honesto).
- Deuda menor: transcripción en batch (no en vivo), retención del transcript (decisión legal
  abierta), paginación real en listados (hoy guardas de escala con `limit`).
- **Trámite Meta Tech Provider** (admin): checklist en `WHATSAPP.md` §Trámite.
- Re-registrar el webhook de Kapso con el secreto en HEADER y borrar el fallback de query param.
- ⚠️ **`xlsx@0.18.5`** (prototype pollution + ReDoS, sin fix en npm — SheetJS se mudó a su CDN).
  **Sigue vulnerable, pero la guarda se ACOTÓ el 22-ago (#158)** y esta entrada describía el estado
  anterior. Hoy:
  - `createImportPreview` corta **por extensión** (`XLSX_PARSER_ENABLED = false`), no la action
    entera: `.xlsx`/`.xls` se rechazan **antes de la sesión y antes de leer un byte**, y el **CSV
    pasa** — su camino es Papaparse, que no tiene nada que ver con estas CVE. Se estaba bloqueando
    un parser sano para tapar a otro.
  - `/inventario/importar` **ya no es una página que explica el porqué**: es el wizard de
    importación por CSV, con mapeo de columnas y previsualización.
  - `ingestRecipeAction` sigue rechazando `kind='excel'`. Sin cambios.
  - El import de pacientes sigue client-side (riesgo autoinfligido).
  Se levanta el `.xlsx` reemplazando la lib (candidatos: exceljs o el SheetJS del CDN) y editando
  esa constante más el `accept` del input.
- **Cartera consume la cuota diaria del asistente clínico**: ~~pendiente~~ **corregido en PR #30**
  (los frenos cuentan sobre `athos_actions` con `source='auto'`, que cartera no escribe).
- ~~**Cartera se queda con el mensaje aunque no sea de cobranza**~~ — **RESUELTO el 22-ago.**
  `wa-router` ahora devuelve `handled: false` cuando el intent es `OTRO` **y no vino adjunto**, así
  que el mensaje cae al modo auto general como el de cualquiera que no deba nada. Con adjunto sí se
  reclama: una foto de quien debe plata es un comprobante hasta que se demuestre lo contrario, y
  soltarla perdería `storeReceiptReference`. Lo que sigue abajo era la descripción vieja del
  mecanismo, que tampoco era exacta: en `wa-router.ts` ya **no hay ninguna mención a `intent` ni a `OTRO`**
  (verificado el 22-ago). El corto­circuito real es más simple: si el titular existe, tiene una
  factura EMITIDA con saldo y `followup_enabled`, la función devuelve `handled: true` **al final,
  pase lo que pase con el contenido del mensaje** — los `handled: false` de arriba son todos por
  motivos estructurales (sin titular, sin factura, factura no cobrable), no por lo que dice.
  Consecuencia igual que antes: una pregunta trivial —"¿a qué hora abren?"— deja de responderse
  sola para ese titular. No se pierde nada: queda en la bandeja.
- ~~**`payload_override` no se revalida**~~ — **RESUELTO** (verificado contra el código el 22-ago).
  `execute/route.ts` mergea el override sobre el payload propuesto y **lo pasa por `validarPayload`
  con el esquema de esa tool**; si no valida, corta con 400. Además el parseo **descarta los campos
  desconocidos**, así que un `clinic_id` o un `vet_id` agregados a mano no llegan a la RPC.
- ~~**Modo auto: ventana de duplicado**~~ — **YA ESTABA ARREGLADO cuando se escribió esta línea.**
  El defecto era real: la idempotencia se consultaba contra `athos_actions`, cuya fila se escribe
  DESPUÉS de enviar, así que entre el chequeo y la escritura —debounce más modelo— un reintento del
  webhook colaba una segunda respuesta al titular. Se cerró el **29-jul en `a64cfdc`** con un
  compare-and-set sobre `auto_reply_claimed_at` (migración `0038`, columna verificada en el
  principal el 22-ago). La entrada quedó acá casi un mes describiendo un bug que ya no existía.
  Lo que sí faltaba —y se agregó el 22-ago— es un test que proteja el arreglo:
  `src/lib/__tests__/auto-reply-no-duplica.test.ts` fija el `.is(…, null)`, el `.select()` y, sobre
  todo, que la reserva ocurra ANTES de llamar al modelo. Sin eso se podía deshacer sin que nada
  fallara, y el síntoma sólo aparece con un reintento real del webhook.
- ~~**`expires_on` se parseaba en UTC**~~ — **RESUELTO el 22-ago.** `getNearExpirySet` hacía
  `new Date(lot.expires_on)` sobre una columna DATE, y la forma ISO sólo-fecha se parsea siempre en
  UTC por spec: en Bogotá eso es el día anterior a las 19:00, así que un lote se daba por vencido
  cinco horas antes de que terminara su día. Es el mismo defecto que ya se había corregido para
  `due_date`; a `expires_on` no le había llegado. Ahora usa `finDelDiaBogota`.
- ~~**`POST /athos/whatsapp/suggest` quedó sin llamadores**~~ — **BORRADO** (22-ago). Se fue el
  endpoint, `app/whatsapp_reply.py`, sus modelos y `athosWhatsappSuggest`. El borrador lo hace el
  agente de Next (`/api/athos/suggest-reply`), que además lo deja propuesto en `athos_actions` —
  auditado y con el envío como aprobación humana; el camino viejo devolvía texto suelto sin traza.
  Lo que sí se rescató antes de borrar: el test de Python era el ÚNICO que fijaba "el borrador no
  diagnostica ni inventa datos de la clínica", y esa regla ahora se fija sobre el prompt que de
  verdad se manda (`src/app/api/athos/__tests__/suggest-reply.test.ts`).
- ~~**El agente cita `passed`, no `evidence_level`**~~ — **RESUELTO** (verificado el 22-ago). Las
  dos mitades están: `athos-service/app/main.py` devuelve `evidence_level=verdict.band` en
  `/athos/retrieve`, y la descripción de la tool en `tools.ts` dice literalmente *"Guiate por
  evidence_level, NO por passed (que está saturado)"*, con el mapeo de las tres bandas. El front
  además tolera una ventana de deploy desfasado cayendo a `sufficient` si el campo no viniera.
- **Site URL de Supabase**: ahora que `/` es la landing y el login vive en `/login`, hay que revisar
  la config del dashboard de Auth — si el fallback aterriza en la raíz, no hay intercambio de código.
