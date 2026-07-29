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
- `CRON_SECRET` — protege el cron de purga de audio (`/api/cron/purge-audio`, diario vía `vercel.json`).

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
> **Facturación y cartera** se portaron en la misma tanda pero van en un PR aparte (el motor, sin
> UI): migraciones `0033`–`0036`. Este doc se completa cuando ese PR entre.

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

## Pendientes conocidos
- ⚠️ **Template de email "Magic Link" en Supabase** (config, no código): debe emitir
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard`. Si sigue
  con `{{ .ConfirmationURL }}` (PKCE `?code=`), el magic link puede "no hacer nada" al abrirse en
  otro dispositivo. Verificar en Auth → Email Templates (coordinar con Santiago).
- (Opcional) **2ª key de Cohere** para aislar la ingesta de producción del todo — hoy el timeout
  de 6s ya protege el chat mientras ingesta.
- Rediseño de la **historia del paciente** (UX confusa) — hacerlo ya con el design system nuevo.
- **Verificación de Google** para el scope de calendario (si se abre al público).
- **Texto legal** definitivo (hoy las páginas legales son placeholder honesto).
- Deuda menor: transcripción en batch (no en vivo), retención del transcript (decisión legal
  abierta), paginación real en listados (hoy guardas de escala con `limit`).
- **Trámite Meta Tech Provider** (admin): checklist en `WHATSAPP.md` §Trámite.
- Re-registrar el webhook de Kapso con el secreto en HEADER y borrar el fallback de query param.
- **`xlsx@0.18.5`** tiene prototype pollution + ReDoS y *no hay fix en npm* (SheetJS se mudó a su
  propio CDN). Hoy solo corre client-side en el import de pacientes, o sea que cada quien parsea su
  propio archivo. Se vuelve serio con facturación, que lo usa **server-side**.
- **Doble ejecución de acciones de Athos**: el chequeo de `status='proposed'` y el UPDATE que la marca
  ejecutada no son atómicos. Dos clics en "Aprobar" ejecutan dos veces. Falta compare-and-set.
- **`CRON_SECRET`**: si la env no está definida, `/api/cron/purge-audio` queda público (`if (secret &&
  ...)`). Debería devolver 503 como hace el webhook de WhatsApp.
- **Site URL de Supabase**: ahora que `/` es la landing y el login vive en `/login`, hay que revisar
  la config del dashboard de Auth — si el fallback aterriza en la raíz, no hay intercambio de código.
