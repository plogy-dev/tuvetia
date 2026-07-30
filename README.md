# TUVET IA

Plataforma de gestión para clínicas veterinarias con **Athos**, un asistente clínico que responde
citando literatura veterinaria verificable.

Dos piezas en un monorepo:

| | Qué es | Dónde | Se despliega en |
|---|---|---|---|
| **Front** | Next.js 16 (App Router) — la aplicación que usa el veterinario | raíz del repo | Vercel |
| **Athos** | FastAPI + Python — el RAG clínico (recuperación, redacción citada, transcripción) | `athos-service/` | Railway |

Datos en **Supabase** (Postgres + pgvector), con aislamiento por clínica vía RLS.

---

## Arrancar en local

**Prerrequisitos:** Node **≥ 22.12** (`vite` y `rolldown` lo exigen; con 22.11 los tests no corren),
y Python 3.13 + [uv](https://docs.astral.sh/uv/) sólo si vas a tocar el backend.

```bash
# 1. Front
npm ci
cp .env.example .env.local      # completá al menos las 4 variables OBLIGATORIAS
npm run dev                     # http://localhost:3000

# 2. Backend Athos (opcional: el front puede apuntar al Railway de producción)
cd athos-service
uv sync
cp .env.example .env            # ojo: este .env apunta a la DB de DEV, no al principal
uv run uvicorn app.main:app --reload --port 8000
```

`.env.example` explica, variable por variable, **qué se rompe si falta**. Con las 4 obligatorias
tenés el núcleo clínico funcionando; el resto habilita módulos (WhatsApp, Google Calendar, crons).

## Verificar que no rompiste nada

```bash
npm run lint                    # eslint
npm test                        # vitest — lógica pura, sin DB ni runtime de Next
npx tsc --noEmit                # tipos

cd athos-service
uv run ruff check .             # linter
uv run pytest -q                # 173 pruebas; las de integración se auto-skipean sin DB
```

Todo esto corre también en CI (`.github/workflows/ci.yml`) en cada push y PR.

---

## Mapa del repositorio

```
src/
  app/
    (marketing)/          landing pública, /producto, /seguridad, /demo
    login/  signup/       ingreso (enlace mágico y Google)
    auth/                 callback, confirm, signout — canje de sesión
    invitar/[token]/      aceptar invitación a una clínica
    dashboard/            la aplicación: pacientes, consultas, calendario,
                          comunicaciones, asistente, settings
    api/                  22 rutas — ver docs/API.md
  components/             UI (shadcn en components/ui) y componentes de dominio
  lib/
    supabase/             clientes: server, client, middleware, admin (service_role)
    athos-agent/          el agente: 17 tools, modelo, prompt, propuestas
    athos.ts              cliente del backend Athos
    whatsapp/             capa de proveedor (Kapso · Meta · Evolution) + router
    facturacion/          motor fiscal, catálogo, inventario, compras  ⚠️ sin UI
    cartera/              motor de recaudo (Ley 2300)                  ⚠️ sin UI
athos-service/            backend Athos — tiene su propio CLAUDE.md y docs/
```

## Documentación

**Empezá por acá según lo que vayas a tocar:**

| Si vas a… | Leé |
|---|---|
| entender la arquitectura del front | [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) |
| llamar o modificar una ruta de API | [`docs/API.md`](docs/API.md) |
| saber qué está hecho y qué falta | [`ESTADO.md`](ESTADO.md) |
| saber el estado contractual de cada componente | [`INVENTARIO-COMPONENTES.md`](INVENTARIO-COMPONENTES.md) |
| tocar el RAG, el chat clínico o el Fantasma | [`athos-service/CLAUDE.md`](athos-service/CLAUDE.md) |
| medir calidad de respuestas o retrieval | [`athos-service/scripts/calidad/README.md`](athos-service/scripts/calidad/README.md) |
| tocar la base de datos | [`DATABASE.md`](DATABASE.md) · [`athos-service/docs/MIGRACIONES.md`](athos-service/docs/MIGRACIONES.md) |
| entender el aislamiento por clínica | [`MULTITENANT.md`](MULTITENANT.md) |
| tocar el calendario | [`CALENDARIO.md`](CALENDARIO.md) |
| tocar WhatsApp | [`WHATSAPP.md`](WHATSAPP.md) · [`docs/EVOLUTION.md`](docs/EVOLUTION.md) |
| desplegar | [`athos-service/DEPLOY.md`](athos-service/DEPLOY.md) · [`athos-service/SETUP.md`](athos-service/SETUP.md) |
| las reglas del repo | [`AGENTS.md`](AGENTS.md) |

## Tres cosas que conviene saber antes de escribir código

1. **Este Next tiene cambios de ruptura respecto de lo que probablemente conozcas.** Antes de tocar
   routing, `params` o caché, leé la guía en `node_modules/next/dist/docs/`. Está en
   [`AGENTS.md`](AGENTS.md).

2. **Las reglas clínicas duras están en el código, no en los prompts** — y es deliberado: se midió que
   el prompt no las cumple. El gate de alergia severa, el de dosis y la verificación de citas viven en
   `athos-service/app/generation/` con pruebas propias. No las muevas a un prompt.

3. **Nada de fechas sin zona horaria.** Los server components corren en UTC en Vercel: formatear sin
   `timeZone` hace que una consulta de las 19:00 aparezca con la fecha del día siguiente. Usá
   `src/lib/date-utils.ts`.

## Migraciones

Van en `athos-service/supabase/migrations/`, numeradas. **La próxima disponible es la `0039`.**
Ver [`athos-service/docs/MIGRACIONES.md`](athos-service/docs/MIGRACIONES.md) para el flujo
dev → PR → principal.
