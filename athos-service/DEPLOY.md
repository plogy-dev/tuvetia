# Deploy de Athos — Railway (backend) + Vercel (front)

> Objetivo: que el equipo use Athos + Modo Fantasma **sin depender de la máquina de nadie**, y
> dejarlo **hands-off** (cada `git push` redespliega solo). Arquitectura elegida: **front en
> Vercel + backend en Railway**, con **todo predispuesto** para mover el backend a Vercel cuando
> se pague el plan (ver §5). El interruptor entre backend Railway↔Vercel es **una sola variable**
> del front: `NEXT_PUBLIC_ATHOS_URL`.

```
Tester ──▶ Front (Vercel, repo raíz)  ──HTTP/SSE──▶  Athos (Railway, raíz = athos-service/)
                    │                                        │
                    └── login Supabase (principal, ES256) ───┴──▶ Supabase: paciente=principal · corpus=dev
```

---

## 1) Backend en Railway  (lo hace: tú/el equipo — Railway no lo puedo tocar yo)
1. **New Project → Deploy from GitHub repo** → `plogy-dev/tuvetia`.
2. En el servicio → **Settings → Root Directory** = `athos-service`  ← clave (monorepo).
3. Build/Start ya vienen del repo: `railway.json` + `Procfile` + `requirements.txt` (bundle liviano, sin `llama-index`). Healthcheck en `/health`.
4. **Variables** (Settings → Variables). Copia los valores de tu `.env` local **YA ROTADOS** (ver §4). Nombres:
   - `DATABASE_URL`  → principal (paciente + trazas)
   - `CORPUS_DATABASE_URL`  → dev (corpus/glosario, 67k chunks)
   - `SUPABASE_JWKS_URL`  → `https://auxlnexhkmtoedrzfsnz.supabase.co/auth/v1/.well-known/jwks.json`
   - `LLM_MODEL` = `claude-sonnet-5` · `LLM_LIGHT_MODEL` = `claude-haiku-4-5` · `LLM_API_KEY`
   - `EMBEDDING_PROVIDER` = `cohere` · `EMBEDDING_MODEL` = `embed-v4.0` · `EMBEDDING_DIM` = `1024` · `EMBEDDING_API_KEY`
   - `CORS_ORIGINS` = **la URL del front en Vercel** (p. ej. `https://tuvetia.vercel.app`) ← si falta, el navegador bloquea las llamadas.
   - `APP_ENV` = `prod`
5. Deploy → Railway te da una URL pública, p. ej. `https://athos-production.up.railway.app`. **Copia esa URL** (va en el front, paso §2).
6. Verifica: `GET <url>/health` → `{"status":"ok"}`.

## 2) Front en Vercel  (lo hace: tú/Santi)
> El front vive en la **raíz** del repo (Next.js). La UI nueva está en el **PR #1**; para que Vercel
> la publique hay que **mergear el PR #1** (Vercel de Santi despliega `master`) o desplegar la rama.
1. Proyecto Vercel apuntando a `plogy-dev/tuvetia` (Root = raíz, **no** `athos-service/`).
2. **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://auxlnexhkmtoedrzfsnz.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon/publishable del principal (la que está en `.env.local`; es pública)
   - `NEXT_PUBLIC_ATHOS_URL` = **la URL de Railway del paso §1.5**  ← el único enlace front→backend
3. Deploy. La URL de Vercel es la que comparten a los testers.

## 3) Auth en Supabase (principal) — para que los testers puedan loguearse
En el dashboard del **principal** (config de Santi) → **Authentication → URL Configuration**:
- **Site URL** y **Redirect URLs**: agregar la URL de Vercel, p. ej. `https://tuvetia.vercel.app/**`.
- Sin esto, el magic-link / Google **no vuelven** a la app desplegada (mismo problema que tuvimos con `localhost`).

## 4) 🔐 Antes de desplegar: ROTAR credenciales
Las keys y la password de DB **se pegaron por chat** durante el desarrollo. Antes de dejarlas en
Railway/Vercel (entorno compartido), rotar y usar las nuevas:
- Password de la DB del **principal** (Supabase → Database → reset password) → actualizar `DATABASE_URL`.
- **`sb_secret`** del principal (Supabase → API keys).
- **Anthropic** (`LLM_API_KEY`) y **Cohere** (`EMBEDDING_API_KEY`).
- `.env` / `.env.principal` **nunca** se commitean (ya gitignoreados; en git solo va `.env.example`).

