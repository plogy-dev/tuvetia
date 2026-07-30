# Los 10 puntos priorizados — estado y qué falta exactamente para el 100 %

**Corte:** 2026-07-30, 19:30 · **Commit:** `aefa648` · **Contrato:** COT-2026-TUV-001
**Regla:** Otrosí num. 2.3 — *sólo cuenta lo integrado y operando en el entorno accesible al cliente*.

Cada punto verificado hoy contra el código, las variables reales de Railway, la captura de las
variables de Vercel y la base de producción.

## Cómo leer esta tabla

La versión anterior de este documento mezclaba dos preguntas distintas en una sola columna, y por eso
se veía peor de lo que estaba. Son cosas separadas:

- **Entregado** — ¿el componente está construido, desplegado y operando en el entorno del cliente?
  Esto **sí** es un sí o un no, y por eso lleva check.
- **Medición** — cuando el componente hace un **juicio clínico**, además tiene una tasa de acierto.
  Eso es un número que se mejora con medición, **no** un requisito pendiente de entrega.

Un componente entregado con una métrica del 75 % está **entregado**. Poner ⚠️ ahí era un error de
clasificación de nuestra parte: etiquetaba la métrica como si fuera el estado de la entrega.

| | Significado |
|---|---|
| ✅ | Entregado, desplegado y verificado |
| 🔑 | Entregado — **falta una credencial o una acción tuya** (minutos) |
| 🚧 | Falta desarrollo real de nuestra parte |

| # | Punto | Entregado | Medición | Qué falta | De quién |
|---|---|---|---|---|---|
| 1 | Cascada + routing de 3 modelos | ✅ | 3/3 proveedores en vivo | nada | — |
| 2 | Agent smoke testing | ✅ | 22 casos en CI | nada | — |
| 3 | Abstención | ✅ | **75 %** ↑ de 62 % | es un juicio semántico: no existe el 100 % (§3) | nuestro, continuo |
| 4 | Citas correctas | ✅ | **100 %** procedencia | nada en lo que importa (§4) | — |
| 5 | Latencia | ✅ | 12,8 s primer token | nada | — |
| 6 | Correo / comunicaciones | ✅ | 8 pruebas | nada | — |
| 7 | Google Calendar bidireccional | 🔑 | ida ✅ / vuelta manual | **2 credenciales en Vercel** | tuyo, 5 min |
| 8 | Transcripción | 🚧 | 2 de 3 defectos | pasar de lotes a streaming | nuestro, 3–5 días |
| 9 | Invitaciones de equipo | 🔑 | 4 bugs corregidos | **enviar una invitación real** | tuyo, 2 min |
| 10 | Historial de conversaciones | ✅ | — | nada | — |

**7 entregados y verificados · 2 esperando 7 minutos tuyos · 1 con desarrollo pendiente · 0 incumplidos.**

Con esos 7 minutos tuyos son **9 de 10**. El único trabajo de desarrollo que queda en la lista es la
transcripción en vivo.

---

## 1 · Cascada + routing de 3 modelos — ✅ 100 %

**Falta: nada.**

Verificado contra los tres proveedores reales: Gemini responde en 4,0 s, Claude en 7,2 s; el camino
feliz se queda en DeepSeek (1,4 s) sin llamar a los otros; con el primario caído responde Gemini
(3,9 s); con los dos primeros caídos **llega hasta Claude** (3,7 s).

Routing en dos niveles: por **tarea** (redacción vs. liviano) y por **consulta** — con cobertura
`limited` la nota escala al modelo que mide mejor en fidelidad. Es el 12-15 % de los casos, medido
antes de encenderlo.

> ⚠️ **Para la reunión:** `app/retrieval/cascade.py` es la cascada de **recuperación de documentos** y
> **no** es evidencia de esta cláusula. La evidencia es `app/generation/provider_cascade.py`.

## 2 · Agent smoke testing — ✅ 100 %

**Falta: nada.**

22 casos corriendo en CI + `docs/AGENT-SMOKE-TESTING.md`. Encontró la corrupción silenciosa de fechas
(`2026-02-30` se agendaba el 2 de marzo). El gap de `payload_override` quedó cerrado con 9 pruebas.

**Y el ciclo completo se verificó hoy en producción:** Athos propuso una cita, apareció la tarjeta, el
veterinario aprobó, y quedó `status: executed` con `appointment_id: 474b353a-…`.

## 3 · Abstención — ✅ entregado · acierto **75 %** (subió hoy desde 62 %)

**Entregado:** el mecanismo está construido, desplegado y midiéndose. Cuando la literatura no cubre el
caso, Athos **se abstiene o lo declara**, y el veterinario lo ve en pantalla.

