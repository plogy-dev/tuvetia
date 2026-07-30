# Arquitectura del front

Cómo está armada la aplicación Next.js y **por qué**. Para el backend Athos, ver
[`athos-service/CLAUDE.md`](../athos-service/CLAUDE.md).

---

## El dibujo

```
   navegador
      │
      ▼
  proxy.ts ──────► refresca la sesión de Supabase y protege /dashboard
      │
      ├─► server components ──► Supabase (RLS con la sesión del vet)
      │        resuelven datos ANTES del primer paint
      │
      ├─► /api/athos/agent ──► agente (17 tools) ──┬─► Supabase (sesión del vet)
      │                                            └─► POST /athos/retrieve ─► Athos
      │
      ├─► /api/whatsapp/* ───► proveedor (Kapso | Meta | Evolution)
      │
      └─► /api/cron/* ───────► tareas programadas de Vercel
```

## Las cuatro decisiones que explican todo lo demás

### 1. Los datos se resuelven en el servidor, no en el navegador

Las páginas de `/dashboard` son **server components**: consultan Supabase con la sesión del
veterinario y pasan los datos ya listos al componente cliente. Antes el navegador hacía
`getUser() → profiles → patients` en serie: tres viajes de red antes de ver algo.

Consecuencia práctica que hay que recordar: **corren en UTC en Vercel**. Cualquier fecha que se le
muestre al usuario tiene que pasar por `src/lib/date-utils.ts`, que ancla a `America/Bogota`. Formatear
sin `timeZone` hace que una consulta de las 19:00 aparezca con la fecha del día siguiente.

### 2. Cuatro clientes de Supabase, y usar el que corresponde importa

| Cliente | Dónde | Con qué permisos |
|---|---|---|
| `lib/supabase/server.ts` | server components y rutas de API | **sesión del vet** — la RLS aplica |
| `lib/supabase/client.ts` | componentes con `"use client"` | sesión del vet |
| `lib/supabase/middleware.ts` | `proxy.ts` | sólo refresca cookies |
| `lib/supabase/admin.ts` | rutas de API, casos contados | **`service_role`: se salta TODA la RLS** |

La regla: **`admin` sólo cuando la RLS no puede expresar la operación** — hoy son las propuestas del
agente (la tabla `athos_actions` no tiene policy de INSERT a propósito) y los webhooks de WhatsApp
(entra Meta, no un usuario). Y siempre con el `clinic_id` explícito, porque el `service_role` no tiene
quien lo acote.

### 3. El agente propone, el veterinario ejecuta

Es la decisión de diseño más importante del sistema, y está en el código, no en el prompt:

```
el modelo llama una tool de escritura
        │
        ▼
proposeAction()  →  fila en athos_actions con risk:"approval"  (service_role)
        │              nunca hay auto-aprobación: el valor está fijo
        ▼
tarjeta de aprobación en la UI (el vet puede EDITAR el payload)
        │
        ▼
POST /api/athos/actions/[id]/execute
        │
        └─► se ejecuta CON LA SESIÓN DEL VET que aprueba
            → las RPC SECURITY DEFINER ven el auth.uid() real
            → la RLS aplica de verdad, sin impersonación
```

Con reserva atómica (*compare-and-set*) antes de despachar, para que un doble clic no cree dos citas
ni mande dos WhatsApp. Las 7 tools de escritura están cubiertas por
`src/lib/athos-agent/__tests__/agent-smoke.test.ts`.

### 4. Athos vive aparte, y se habla por HTTP

El RAG clínico es un servicio Python separado porque su trabajo es distinto: pgvector, corpus de
520.000 fragmentos, modelos de embedding. El front lo consume por `NEXT_PUBLIC_ATHOS_URL` pasando el
**JWT del veterinario**, así que Athos verifica la sesión y resuelve la clínica por su cuenta.

| Superficie | Motor | ¿Tiene tools? |
|---|---|---|
| `/dashboard/asistente` | `/api/athos/agent` (Next, AI SDK) | **sí, las 17** |
| Botón "Sugerir" de la bandeja | `/api/athos/suggest-reply` | sí, las 17 |
| Chat dentro de la consulta | `POST /athos/chat` (Athos, SSE) | no — RAG puro |

