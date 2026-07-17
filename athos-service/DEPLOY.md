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

## 6) Hands-off
Conectados Railway y Vercel al repo, **cada `git push` a `master` redespliega ambos** automáticamente.
A partir de ahí: trabajas en la estética/UX, haces push, y se actualiza solo. Sin tocar dashboards.