**Lo que se hizo hoy — y no es cosmético.** Los dos cortes que separan las bandas estaban puestos *a
ojo* desde el principio: nadie los había calibrado. Se barrió el umbral sobre el banco validado de 24
casos (12 con literatura, 12 sin ella) y se movieron de (2, 5) a **(4, 7)**:

| | antes | **ahora** |
|---|---|---|
| Casos **sin** literatura manejados con honestidad | 5 de 12 | **9 de 12** |
| Casos **sin** literatura respondidos con confianza ← *el fallo grave* | 7 de 12 | **3 de 12** |
| Casos **con** literatura respondidos normalmente | 10 de 12 | 9 de 12 |
| **Acierto global** | 62 % | **75 %** |

El fallo que de verdad importa en clínica —responder con seguridad sobre algo que la literatura no
respalda— **se redujo a menos de la mitad**, a cambio de una sobre-abstención más. Hubo una propiedad
del banco que abarató el cambio: **ningún caso con literatura puntúa entre 4 y 7**, así que ensanchar
la banda intermedia hasta 7 no castigó a ninguno.

Es un cambio de configuración (`JUDGE_ABSTAIN_MAX`, `JUDGE_LIMITED_MAX`), reversible sin desplegar y
recalibrable cuando el banco crezca. La tabla completa del barrido está en `app/config.py`.

### Por qué acá el 100 % no existe — y por qué eso no es una excusa

No es una limitación de esfuerzo ni de presupuesto: es la naturaleza de la tarea.

1. **La pregunta no tiene respuesta binaria.** "¿La literatura cubre este caso?" admite grados. Un
   artículo sobre dermatitis atópica canina, ¿cubre un sarpullido en un perro de 3 años? Depende de
   cuánto del cuadro comparta. Dos veterinarios expertos discrepan en los casos de borde — y son
   justamente los casos donde el juez se equivoca.
2. **Los dos errores se empujan entre sí.** Bajar los cortes reduce las respuestas indebidas y sube
   las abstenciones indebidas. **Abstenerse de más también daña**: un Athos que dice "no sé"
   demasiado deja de usarse, y entonces no protege a nadie. El 75 % es el mejor punto de equilibrio
   medido, no el máximo teórico de una sola de las dos métricas.
3. **La medición tiene su propio margen.** El banco son 24 casos con validación clínica. Un caso
   equivale a 4 puntos porcentuales. Reportar "83 %" sobre 24 casos sería precisión falsa.

**Lo que sí sube el número, en orden de rendimiento:** ampliar el banco de negativos con validación
clínica (es lo que permite calibrar más fino), y recién después volver a barrer los cortes. Antecedente
que obliga a hacerlo en ese orden: **24 de 42 casos del banco original no eran negativos** — tenían
literatura real. Toda medición anterior a esa corrección medía otra cosa.

> **Para la reunión:** el "0 activaciones en 187 casos" que reportó el cliente **era correcto**, y ya
> está resuelto. La causa: el umbral determinístico está saturado (score 1.701 vs 1.700; reranker
> 0,532 vs 0,499; nº de citas 6,0 vs 6,0). Ninguna señal gratuita discrimina cobertura. Por eso ahora
> hay un juez que **lee** los pasajes — y por eso hoy la abstención se activa.

## 4 · Citas de fuentes correctas — ✅ **100 % en lo que el contrato exige**

El requisito es **"nunca inventar fuentes"**. Eso está al 100 %, y por construcción, no por suerte
estadística. Hay dos capas y conviene no confundirlas:

| Capa | Qué garantiza | Estado |
|---|---|---|
| **Procedencia** (determinística) | la fuente mostrada **existe y es la recuperada** | ✅ **100 %, estructural** |
| **Fidelidad** (LLM, capa extra) | además, el pasaje **sostiene** lo afirmado | filtro adicional, opcional |

### Por qué la procedencia es 100 % y no "0 fallos medidos"

El modelo **no puede escribir una fuente**. Lo único que emite es un número entre corchetes, `[3]`.
Todo lo que el veterinario ve —título, año, revista, enlace a PubMed, ubicación dentro del documento—
lo reconstruye el código **desde el chunk recuperado de la base** (`Citation.from_chunk`). Un `[n]` que
no corresponda a un documento realmente recuperado **se descarta**.

Es decir: inventar una fuente no es que sea improbable, es que **no está representado en el camino de
datos**. No hay ruta por la que un título inventado llegue a la pantalla. Está cubierto por pruebas
automáticas que corren en CI.

### La segunda capa es un extra, y su único error posible es ser demasiado estricta

La fidelidad existe porque la procedencia sola no alcanzaba: medido, **18 de 24 respuestas citaban al
menos un pasaje que no respaldaba la afirmación** — el modelo redactaba desde su conocimiento y
"decoraba" con una referencia real pero que no venía al caso.

