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
que ellas y **fallaba en cualquier entorno nuevo**. La próxima migración arranca en `0037`.

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
  Cubre la anulación TOTAL. La nota crédito **parcial** —corregir un importe sin anular— sigue sin
  construirse y es lo que queda de esta funcionalidad.

- 🟡 **Los acuses de WhatsApp nunca llegan: todo mensaje enviado se queda en un solo check.**
  Encontrado el 23-ago recorriendo Comunicaciones. Medido: **0 de 3.491** salientes tienen
  `delivered_at` o `read_at` — incluidos los 13 que mandó Tuvetia, no sólo los del espejo del
  teléfono del vet.

  La cadena está casi entera y le falta un eslabón: la bandeja LEE los dos campos y pinta el tick
  correspondiente (`inbox.tsx:561-569`), el webhook de **Meta** los ESCRIBE (`whatsapp/webhook`,
  rama `value.statuses`)… pero producción corre **Evolution**, y ahí
  `EVOLUTION_WEBHOOK_EVENTS = ["MESSAGES_UPSERT", "CONNECTION_UPDATE"]` — sin `MESSAGES_UPDATE`, que
  es por donde Evolution manda los acuses. El webhook de Evolution tampoco lo manejaría: sólo tiene
  esos dos `if`.

  **Lo cosmético:** en el lenguaje de WhatsApp un solo check es "enviado, sin acuse", así que no
  miente — pero tampoco avanza nunca.
  **Lo que sí importa:** un envío que Evolution ACEPTA y después no entrega (número inexistente,
  bloqueado) llega por ese mismo evento. Hoy es invisible. Los fallos SINCRÓNICOS sí se ven —
  `whatsapp/send` los clasifica y se los devuelve al vet.

  El arreglo son dos mitades: sumar `MESSAGES_UPDATE` a la suscripción y manejar el evento mapeando
  el ACK de Evolution (`SERVER_ACK` / `DELIVERY_ACK` / `READ` / `ERROR`) a los campos que la bandeja
  ya lee. NO se hizo el 23-ago a propósito: la forma exacta del payload de Evolution no se pudo
  verificar contra una instancia viva, y escribir un handler adivinando la forma horas antes de una
  entrega es la clase de cosa que parece hecha y no lo está. Si no calza, no rompe nada (actualiza
  por `wa_message_id`, así que no encuentra fila y no hace nada) — pero tampoco sirve, y quedaría
  dando la impresión contraria.

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
