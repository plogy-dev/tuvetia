# Agent smoke testing — capa agéntica de Athos

**Ítem 2.4 de la auditoría del Milestone 2.** Documento de resultados del banco de pruebas de la capa
agéntica: qué se verifica, con qué evidencia, y qué queda sin cubrir.

- **Suite:** `src/lib/athos-agent/__tests__/agent-smoke.test.ts` — 22 casos
- **Corre en:** CI (`.github/workflows/ci.yml`, job `front`), en cada push y PR
- **Commits:** `1b84e65` (invariantes de seguridad, 29-jul) · `b1c33cb` (robustez de fechas, 29-jul)
- **Última verificación:** 2026-07-29

## Qué es la capa agéntica y por qué estas pruebas

El agente vive en el front (`src/lib/athos-agent/`), no en el servicio de Athos. Expone **17 tools**
al modelo: 10 de lectura y 7 de escritura. La regla que sostiene todo el diseño es **"Athos propone,
el veterinario aprueba"**: ninguna de las 7 tools de escritura ejecuta nada. Todas insertan una fila
en `athos_actions` con `status='proposed'`, y la ejecución ocurre en otra request, **bajo la sesión
del veterinario que aprueba** — de modo que la RLS ve su `auth.uid()` real, sin impersonación.

Un smoke test de una capa agéntica no puede ser "¿el modelo contesta bien?". Lo que hay que fijar es
que **no exista ningún camino por el que el modelo escriba sin aprobación humana**, porque eso no lo
garantiza un prompt: lo garantiza el código. De ahí el enfoque: las pruebas atacan los invariantes,
no la calidad de la conversación.

## Resultados

### 1. Aprobación humana — no hay camino de auto-ejecución (7 casos)

| Verifica | Resultado |
|---|---|
| `proposeAction` siempre marca `risk='approval'` | ✅ |
| La fila siempre nace en estado propuesto, nunca ejecutado | ✅ |
| El `clinic_id` sale del CONTEXTO del servidor, no del payload del modelo | ✅ |
| Queda registrado quién propuso (traza de auditoría) | ✅ |
| En modo automático queda `created_by = null`, no atribuido a un veterinario | ✅ |
| Si el insert falla, devuelve error legible y **no finge** que se propuso | ✅ |
| El resultado le dice explícitamente al modelo que la acción NO está ejecutada | ✅ |

El tercero es el que más importa: si el `clinic_id` viniera del payload, el modelo —o cualquier cosa
que influya en el modelo, incluido el texto que escribe un titular por WhatsApp— podría escribir en
otra clínica. Está tomado del contexto del servidor y el test lo fija.

### 2. Inventario de tools y separación lectura/escritura (3 casos)

| Verifica | Resultado |
|---|---|
| Expone exactamente las 17 tools esperadas (ni una de más) | ✅ |
| Cada tool declara un `inputSchema` — el modelo no manda campos libres | ✅ |
| **Ninguna** de las 7 tools de escritura ejecuta: todas terminan en propuesta | ✅ |

El primero es un cerrojo contra el crecimiento silencioso: agregar una tool obliga a tocar el test, y
por lo tanto a decidir explícitamente si es de lectura o de escritura.

### 3. Zona horaria — la hora local del veterinario no se corre de día (2 casos)

| Verifica | Resultado |
|---|---|
| Fija el offset de Colombia sin depender de la TZ del servidor | ✅ |
| Una cita nocturna conserva su fecha local | ✅ |

Colombia no tiene horario de verano, así que el offset es fijo `-05:00`. Importa porque el servidor
corre en UTC: una cita de las 19:00 en Bogotá es del día siguiente en UTC, y sin anclar la zona
aparecía un día corrido.

### 4. Fechas imposibles — el tool responde, no se cae (10 casos)

Los `inputSchema` validan **formato** con regex, no calendario: `2026-02-30` y `99:99` pasan
`/^\d{4}-\d{2}-\d{2}$/` sin problema. Y los modelos producen febrero 30 y mes 13 con más frecuencia
de la que uno esperaría.

| Verifica | Resultado |
|---|---|
| `create_appointment` devuelve error legible con `2026-13-01`, `2026-00-10`, `2026-04-31`, `2026-02-30`, `2026-02-29` (5 casos) | ✅ |
| Tampoco se cae con una hora imposible (`99:99`) | ✅ |
| Funciona sin `duration_min` — no depende de que alguien aplicó el default del schema | ✅ |
| Las tools de LECTURA por día también responden en vez de lanzar | ✅ |
| Se fija el comportamiento del runtime: JavaScript rueda `2026-02-30` a marzo sin quejarse | ✅ |
| Una cita pedida para el 30 de febrero **no** se agenda el 2 de marzo | ✅ |

Este bloque nació de dos defectos distintos, y el segundo es el grave:

1. **Un crash.** `new Date(NaN).toISOString()` lanza `RangeError: Invalid time value` y **tumbaba el
   turno completo del agente**, sin mensaje útil para el veterinario. Ahora el tool devuelve un error
   legible y el modelo puede corregir la fecha y reintentar.
