# Diagnóstico de cableado, UI, admin panel, antifraude y topes

**Fecha:** 16 de agosto de 2026
**Contra:** `master` @ `aae70ef` y el proyecto principal `auxlnexhkmtoedrzfsnz`.
**Método:** mediciones, no lectura. Cada afirmación lleva el número o la ruta de donde sale.

---

## Salud base

| | |
|---|---|
| `tsc --noEmit` | ✅ 0 errores |
| `eslint src --max-warnings=0` | ✅ 0 |
| Tests del front | ✅ **743** en 69 archivos |
| Tests del servicio | ✅ **261** (11 saltados) |
| `next build` | ✅ |
| **Rutas del dashboard sin enlace entrante** | **0 de 32** |

Las 32 rutas son alcanzables desde la interfaz. No hay pantallas huérfanas.

---

## 1. Lo que está construido y NO tiene interruptor

Es el hallazgo principal, y afecta a lo que más se trabajó esta semana.

### 1.1 · La desactivación de cuentas no se puede activar

`profiles.is_active` se **lee en dos lugares** —`dashboard/layout.tsx:33` y `bienvenida/page.tsx:27`,
que son el gate— y **no se escribe en ninguno**. Ni una ruta, ni una acción, ni un botón, ni un RPC.

O sea: el gate de la migración 0059 funciona (verificado contra Postgres, 7 comprobaciones en OK), el
bypass está cerrado (0060), **y no existe forma de desactivar a nadie desde el producto**. Sólo por
SQL a mano.

**No es un defecto**: es la fase 2 del plan antifraude, que todavía no se hizo. Pero conviene decirlo
con claridad, porque desde afuera "la desactivación está lista" y no lo está.

### 1.2 · El tope de gasto está apagado

`ATHOS_TOPE_MENSUAL_POR_CLINICA` está **vacía**. Con eso `topeConfigurado()` devuelve `null`, no se
consulta la base, no se corta nada y el medidor «Consultas con IA» del riel **no se pinta**.

Es deliberado —el acta tiene abierto «definir el límite exacto entre gratis y pago»— pero significa
que hoy, en producción, **el gasto de IA no tiene techo**. El único freno vivo es `rateLimit`, que
sigue siendo en memoria y por lambda: `api/athos/agent/route.ts:47` (30/min) y
`api/athos/suggest-reply/route.ts:34` (15/min).

> **No pude verificar si la variable está puesta en Vercel.** Si lo está, el tope sí está activo.
> Es lo primero que hay que confirmar de esta lista.

### 1.3 · Las tres vistas de antifraude que faltan

| Vista de §9.3 del acta | Estado |
|---|---|
| Monitoreo de requests | ✅ `/admin/costos`, costo real por tokens |
| Usuarios con última fecha de ingreso | ✅ `/admin/usuarios`, con flag «nunca entró» |
| **Desactivación manual** | ✗ no hay botón (ver 1.1) |
| **Desactivación automática** | ✗ no hay cron — los workflows son `cartera-sweep`, `ci`, `smoke` |
| **Señales de abuso** | ✗ nada de correos parecidos ni IP |

---

## 2. Cableado: lo que sí está conectado

Se revisó porque parecía roto y **no lo está**. Queda escrito para no volver a levantarlo:

- **El motor de cartera corre.** El cron de GitHub llama a `/api/cron/cartera` → `run-all.ts` →
  `runCarteraSweepForClinic`. Los que salieron como muertos (`planNextReminders`,
  `dispatchDueReminders`) son auxiliares que quedaron sin uso, no el motor.
- **Las tareas escaladas a una persona se ven.** `openHumanTask` las crea desde `cartera/inbound.ts`
  y `cartera/receipts.ts`, y `/dashboard/facturacion/cartera` las pinta con `HumanTasksPanel`. El
  circuito cierra.
- **Las seis superficies de IA pasan por el tope** (cuando esté encendido): chat, bandeja, modo
  automático, cartera, y las dos de visión.

---

## 3. Código muerto: 57 exports que nadie usa

Ni en código ni en tests. La mayoría es inofensiva —constantes de facturación, enums, helpers
duplicados— pero **dos son callejones sin salida de interfaz**:

- **`SourceCard`** (`components/athos/source-card.tsx`). La tarjeta de fuente de una cita está
  construida y **no se monta en ninguna parte**. Las citas se pintan hoy sólo como `[n]` enlazado.