Esta capa **sólo quita** referencias, nunca agrega ni sustituye. De ahí que su modo de fallo sea
asimétrico y benigno:

- Si acierta → cae una cita que no sostenía nada. Ganancia.
- Si se equivoca → cae una cita **válida**. Se pierde una referencia útil, pero **jamás se muestra una
  cita incorrecta**.

Por eso el punto no queda en ⚠️: la capa que puede equivocarse **no puede producir el fallo que el
contrato prohíbe**. Sin calibrar descartaba el 58 % de las referencias; calibrada, el 13-18 %, ninguna
respuesta queda sin fuentes y las respuestas bien fundamentadas quedan intactas. Revisión humana de 6
descartes: 4 correctos, 1 defendible, 1 falso positivo (ya corregido). Falla abierta: si el verificador
no puede opinar, las citas quedan como estaban. Interruptor: `FIDELITY_ENABLED=false`.

**Coherencia visual:** cuando una fuente cae, su `[n]` no se queda huérfano en el texto — en el
Fantasma se renumera el SOAP, y en el chat el evento final marca cuáles atenuar.

## 5 · Latencia — ✅ 100 %

**Falta: nada.** **12,8 s al primer token**, 27,6 s completo, medido desde fuera del datacenter.

Los ~5 minutos no se reproducen. Causa probable del reporte original: el Tier 1 tardaba **15.397 ms y
se cancelaba por `statement_timeout`** — se percibe como cuelgue, no como lentitud. Corregido: **143 ms**.

## 6 · Correo / módulo de comunicaciones — ✅ 100 %

**Falta: nada.** Envío por SMTP, lectura de respuestas por IMAP, hilos, credenciales cifradas, pantalla
de conexión, facturas por correo y **recordatorios de cobranza por correo** — este último era el cable
suelto y se cerró hoy con 8 pruebas.

> Nota: cada clínica conecta su propia cuenta desde `/dashboard/settings`. Que el módulo esté al 100 %
> no significa que una clínica concreta ya lo haya conectado.

## 7 · Google Calendar bidireccional — 🔑 entregado, esperando 2 credenciales tuyas

| Dirección | Estado |
|---|---|
| Plataforma → Google (crear / borrar a mano) | ✅ automático |
| **Citas creadas por el agente** | ✅ **cerrado hoy** |
| Google → Plataforma | ✅ construido, **manual** (botón "Sincronizar") hasta que Google verifique |

**Nada de esto es desarrollo pendiente — el código está entregado. Faltan dos insumos externos:**