---

## Autenticación y sesión

`proxy.ts` corre en cada navegación (menos `/api`, `/auth` y estáticos: los excluye el `matcher`
porque manejan sus propias cookies) y hace dos cosas: refresca la sesión y redirige — sin sesión a
`/dashboard` va a `/login`; con sesión a `/login` va a `/dashboard`.

**El canje de código NO ocurre en el proxy** sino en rutas dedicadas, y esto es una fuente clásica de
bugs:

| Ruta | Qué hace |
|---|---|
| `/auth/callback` | `exchangeCodeForSession` — el flujo PKCE (`?code=`) |
| `/auth/confirm` | `verifyOtp` — el enlace mágico (`?token_hash=`) |
| `/auth/signout` | cierra sesión. **POST**, porque con GET el prefetch de `<Link>` la cerraría al pasar el mouse |

**Cualquier enlace de correo tiene que aterrizar en `/auth/callback?next=…`, no en la página final.**
Una página que sólo hace `getUser()` no canjea el código: el usuario llega sin sesión y el enlace
"no hace nada". Fue exactamente el bug de las invitaciones.

El aprovisionamiento de clínica lo garantiza un **disparador de base de datos** sobre
`auth.users.email_confirmed_at`, no código de la aplicación: así funciona igual para enlace mágico,
Google OAuth e invitaciones, y no se rompe si falla el navegador. Detalle en
[`MULTITENANT.md`](../MULTITENANT.md).

## Módulos de dominio en `src/lib/`

| Módulo | Qué hace | Estado |
|---|---|---|
| `athos-agent/` | El agente: `tools.ts` (17), `model.ts` (modelo por env), `system-prompt.ts`, `actions.ts` (propuestas), `rate-limit.ts` | operando |
| `whatsapp/` | Capa proveedor-agnóstica. `provider.ts` despacha por `whatsapp_integrations.provider`; `inbound-router.ts` es el **punto único** de entrada de los webhooks | operando |
| `facturacion/` · `cartera/` | Motor fiscal, catálogo, inventario, compras y recaudo. Dominio puro, 186 pruebas | ⚠️ **sin UI**: no hay rutas ni entrada de menú |
| `google-calendar.ts` | Envío y traída de eventos, tokens por veterinario | parcial: la traída es manual |
| `supabase/` | Los cuatro clientes | operando |
| `date-utils.ts` | Fechas ancladas a Bogotá | operando |
| `athos-history.ts` | Precarga del historial del asistente | operando |

**Sobre facturación:** el módulo está completo y probado pero es **inalcanzable desde la aplicación**.
Los `revalidatePath` apuntan a rutas que todavía no existen. Antes de exponerlo hay que resolver la
vulnerabilidad de `xlsx`, que corre del lado del servidor en el importador.

## Convenciones

- **Colombia no tiene horario de verano**, así que los horarios locales se fijan con offset `-05:00`
  (`localToIso` en `athos-agent/tools.ts`). Para mostrar fechas, `date-utils.ts`.
- **Dinero en centavos, enteros**, con redondeo *half-up* propio (`facturacion/domain/money.ts`).
  `Math.round` de JS redondea `-0.5` hacia cero y eso no sirve para plata.
- **Modelos de IA nunca hardcodeados**: siempre por variable de entorno.
- **Los errores de consulta se muestran**, no se tragan: `<DataError>` en los listados. Un error
  silencioso se ve igual que "no hay datos".
- **shadcn/ui** en `components/ui` — no editarlos a mano salvo que haya razón; el resto de
  `components/` es de dominio.

## Pruebas

`vitest` con `include: src/**/*.test.ts` y `environment: node`: **lógica pura, sin DB ni runtime de
Next**. Por eso lo que se testea vive en `src/lib/` y no en las páginas — si algo necesita cobertura,
extraelo a un módulo (como se hizo con `athos-history.ts`).

Hoy: 186 pruebas de facturación/cartera, más los invariantes del agente, las fechas y el historial.
**No hay pruebas de extremo a extremo** — es la deuda más grande de cobertura.