## 5) Futuro: mover el backend a Vercel (predispuesto, sin cabos sueltos)
Ya quedó todo listo en `athos-service/`:
- `api/index.py` — entrypoint ASGI para Vercel (expone la app FastAPI).
- `vercel.json` — rewrites de todas las rutas + `maxDuration: 300`.
- `requirements.txt` — bundle liviano (sin `llama-index`).

Pasos el día que se pague Vercel:
1. Nuevo proyecto Vercel con **Root Directory = `athos-service/`** (o merge al proyecto único).
2. Mismas env vars que Railway (§1.4).
3. **Plan Pro obligatorio**: el Modo Fantasma tarda ~60–90 s; en free las funciones cortan a ~60 s → timeout. Pro sube a 300 s (`maxDuration`).
4. Cambiar en el front **una sola variable**: `NEXT_PUBLIC_ATHOS_URL` → la nueva URL de Vercel. **Nada más.**
5. (Opcional) apagar el servicio de Railway.

## 6) Modo Fantasma (E5) — captura, consentimiento y transcripción
Hasta E5 el Fantasma sabía redactar la nota pero **nadie producía el transcript**. Esta pieza cierra
la entrada del flujo:

```
grabar ──▶ consentimiento (Ley 1581) ──▶ audio a Storage ──▶ consultation_audios
      ──▶ POST /athos/transcribe (Deepgram nova-2, es, diarize) ──▶ transcripts
      ──▶ POST /athos/phantom/suggest ──▶ clinical_notes draft ──▶ el vet aprueba
```

**Ruta nueva:** `POST /athos/transcribe`, body `{ consultation_id, clinic_id }` → `{ transcript_id,
full_text, stt_model }`. Igual que las demás: verifica el JWT de Supabase del `Authorization: Bearer`
y resuelve el `clinic_id` contra la membresía del usuario. La llama el front (`athosTranscribe` en
`src/lib/athos.ts`) justo después de subir el audio. Baja el objeto del bucket con `service_role`,
lo manda a Deepgram y escribe `public.transcripts` (con los segmentos diarizados en `segments`).
Mueve `consultations.status`: `transcribing` mientras corre → `generating_note` al terminar, y lo
devuelve a `open` si algo falla.

**Bucket `consultation-audios` (privado) y sus 4 policies.** Migración
`supabase/migrations/0004_phantom_audio_storage.sql`. Ruta de los objetos:
`<clinic_id>/<consultation_id>/<audio_id>.webm` — el **primer segmento es el `clinic_id`**, y es lo
que usan las policies para aislar por clínica (`(storage.foldername(name))[1] =
private.my_clinic_id()::text`).
Son **4** policies (select/insert/update/delete), no 3: el servicio de Storage hace internamente
`INSERT ... RETURNING` para devolver los metadatos del objeto, y Postgres exige una policy de SELECT
permisiva para autorizar ese `RETURNING` — sin ella **el INSERT completo se rechaza** con
`new row violates row-level security policy for table "objects"`. Ya nos pasó con `patient-photos`
(causa raíz documentada en `DATABASE.md`, sección *Storage*). Si el insert del audio falla con error
de Storage, lo primero que hay que mirar es que estén las 4.

**Trigger de consentimiento (no negociable).** `consultation_audios_require_consent` (BEFORE INSERT
sobre `public.consultation_audios`, función `private.enforce_consent_before_audio()`): si no hay fila
en `consents` para esa `(consultation_id, clinic_id)`, el insert se rechaza con `check_violation` y el
mensaje *"Ley 1581: no se puede registrar audio sin consentimiento previo…"*. La UI **también** pide
el consentimiento antes de habilitar el micrófono, pero el no negociable vive en la BD: deja de
depender de que el front se porte bien. Prueba de regresión: intentar insertar un audio para una
consulta sin `consents` debe fallar.