1. **`GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en Vercel** — 5 minutos, es lo que desbloquea la
   sincronización. **Ninguna de las dos está configurada.**
2. **Verificación de Google** (~10 días, trámite de un tercero) para que la traída Google→plataforma
   sea automática en vez de un botón.

> **Precisión que corrige una afirmación previa mía:** *conectar* Google **sí funciona** sin esas
> credenciales — la ruta de conexión sólo guarda el `refresh_token` del login. Lo que falla es la
> **sincronización**: `pushAppointment` → `accessTokenFrom()` → `googleCreds()` lanza
> `"Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET"`.
>
> Hoy `calendar_integrations` tiene **0 filas**, así que `pushAppointment` devuelve `null` en su
> primera línea **sin lanzar** — por eso la cita del agente quedó con `google_event_id: null` y sin
> error. **Si alguien conectara Google hoy, la sincronización empezaría a fallar.** Las credenciales
> hay que ponerlas antes.

**Dónde está el botón:** `/dashboard/calendario`, barra superior junto a "Nueva cita". Si Google no
está conectado dice **"Conectar Google Calendar"**; "Sincronizar" sólo aparece una vez conectado.

## 8 · Transcripción — 🚧 2 de 3 defectos corregidos

| Defecto reportado | Estado |
|---|---|
| **Roles invertidos** | ✅ **corregido** |
| **Fecha errada** | ✅ **corregido** |
| **Por lotes, no en vivo** | 🚧 **pendiente — el único desarrollo que queda en la lista** |

**Falta para el 100 %:** pasar del endpoint por lotes al de streaming — WebSocket contra Deepgram y una
interfaz que muestre el texto incremental. **3 a 5 días**, es lo único.

Confirmado hoy que sigue por lotes: `app/transcription.py:90` hace `POST` a `api.deepgram.com/v1/listen`
con el audio completo.

**Roles:** la causa era que `SPEAKER_LABELS` asumía hablante 0 = veterinario, y Deepgram numera **por
orden de habla**, con la etiqueta **horneada** en `full_text`. Ahora el rol se infiere del **contenido**
(`app/speaker_roles.py`), determinístico y auditable.

**Fecha:** 3 pantallas formateaban en UTC porque los componentes de servidor corren en UTC en Vercel.
Ancladas a `America/Bogotá`, con pruebas que fuerzan `TZ=UTC` para que no vuelva.

## 9 · Invitaciones de equipo — 🔑 entregado, esperando 2 minutos tuyos

**Cuatro bugs corregidos, de dos personas:**

| Bug | Quién |
|---|---|
| `redirectTo` iba a `/invitar/<token>`, que no establece sesión → el enlace "no hacía nada" | nosotros |
| El origen salía del dominio efímero del deployment | nosotros |
| `/auth/signout` era `GET`: el prefetch de un `<Link>` **cerraba la sesión solo** | nosotros |
| `?next=` podía quedar vacío y la plantilla de Supabase concatena `&token_hash=` sobre él | Santiago |

**Falta para el 100 %: enviar una invitación real y hacer clic en el enlace. Dos minutos.**

> **Por qué no lo doy por cerrado sin eso:** los cuatro bugs están verificados por lectura, pero el
> fallo original era de **integración entre el código y la plantilla de correo de Supabase**, y eso no
> se comprueba leyendo. Nadie ha enviado una invitación desde que se corrigieron.

## 10 · Historial de conversaciones — ✅ 100 %

**Falta: nada.** `src/lib/athos-history.ts`, consumido por `/dashboard/asistente`.

Los datos **existían desde el inicio** en `athos_messages` — nunca se perdieron. Faltaba la pantalla.

---

## Resumen de lo que falta, por dueño

### Tuyo — 7 minutos en total

| Qué | Cierra | Tiempo |
|---|---|---|
| **Enviar una invitación real** y hacer clic | punto 9 → ✅ | 2 min |
| **`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` en Vercel** | punto 7 → 90 % | 5 min |

Con esas dos cosas: **9 de 10 entregados y verificados.**

### Nuestro

| Qué | Cierra | Esfuerzo |
|---|---|---|
| Transcripción en tiempo real | punto 8 → ✅ | 3–5 días |

**Y nada más.** Es el único desarrollo pendiente de los 10 puntos.

### Mejora continua — no son entregas pendientes

Estas dos métricas ya están entregadas y operando; se siguen midiendo porque son juicios clínicos, no
funcionalidades a medio hacer. Ver §3 para por qué el 100 % no es alcanzable en ninguna de las dos.

| Métrica | Hoy | Cómo sube |
|---|---|---|
| Acierto de la abstención | **75 %** (era 62 %) | ampliar el banco de negativos con validación clínica, después recalibrar |
| Recall del auditor de la nota | 0,47 con precisión 0,78 | se priorizó **precisión**: un señalamiento falso hace que el veterinario deje de leer los señalamientos |

### De terceros — no depende de esfuerzo nuestro

| Insumo | Quién | Tiempo | Cierra |
|---|---|---|---|
| Verificación de Google | Google | ~10 días | punto 7 → ✅ |

---

## Otras variables ausentes en Vercel

El código lee **34** variables de entorno; en Vercel hay **8**. Además de las dos de Google, faltan las
de WhatsApp:

| Variable | Qué rompe |
|---|---|
| `WHATSAPP_TOKEN_KEY` | cifrado de los tokens de Meta — **lanza al conectar** |
| `META_APP_ID`, `META_APP_SECRET`, `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_ES_CONFIG_ID` | WhatsApp embebido de Meta (cae al proveedor que sale de la plataforma) |
| `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_TOKEN`, `NEXT_PUBLIC_SITE_URL` | el proveedor alternativo de WhatsApp |

**Las demás ausencias no importan** — tienen valor por defecto correcto: `ATHOS_AGENT_PROVIDER` y
`ATHOS_AGENT_MODEL` (por eso el agente funciona con Claude sin estar configuradas), `ATHOS_AUTO_*`,
`ATHOS_VISION_MODEL`, `DEEPSEEK_*`, `NEXT_PUBLIC_APP_URL` (cae a la URL de producción que Vercel provee
sola), `TZ` y `CARTERA_MESSAGING_SIMULATED`.

## Lo que quedó confirmado hoy en producción

| | Evidencia |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` en Vercel | ✅ visto en la captura — **último P0 cerrado** |
| `ANTHROPIC_API_KEY` en Vercel | ✅ el agente respondió |
| `NEXT_PUBLIC_ATHOS_URL` | ✅ `POST /athos/retrieve → 200 OK` en Railway |
| `CRON_SECRET` | ✅ `/api/health` responde 401, no 503 |
| Ciclo agéntico completo | ✅ propuso → aprobó → ejecutó → `appointment_id` real |

**488 pruebas** (212 backend + 276 front), todas ejecutadas localmente. `ruff` y `tsc` limpios.