2. **Corrupción silenciosa.** `2026-02-30` **no** es una fecha inválida para JavaScript: la rueda a
   `2026-03-02`. Igual que `2026-02-29`, porque 2026 no es bisiesto, que cae en `2026-03-01`. Sin
   comprobación de ida y vuelta, **la cita quedaba agendada otro día y nadie se enteraba**. Eso es
   peor que un error: un error se ve. La guarda reconstruye la fecha local y exige que sea la pedida.

## Cómo reproducirlo

```bash
npm ci
npx next typegen      # obligatorio antes de tsc: next-env.d.ts está en .gitignore
npx tsc --noEmit
npm test -- src/lib/athos-agent/__tests__/agent-smoke.test.ts
```

**Node ≥ 22.12** o, con 22.11, exportar `NODE_OPTIONS=--experimental-require-module`:

```bash
NODE_OPTIONS=--experimental-require-module npm test     # sirve en Node 22.11
```

El fallo con 22.11 es `ERR_REQUIRE_ESM` al cargar `vitest.config.ts`: `require()` de un módulo ESM
llegó sin flag en 22.12, y en 22.11 existe detrás de esa bandera. Es del entorno, no de la suite.
Durante días se dio por imposible correr las pruebas del front en local y se dependió del CI para
todo; con el flag corren las **267** en unos 40 s. El CI usa `node-version: 22`, que resuelve a la
última 22.x y no lo necesita.

## Lo que estas pruebas NO cubren

Se declara explícitamente para que nadie lea la suite como más cobertura de la que da:

1. **La lógica autenticada del ciclo de aprobación.** El **borde de autenticación** de las rutas
   `POST /api/athos/actions/[id]/execute` y `.../reject` **sí** está cubierto, por la suite e2e
   (`e2e/smoke.e2e.ts`, `c85c029`), que verifica contra el despliegue real que ninguna de las dos
   atiende sin sesión. Lo que queda sin automatizar es lo que pasa **con** sesión: la reserva atómica
   `proposed→approved` contra el doble clic, el 409 en lo ya procesado y el 410 en lo expirado. Está
   verificado **por inspección de código** y es correcto; falta la prueba.
2. ~~`payload_override` no se revalida.~~ ✅ **Cerrado el 30-jul**: se revalida contra el esquema de
   lo que la tool **guarda** (`payload-schemas.ts`, 9 pruebas), y los campos desconocidos se
   descartan. No se reusó el `inputSchema` porque describe lo que el modelo escribe, no lo que se
   guarda — validar contra él habría fallado siempre.
3. **La calidad de las decisiones del modelo.** Nada acá mide si el agente elige la tool correcta o
   interpreta bien al veterinario. Eso lo miden los bancos de `athos-service/scripts/calidad/`, que
   son otro instrumento y otro documento.
4. **No hay pruebas contra la base real.** Todo corre con un cliente de Supabase falso. El
   aislamiento por clínica en la base lo cubren los tests cross-tenant del backend
   (`athos-service/tests/test_cross_tenant.py`). Ojo con la historia de esta garantía: esos tests
   **se auto-saltaron en CI durante toda su vida** porque el job no montaba ninguna base (auditoría
   2026-07-30). Desde el 30-jul el job monta un Postgres (`services:` en `ci.yml`) y corren en cada
   push — si vuelven a aparecer como `s` en la salida de pytest del CI, esta garantía volvió a ser
   papel.

## Suite complementaria: smoke e2e contra el despliegue real

`e2e/smoke.e2e.ts` (`c85c029`) es otro instrumento y conviene no confundirlos: la suite de arriba
corre **en CI, con un Supabase falso**, y fija invariantes de código. La e2e corre **contra producción
por HTTP** cada 6 horas (`.github/workflows/smoke.yml`) y verifica que el despliegue esté bien
cerrado: rutas privadas que redirigen, las 5 APIs de sesión que rechazan a un anónimo —incluidas
`execute` y `reject` de las acciones del agente—, los webhooks de WhatsApp que no aceptan un token
inválido, y el backend de Railway vivo con `/athos/chat` exigiendo JWT.

Trae además `GET /api/health`, que responde **qué está cableado en producción sin revelar ningún
valor** (solo booleanos, protegido con `CRON_SECRET`). Es la respuesta al problema que abrió la
auditoría: las variables faltantes apagan funciones enteras **en silencio** —sin `CRON_SECRET` la
purga de audio de la Ley 1581 no corre, sin `SUPABASE_SERVICE_ROLE_KEY` fallan las escrituras del
agente— y nada de eso da un error visible en la interfaz. Ahora se puede comprobar desde afuera.

## Documentos relacionados

- `athos-service/docs/AUDITORIA-MILESTONE2-2026-07-29.md` — auditoría de cumplimiento (ítem 2.4)
- `docs/ARQUITECTURA.md` — el ciclo "el agente propone / el vet ejecuta", con diagrama
- `docs/API.md` — las 22 rutas, con su mecanismo de autenticación
- `INVENTARIO-COMPONENTES.md` — inventario formal de componentes (93 en la v1.1; la cifra de 88 era de la v1.0)