**Retención.** `consultation_audios.retain_until` tiene default `now() + 7 days` + índice
`consultation_audios_retention_idx` para el job de purga. El **audio** se borra a los 7 días; el
**transcript se conserva**.

**Variables en Railway** (Settings → Variables, se suman a las de §1.4):
- `SUPABASE_URL` = `https://auxlnexhkmtoedrzfsnz.supabase.co` — **NUEVA en Railway.** Chat y phantom
  van directo a Postgres (`DATABASE_URL`) y nunca la usaron; `/athos/transcribe` es el **primer**
  endpoint que baja el audio de Storage por HTTP, así que es el primero que la necesita.
- `SUPABASE_SERVICE_ROLE_KEY` = la service_role del principal (SECRETA) — **NUEVA en Railway.** Se usa
  para descargar del bucket privado saltándose RLS. Sin `SUPABASE_URL` **o** sin esta key, la URL de
  descarga queda sin host y la transcripción muere **antes de llamar a Deepgram** (no vas a ver ni un
  `GET` en los logs de Storage). Con el arreglo de `transcription.py` el error ahora es explícito:
  *"faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY…"*.
- `DEEPGRAM_API_KEY` = la key de console.deepgram.com — **sin ella `/athos/transcribe` devuelve 500**.
- `STT_MODEL` = `nova-2` (el idioma `es` y `diarize` van fijos en código, no por env var).
- `CORS_ORIGINS` = **las dos URLs separadas por coma**: `https://<la-url-de-vercel>,http://localhost:3000`.
  La grabación se prueba mucho en local contra el backend desplegado; si solo está la de Vercel, el
  navegador bloquea la llamada desde `localhost`.

> **Síntoma de que faltan estas dos (nos pasó).** El audio sube bien (POST 200 en Storage) y se crea
> la fila en `consultation_audios`, pero **no aparece ningún transcript nuevo** y la consulta vuelve a
> `open`. En los logs de Storage se ven los `POST` de subida pero **ningún `GET`** de descarga: el
> backend nunca llega a pedir el archivo porque la URL no tiene host. No es un problema de Deepgram.

**En Vercel no se agrega nada**: el front solo necesita `NEXT_PUBLIC_ATHOS_URL`, que ya existe.
Ningún secreto de Deepgram toca el navegador ni el repo (en git solo el nombre, en `.env.example`).

**Por qué la transcripción sigue en Railway y no en Vercel.** Es la razón de §5 pero más aguda: subir
el audio + Deepgram tarda **decenas de segundos**, y encima corre antes del Fantasma (~60–90 s más).
En el plan free de Vercel las funciones cortan a ~60 s → timeout garantizado. El `maxDuration: 300`
de `vercel.json` ya está puesto, pero **requiere plan Pro**. Hasta que se pague, Railway.

**Pendientes (deuda conocida, no bloquea E5):**
- **Job de purga de audio a 7 días: IMPLEMENTADO.** Route `/api/cron/purge-audio` (front/Vercel): borra
  del bucket los audios vencidos (`retain_until < now`) y anula `storage_path` (la columna pasó a
  nullable, migración `0012`). Lo dispara **Vercel Cron** a diario (`vercel.json` raíz, `0 3 * * *`).
  Requiere en Vercel: `SUPABASE_SERVICE_ROLE_KEY` (ya para el calendario) y **`CRON_SECRET`** (Vercel
  lo manda como `Authorization: Bearer`). El transcript se conserva.
- **Transcripción en batch, no en vivo:** se transcribe al detener la grabación, no mientras se habla.
- **Retención del transcript:** decisión legal **abierta** (ADR-0018). Hoy se conserva indefinidamente.
- **Roles de hablante por heurística:** Deepgram devuelve índices (0,1,…), no roles; asumimos que el
  hablante 0 es el veterinario. Los segmentos crudos quedan en `transcripts.segments`, así que el dato
  original no se pierde si luego se permite intercambiarlos en la UI.

## 7) Hands-off
Conectados Railway y Vercel al repo, **cada `git push` a `master` redespliega ambos** automáticamente.
A partir de ahí: trabajas en la estética/UX, haces push, y se actualiza solo. Sin tocar dashboards.
