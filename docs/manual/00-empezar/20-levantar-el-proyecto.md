---
titulo: Levantar el proyecto
seccion: empezar
orden: 20
resumen: De un clon vacío a la app corriendo, con lo mínimo indispensable y qué falla si falta cada cosa.
---

# Levantar el proyecto

## Requisitos

| Herramienta | Versión | Para qué |
|---|---|---|
| Node.js | 20 o superior | La app Next |
| npm | el que trae Node | Dependencias y scripts |
| Python | 3.11+ | Sólo si vas a tocar `athos-service` |
| Un proyecto de Supabase | — | Base de datos y auth |

No hace falta Docker para el núcleo. Sí lo necesitás si vas a levantar **Evolution API** (el
proveedor no oficial de WhatsApp), que es un contenedor aparte.

## Los cuatro pasos

```bash
git clone https://github.com/plogy-dev/tuvetia.git
cd tuvetia
npm install
cp .env.example .env.local     # y completar (ver abajo)
npm run dev                    # http://localhost:3000
```

## Lo mínimo para que arranque

De las ~55 variables, **sólo cuatro son obligatorias**. El resto habilita módulos, y cada bloque de
`.env.example` dice qué se rompe si falta. La referencia completa está en
[Secretos y variables de entorno](../30-referencia/10-secretos.md).

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...        # se salta TODA la RLS
NEXT_PUBLIC_ATHOS_URL=https://...    # el backend de Athos
```

> **`SUPABASE_SERVICE_ROLE_KEY` es la llave maestra de la base.** Se salta la RLS entera. Nunca la
> pongas en una variable `NEXT_PUBLIC_*` ni la subas a ningún lado: cualquier `NEXT_PUBLIC_*` se
> embebe en el bundle que descarga el navegador.

Con esas cuatro tenés el CRM completo. Sin `ANTHROPIC_API_KEY`, Athos no responde. Sin las de
WhatsApp, Wompi o Resend, esos módulos avisan en pantalla que no están disponibles — **ninguno falla
en silencio**, y eso es deliberado.

## La base de datos

El esquema se aplica **a mano**, en orden:

1. `athos-service/supabase/bootstrap/000_base_schema.sql` — el esquema base: tablas, enums, RLS y
   las funciones del esquema `private`.
2. Después, todas las migraciones de `athos-service/supabase/migrations/`, **en orden numérico**.

Cada migración está escrita para poder aplicarse contra un proyecto que arrastra historia: usan
`if not exists`, buscan las restricciones por forma y no por nombre, y varias explican en su
cabecera por qué. Ver [Base de datos](../30-referencia/40-base-de-datos.md).

Muchas migraciones tienen su verificación en `athos-service/supabase/verificaciones/`: un `.sql`
que comprueba que lo que la migración prometía quedó efectivamente aplicado.

## Verificar que quedó bien

```bash
npm run verify
```

Es `tsc --noEmit`, `eslint` y `vitest run`, en ese orden. Es lo que hay que pasar antes de cualquier
commit.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm test` | Tests unitarios (vitest, entorno `node`) |
| `npm run test:e2e` | End-to-end |
| `npm run lint` | ESLint |
| `npm run verify` | Los tres encadenados |

### Sobre los tests, y una convención que explica medio repositorio

`vitest.config.mts` corre en `environment: "node"` y toma `src/**/*.test.ts` — **no `.tsx`**. De ahí
sale una regla que se repite en todo el código: **la lógica que quiere cobertura vive en un `.ts`
puro, sin componentes**. Por eso existen `lib/agenda/huecos.ts`, `lib/agenda/filtro.ts`,
`lib/tablero/metricas.ts` y compañía, separados de la pantalla que los usa.

Hay además una familia de tests que **lee el código fuente como texto**
(`pastillas-del-tablero`, `conectar-donde-hace-falta`, `contraste-de-tokens`). No son un truco:
fijan acuerdos *entre* archivos que ningún sistema de tipos puede expresar — por ejemplo, que la
cifra que cuenta una pantalla y la lista que abre su detalle usen exactamente los mismos filtros.

## Fallas comunes al arrancar

| Síntoma | Causa casi segura |
|---|---|
| `createAdminClient()` lanza excepción | Falta `SUPABASE_SERVICE_ROLE_KEY` |
| El asistente responde error | Falta `ANTHROPIC_API_KEY` |
| Los enlaces de los correos apuntan mal | Falta `NEXT_PUBLIC_APP_URL` en local |
| El redirect de WhatsApp sale de la app | `NEXT_PUBLIC_SITE_URL` definida **en blanco** (o tiene valor, o no se define) |
| Un cron devuelve 503 | Falta `CRON_SECRET` |
| El calendario dice "no disponible" | Falta `COMPOSIO_API_KEY` o el auth config del proveedor |
| Los pagos dicen "no habilitados" | Faltan las llaves de Wompi, o no son las cuatro del mismo ambiente |

## Entornos

Qué apunta a dónde está en `ENTORNOS-QUE-APUNTA-A-DONDE.md`, publicado acá mismo en la sección
**Documentos del repositorio**. Leelo antes de tocar nada en producción: hay más de un proyecto de
Supabase en juego y confundirlos es fácil.