- **`ListaEnBloque` y `FilaEncabezado`** (`components/ui/page-shell.tsx`). Son las primitivas que la
  comparativa contra el mockup daba por «listas para el rediseño de Pacientes». Nunca se usaron.

El resto está en `lib/facturacion/*` (enums y constantes exportados por completitud) y en
`lib/facturacion/import/*`, que es el flujo de importación **apagado a propósito** por la
vulnerabilidad de `xlsx`.

---

## 4. Base de datos

### 4.1 · Seguridad

Sin hallazgos nuevos. Los que aparecen ya estaban catalogados en `docs/SEGURIDAD-DB.md`:
`rls_enabled_no_policy` en `athos_agent_usage` (intencional desde la 0052: RLS sin policy = deniega
todo, sólo `service_role` lee) y en `corpus_chunks`, `extension_in_public` del vector, y las 17
funciones `SECURITY DEFINER` alcanzables por `authenticated` — cada una re-implementa su control por
dentro.

### 4.2 · Rendimiento: 126 avisos, y uno es mío

| | |
|---|---|
| `unindexed_foreign_keys` | 64 (INFO) |
| `unused_index` | 47 (INFO) |
| `multiple_permissive_policies` | 6 (WARN) — todas en `memberships` |
| `duplicate_index` | 4 (WARN) |
| `auth_rls_initplan` | 3 (WARN) |
| `no_primary_key` | 1 — `appointments_importadas_respaldo`, tabla de respaldo |

**`auth_rls_initplan` sobre `profiles_select` es mío**, de la migración 0059: la policy usa
`auth.uid()` sin envolver, así que Postgres lo reevalúa **fila por fila**. Se arregla escribiendo
`(select auth.uid())`. Hoy con 17 perfiles no se nota; con miles, sí. Lo mismo aplica a
`profiles_update` y a `memberships_select_own`, que ya venían así.

**Los 4 índices duplicados** son pares con el mismo contenido y distinto nombre
(`clinical_notes`, `consultations`, `memberships`, `transcripts`) — venían de renombrados. Borrar uno
de cada par es gratis y libera escritura.

---

## 5. UI, después de los cambios de esta semana

Lo que se movió y su estado medido:

| | Antes | Ahora |
|---|---|---|
| `--radius` | 8px | **12px** → controles 9px, cards 18px |
| `rounded` pelados fuera del token | 23 | **0** |
| Trazo de icono en la barra | 2 (default lucide) | **1.5**, igual que la tab bar móvil |
| Avatares del usuario | dos formas distintas | círculo, las dos |
| Indicador de nav | icono | **punto** expandida · icono colapsada |
| Superficies de grabación simultáneas | **3** | 1 |
| Cuadernos sin sincronizar | 2 | 1 |
| Clics de "quiero grabar" a grabando | 3–4 | **2** |

**Tres radios crudos siguen fuera del sistema**, en `components/calendar/calendar-theme.css:8,50,81`
(`0.75rem`, `6px`, `9999px`). No usan `var(--radius)`, así que el calendario no se redondeó con el
resto.

---

## 6. Lo que no pude verificar, y hay que decirlo

- **Nada de esto se vio funcionando.** No hay `.env.local`, así que la app no arranca en esta
  máquina. Todo lo de UI está cubierto por tipos, lint, 743 tests y build — pero el radio de 18px,
  los puntos de la barra y el layout nuevo de la consulta son juicios que se hacen con el ojo.
- **Si `ATHOS_TOPE_MENSUAL_POR_CLINICA` está puesta en Vercel.** De eso depende que el punto 1.2 sea
  «apagado a propósito» o «apagado sin querer».
- **La retención de `auth.audit_log_entries`**, que decide si la señal de IP del antifraude sirve.

---

## Orden sugerido

1. **Confirmar la variable del tope en Vercel** (5 minutos). Es la diferencia entre tener techo de
   gasto y no tenerlo.
2. **Mirar la UI en el deploy** — sobre todo las cards a 18px y la consulta en una columna. Si el
   radio es excesivo, es una línea.
3. **El interruptor de desactivación** (fase 2 del antifraude). El gate está listo y probado; sin
   botón no sirve de nada.
4. **Los 4 índices duplicados y el `(select auth.uid())`** — media hora, y el segundo lo introduje yo.
5. **Decidir sobre `SourceCard`**: montarla donde corresponde o borrarla. Un componente construido y
   nunca montado es deuda que parece funcionalidad.
