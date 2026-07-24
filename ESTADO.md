# Estado del proyecto — Handoff (2026-07-24)

Doc vivo para que cualquier dev que abra el repo esté al día. Front (Next.js, raíz) + backend Athos
(`athos-service/`, FastAPI). DB: Supabase (proyecto principal `auxlnexhkmtoedrzfsnz`). Deploy: front en
Vercel, backend en Railway (auto-deploy en cada push a `master`).

> **Reglas del repo:** leé `AGENTS.md` / `CLAUDE.md` (raíz) y `athos-service/CLAUDE.md`. Docs de apoyo:
> `DATABASE.md`, `CALENDARIO.md`, `athos-service/DEPLOY.md`.

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
`0017 onboarding_setup`.
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

## Ownership / no tocar
- **Comunicaciones / WhatsApp**: la **base multi-tenant vía Kapso ya está construida** (conexión por
  QR en Configuración, webhook, tablas — ver **`WHATSAPP.md`**, migración `0015`). La **bandeja/inbox**
  (`/dashboard/comunicaciones`, hoy `#` en el sidebar) **es del otro dev** — blueprint en `WHATSAPP.md`.
  Config externa: `KAPSO_API_KEY` + `KAPSO_WEBHOOK_SECRET` en Vercel + webhook registrado en Kapso.
- Todo lo de **Athos** (copiloto, corpus, citas, y sus piezas de front) → equipo Plogy (ver
  `athos-service/docs/ATHOS_CONTEXTO_EQUIPO.md`).

## Onboarding de vets nuevos (2026-07-24)
- **Wizard `/bienvenida`** (primer login del creador de clínica; flag `profiles.setup_completed_at`,
  migración `0017` con backfill): bienvenida → clínica/perfil → primer paciente → **datos de ejemplo**
  ("Luna (ejemplo)" con transcript + nota draft, borrable) → invitar equipo. Todo saltable.
- **Checklist "Primeros pasos"** en el dashboard (checks con datos reales; auto-oculta al completar).
- Los **invitados NO ven el wizard** (`accept_invitation` marca el setup). El tour driver.js convive.

## Pendientes conocidos
- Rediseño de la **historia del paciente** (UX confusa).
- **Verificación de Google** para el scope de calendario (si se abre al público).
- **Texto legal** definitivo (hoy las páginas legales son placeholder honesto).
- Deuda menor: transcripción en batch (no en vivo), retención del transcript (decisión legal abierta).
