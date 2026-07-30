# Estado del Milestone 2 — TUVET IA · corte 2026-07-30, 11:30

> Tercera pasada de auditoría sobre el checklist de `auditoriatuvetmilestone2.md` (46 ítems, 7
> secciones). Verificado contra el código en `master` (`4ae1b3e`), el backend desplegado en Railway, el
> despliegue de Vercel y la base de producción. Aplica la regla del Otrosí num. 2.3: **sólo cuenta lo
> integrado y operando en el entorno accesible al cliente.**
>
> Línea base: `AUDITORIA-MILESTONE2-2026-07-29.md` (~50 % global). **37 commits** entraron desde
> entonces, de dos personas trabajando en paralelo.

## Resumen ejecutivo

| § | Sección | 29-jul | 30-jul 00:15 | **30-jul 07:00** |
|---|---|---|---|---|
| 2 | Chatbot + LLM Harness | 60 % | 85 % | **97 %** |
| 3 | Corpus veterinario | 85 % | 85 % | **85 %** |
| 7 | Estándar global (Cláusula 13) | 55 % | 80 % | **85 %** |
| 5 | Capa agéntica | 70 % | 75 % | **75 %** |
| 6 | Formalidades de entrega | 30 % | 75 % | **75 %** |
| 4 | Componentes presentados | 25 % | 50 % | **75 %** ▲20 |
| 1 | Integración IA | 45 % | 45 % | **90 %** ▲45 |
| | **Global** | **~50 %** | ~70 % | **~87 %** |

## Qué cambió en esta pasada (00:15 → 07:00)

Dos commits, los dos de calidad clínica de Athos, más una verificación de configuración:

1. **La nota del Fantasma se repara sola.** Medición **determinística**, sin juez: los términos
   clínicos que la nota nombra y la consulta no contiene bajaron de **32 a 2** sobre 40 notas, y las
   notas afectadas de 22/40 a 2/40. El texto creció 15 %, así que reformuló en vez de borrar.
2. **El chat y la nota marcan lo ejecutable sin respaldo.** Un fármaco o una cifra afirmados sin cita
   y sin declararse criterio clínico: 30 casos en 34 respuestas del chat, 14 en 12 de 40 notas. No se
   censura — se marca para que el veterinario vea la procedencia.
3. **`CRON_SECRET` está configurada en Vercel** (verificado: `/api/health` responde 401 y no 503).
   Eso cierra el P0 más urgente: **la retención de audio de 4 días de la Ley 1581 volvió a correr.**

Sube §2 (el harness cierra el último hueco sin auditar), sube §7 (la retención legal opera) y sube §4
(la purga de audio deja de estar bloqueada).

**Lo que se movió desde el 29-jul:** las formalidades (inventario + documentación + smoke testing
documentado), el harness de calidad (que pasó de un banco a once y encontró defectos reales), el CI
—que estaba inerte y ahora corre **456 pruebas**— y el correo electrónico, que era un stub vacío y hoy
envía por SMTP y lee respuestas por IMAP.

**La §1 dejó de ser el agujero.** El cliente entregó la credencial de Google el 30-jul y con eso se
cerraron los dos incumplimientos literales que quedaban: **Gemini está integrado y operando en
producción**, y **la cascada entre proveedores existe, está configurada y verificada contra los
proveedores reales**. Lo único que sigue dependiendo de un insumo externo es Claude: su cuenta **no
tiene crédito**, así que no puede entrar a la cadena.

---

## 1. Integración IA — ⚠️ 75 % (▲ 30 el 30-jul)

**[1.1] ✅ CUMPLE — Gemini** *(era ❌ NO EXISTE; cerrado el 30-jul)*
Evidencia: `app/generation/llm_client.py` (proveedor `google`), `GEMINI_API_KEY` y `GEMINI_MODEL`
**configuradas en Railway production**, y verificación contra el proveedor real: responde en 4,0 s.
Se integró por el endpoint **compatible con OpenAI** de Gemini, así que reusa el cuerpo HTTP que ya
existía: **cero dependencias nuevas**.
> Un detalle que habría roto una demostración: el cliente enviaba `thinking: {"type":"disabled"}`
> fijo en cada petición. Es un parámetro de DeepSeek y **Gemini lo rechaza con HTTP 400**
> (`Unknown name "thinking"`). Apuntar el cliente existente a Gemini habría fallado el **100 %** de
> las llamadas. Ahora los parámetros son por proveedor, con una prueba que fija que el cuerpo
> enviado al primario **no cambió**.

**[1.2] ✅ CUMPLE — DeepSeek**
Evidencia: `athos-service/app/generation/llm_client.py` (cliente OpenAI-compatible),
`app/config.py:20` (`llm_base_url`). Modelos en producción: `deepseek-v4-flash` (redacción) y
`deepseek-v4-pro` (juez). Es el motor de todo el backend: chat, Fantasma, juez de evidencia, A→B.

**[1.3] ✅ CUMPLE — Claude (Anthropic)** *(era ⚠️ PARCIAL; cerrado el 30-jul)*
Evidencia: `@ai-sdk/anthropic` en el front (agente de 17 tools, WhatsApp, visión de facturas) y
**`ANTHROPIC_API_KEY` ahora configurada en Railway**, con Claude operando como tercer eslabón de la
cascada del backend.
**Crédito verificado con una llamada real**, no por inspección: `stop_reason=end_turn`, 61 tokens de
salida, `service_tier: standard`. No es una key de prueba.
> Defecto corregido en el camino: `LLMClient` usaba `LLM_API_KEY` para todos los proveedores salvo
> Google, así que la rama de Anthropic se habría autenticado con la credencial de DeepSeek y habría
> fallado **en el 100 % de los casos, y en silencio** — el fallo de una alternativa sólo se manifiesta
> cuando el primario ya cayó. Anthropic tiene ahora su key propia.

**[1.4] ✅ CUMPLE — Lógica de cascada entre modelos** *(era ❌ NO EXISTE; cerrado el 30-jul)*
Evidencia: `app/generation/provider_cascade.py`, configurada en Railway production
(`LLM_CASCADE_REDACCION=deepseek-v4-flash@openai,gemini-3.6-flash@google`). Ante error, timeout,
límite de tasa o saldo agotado del primario, reintenta con el siguiente proveedor. **12 pruebas
automatizadas** y verificación contra los proveedores reales:

| Escenario | Resultado |
|---|---|
| Gemini directo | responde, 4,0 s |
| Claude directo | responde, 7,2 s |
| Camino feliz con los TRES configurados | DeepSeek en 1,4 s y **ni Gemini ni Claude se llaman** |
| Primario caído | Gemini toma el relevo, 3,9 s |
| **Caen los dos primeros** | **la cascada llega hasta Claude, 3,7 s** |
| Streaming con primario caído | el chat sigue respondiendo |
| Sin configurar | usa el proveedor de siempre |

Dos decisiones de diseño que conviene poder explicar:
- **En streaming la alternativa sólo entra ANTES del primer token.** Si el proveedor se cae a mitad,
  se corta como se cortaba antes: coser dos modelos daría media recomendación de uno y media de
  otro, sin coherencia clínica. Es el peor resultado posible y se evita a propósito.
- **El orden no es arbitrario:** DeepSeek primero porque es el modelo validado contra el golden
  set, el más barato y —medido— el mejor de los tres en utilidad. Ver la comparativa del ítem 2.5.

> ⚠️ **Ojo con la homonimia, y sigue siendo importante para la reunión:** la "cascada de retrieval"
> (`app/retrieval/cascade.py`) es un pipeline de recuperación de documentos y **no es esto**. La
> evidencia de cumplimiento de 1.4 es `provider_cascade.py`, no aquélla.

**[1.5] ⚠️ PARCIAL — Routing de modelos** *(era ❌ NO EXISTE)*
Evidencia: `provider_cascade.py` rutea **por tipo de tarea** con cadenas independientes y
configurables — `LLM_CASCADE_REDACCION` (chat y nota: calidad primero) y `LLM_CASCADE_LIVIANO`
(A→B, juez, auditores: costo y volumen primero), hoy con modelos distintos en producción.
Gap, dicho sin adornos: eso es **routing por tarea, y estático**. La cláusula pide asignar **cada
consulta** según costo, velocidad y precisión, y para eso hace falta primero la comparativa entre
modelos del ítem 2.5 — sin datos de calidad por modelo, cualquier regla de asignación sería
inventada.
Esfuerzo: 2 días **después** de 2.5.

**[1.6] ✅ CUMPLE — System prompts definidos y versionados**
Evidencia: 7 prompts en el repositorio, versionados en git y con su justificación de diseño en el
código: `generate.py` (`CLINICAL_SYSTEM_PROMPT`), `chat.py` (`CHAT_SYSTEM`), `evidence_judge.py`,
`citation_fidelity.py`, `transcript_fidelity.py`, `condition_alerts.py`, `query_builder.py`, y
`src/lib/athos-agent/system-prompt.ts` en el front.

**[1.7] ⚠️ PARCIAL — Estructura de skills**
Evidencia: el front sí tiene módulos discretos — **17 tools** con `inputSchema` propio en
`src/lib/athos-agent/tools.ts`. El backend tiene módulos por función (retrieval, juez, auditores,
gates) pero no una abstracción llamada "skills".
Gap: es discutible si el contrato exige la palabra o la arquitectura. **Se cumple en sustancia.**

**[1.8] ⚠️ PARCIAL — "API routing setup" y "Agent connections"**
Agent connections: ✅ operando (17 tools, ciclo de aprobación, `athos_actions`). API routing: ❌ (ver
1.5).

**[1.9] ✅ CUMPLE — Deepgram**
Evidencia: `app/config.py:74`, `deepgram_api_key`, modelo `nova-2`. Operando. (Salvedad en 4.6.)

**[1.10] ⚠️ PARCIAL — Variables de producción de las 3 APIs**
Verificado hoy leyendo las **31 variables reales** de Railway production: DeepSeek ✅
(`LLM_API_KEY`, `LLM_MODEL=deepseek-v4-flash`), Gemini ✅ (`GEMINI_API_KEY`,
`GEMINI_MODEL=gemini-3.6-flash`). **`ANTHROPIC_API_KEY` no está en Railway** — se confirma por
lectura directa, no por inferencia. Y aun poniéndola, **la cuenta no tiene crédito**: una
credencial sin saldo no hace que Claude opere.

---

## 2. Chatbot sin alucinaciones + LLM Harness — ✅ 92 %

**[2.1] ✅ CUMPLE — LLM Harness**
Evidencia: `athos-service/scripts/calidad/` — **34 scripts, 11 bancos ejecutables**, con su README de 
metodología: `respuestas_eval.py` (calidad de respuesta), `respuestas_ab.py` (A/B pareado),
`phantom_eval.py` y `phantom_ab.py` (calidad de la nota clínica), `juez_calibrar.py`,
`fidelidad_calibrar.py`, `negativos_validar.py`, `recall_ciego.py`, `latencia_e2e.py`,
`prompts_variantes.py`, `generadores_nota.py`. Golden set de **153 casos**.
El harness **no es decorativo: encontró defectos reales** — 24 de 42 negativos del banco eran falsos,
18 de 24 respuestas citaban un pasaje que no las sostenía, la nota del Fantasma se guardaba vacía en 1
de 16 casos, y un `chunk_id` crudo quedaba visible en el subjetivo de la historia clínica.

**Ampliado el 30-jul con lo que faltaba: la verificación de lo que NO se cita.** `citation_fidelity`
audita las frases con cita y por diseño ignora las que no la tienen; quedaba en el medio un fármaco o
una cifra afirmados sin cita y sin declararse criterio clínico —el veterinario no puede distinguir «esto
lo dice la literatura» de «esto lo cree el modelo»—. Ahora se detecta determinísticamente
(`app/generation/undeclared.py`) y viaja como metadato en el chat (`undeclared_claims`) y en la nota
(`unsupported_claims`, sección A/P). Medido: **30 casos en 34 respuestas del chat, 14 en 12 de 40
notas.** No se censura: que Athos diga que la doxiciclina es de elección para ehrlichiosis es correcto
y útil; lo que hacía falta es que se vea la procedencia.

**Y la nota del Fantasma se repara sola.** Detección determinística con el glosario (2.506 términos,
7.378 sinónimos, con el lenguaje coloquial del dueño curado) de los signos clínicos que la nota nombra
y la consulta no contiene, más una reescritura con las palabras de la consulta. **Medido sin juez:
términos sin respaldo de 32 a 2 sobre 40 notas; notas afectadas de 22/40 a 2/40; el texto creció 15 %,
así que reformuló en vez de borrar.**

> **Nota de método que conviene leer antes de discutir cualquier cifra de calidad.** El juez que puntúa
> en abstracto dio, sobre el **mismo** prompt y el **mismo** banco, `firmaría` = 8/16, 9/16, 17/40,
> 20/40, 24/40 y 27/40 — ruido de ±7 sobre 40. Y el juez pareado por comparación directa resultó peor:
> prefiere la nota que ve **segunda** en el 78 % de los casos contra el 10 % cuando la ve primera. Por
> eso las cifras de este documento distinguen entre lo **contable** (cuántas dosis sobreviven, cuántos
> términos no aparecen en la consulta) y lo **juzgado**, que va siempre con su margen declarado.

**[2.2] ✅ CUMPLE — Mecanismo de abstención**
Evidencia: `app/generation/evidence_judge.py`. Bandas `none`/`limited`/`sufficient`; el chat responde
con plantilla y sin LLM cuando la banda es `none`.
**Sobre el "0 activaciones en 187 casos" que reportó el cliente: la observación era correcta y la causa
está identificada.** El umbral determinístico daba `passed=True` en 187/187 porque el score está
saturado — ninguna señal gratuita discrimina cobertura (score 1.701 vs 1.700; reranker 0,532 vs 0,499;
nº de citas 6,0 vs 6,0). Por eso se agregó un juez semántico que **lee** los pasajes. Medido contra un
banco validado: acierta **11 de 18** con sólo **1 de 16** de sobre-abstención.
Gap: el 61 % de acierto es mejorable, no perfecto.

**[2.3] ✅ CUMPLE — Citas correctas**
Evidencia: dos capas distintas. Procedencia determinística (`citations.py`: un `[n]` que no está en la
literatura recuperada se descarta) y **fidelidad** (`citation_fidelity.py`: ¿el pasaje sostiene lo
afirmado?). La segunda existe porque la primera no alcanzaba — medido, **18 de 24 respuestas citaban
al menos un pasaje que no respaldaba la afirmación**. Calibrado: descarta el 18 % de las referencias
(era 58 % sin calibrar), ninguna respuesta queda sin fuentes. Revisión humana de 6 descartes: 4
correctos, 1 defendible, 1 falso positivo ya corregido.
Coherencia texto↔referencias cerrada: en el Fantasma se renumera el SOAP, en el chat el evento `done`
manda `unverified_sources` y lo persistido va sin esos marcadores.

**[2.4] ✅ CUMPLE — Agent smoke testing documentado**
Evidencia: `src/lib/athos-agent/__tests__/agent-smoke.test.ts` (**22 casos**) + el documento formal
**`docs/AGENT-SMOKE-TESTING.md`**. Corre en CI en cada push.
Cubre: aprobación humana (7 casos), inventario y separación lectura/escritura (3), zona horaria (2) y
fechas imposibles (10). Encontró **corrupción silenciosa de fechas**: `2026-02-30` no es inválida para
JavaScript, la rueda a `2026-03-02` — la cita se agendaba otro día sin avisar.
Gap declarado en el documento: la lógica **autenticada** del ciclo aprobar→ejecutar está verificada por
inspección, no por test (el borde de autenticación sí está cubierto por la suite e2e).

**[2.5] ✅ CUMPLE — Pruebas comparativas de calidad entre modelos** *(era ❌; cerrado el 30-jul)*
Evidencia: se compararon **modelos de juez** (`juez_calibrar.py`: el liviano gana al grande, que suma
1 caso pero duplica la sobre-abstención) y **variantes de prompt** a 40 casos pareados. **No** existe
**la comparativa de los tres modelos, con su informe: `docs/COMPARATIVA-MODELOS-2026-07-30.md`.**
Pareada — el retrieval corre una vez por caso y los modelos redactan sobre la misma literatura con
el mismo prompt, así que la diferencia es del modelo.

| | Resultado |
|---|---|
| **DeepSeek vs Gemini** (28 casos, juez neutral) | **DeepSeek gana 24-2**; utilidad 8,5 vs 3,7 |
| **DeepSeek vs Claude** (juez = Claude) | Claude 21-2 |
| **DeepSeek vs Claude** (juez = DeepSeek-pro) | Claude 16-14 |

> **El hallazgo de método, que vale más que el ranking:** el titular se mueve **19 casos** según
> quién juzga. Es sesgo de autopreferencia, y por eso el informe no declara ganador con una sola
> corrida. Lo que sobrevive a los dos jueces —y por tanto es defendible— es que **Claude es
> moderadamente mejor en fidelidad y seguridad**, y que **DeepSeek empata o gana en utilidad**.

Consecuencia para la decisión de costos: la elección de DeepSeek **se sostiene y ahora está
respaldada con datos**. Contra Gemini es netamente superior; contra Claude pierde algo de fidelidad
y seguridad, pero es una diferencia de grado y Claude cuesta un orden de magnitud más.

**[2.6] ✅ CUMPLE — Latencia**
Evidencia: `scripts/calidad/latencia_e2e.py`, medido con el pipeline real desde fuera del datacenter
(pesimista): **12,8 s al primer token, 27,6 s completo** (mediana).
**Las latencias de ~5 minutos no se reproducen.** Causa probable del reporte: el Tier 1 tardaba
15.397 ms de servidor y **se cancelaba por `statement_timeout`** — se percibe como cuelgue, no como
lentitud. Corregido el 28-jul a **143 ms** separando las dos ramas de la query.

**[2.7] ⚠️ PARCIAL — Tasa de "sin información suficiente"**
Hoy es medible y trazable (`rag_answer_log`, banda del juez), pero **la cifra del 0,03 % afirmada el
23-jul no es defendible**: se calculó con el umbral saturado. La tasa real depende del juez semántico
y hay que medirla sobre tráfico real, no sobre el golden set.

**[2.8] ✅ CUMPLE — Revisión de calidad interna de Plogy**
Evidencia: este documento, `AUDITORIA-MILESTONE2-2026-07-29.md`, `scripts/calidad/README.md` y los 37
commits de las últimas 30 horas con su justificación de diseño.

---

## 3. Base de conocimiento veterinaria — ✅ 85 % (sin cambios)

**[3.1] ✅ CUMPLE** — **61.544 documentos / ~520.000 chunks** en el proyecto principal, con embeddings
Cohere embed-v4 (1024 dim) e índices construidos. Gate de verificación 11/11.

**[3.2] ⚠️ PARCIAL** — Las pruebas sobre el corpus completo están hechas y hay medición contra
producción, pero **falta el documento de resultados del corpus** como entregable formal.
Esfuerzo: 0,5 día.

**[3.3] ⚠️ PENDIENTE (no técnico)** — Documentar si hubo deficiencias de formato en el contenido del
cliente y si se comunicaron dentro de los 5 días hábiles de la Cláusula 13. **Es una revisión de
correspondencia, no de código.**

---

## 4. Componentes presentados pero no operando — ⚠️ 75 %

**[4.1] ⚠️ PARCIAL — Google Calendar bidireccional**
Evidencia: `pullEvents()` existe (`src/lib/google-calendar.ts:164`) y se dispara desde
`/api/google/calendar/sync`, **con botón manual**. No hay webhook ni sincronización automática, y las
citas que crea el agente no se empujan a Google.
Gap: la bidireccionalidad automática. Esfuerzo: 3–4 días. **Bloqueador: verificación de Google (~10
días) para abrirlo al público.**

**[4.2] ⚠️ PARCIAL — WhatsApp embebido**
Evidencia: `src/components/settings/whatsapp-settings.tsx` implementa **Embedded Signup de Meta en un
popup dentro de tuvetia, sin redirects** — el compromiso del 23-jul está cumplido a nivel de código.
Gap: requiere `NEXT_PUBLIC_META_APP_ID` + `NEXT_PUBLIC_META_ES_CONFIG_ID` y **el App Review de Meta**.
Sin eso cae al fallback Kapso, que sí navega fuera. **Bloqueador externo: 2–6 semanas de Meta.**

**[4.3] ⚠️ PARCIAL — Correo electrónico (era ❌, cambio grande del 29-jul noche)**
Evidencia: `src/lib/email/` — **envío real por SMTP** (`smtp.ts`, nodemailer), **lectura de respuestas
por IMAP** (`imap.ts`, `sync.ts`), threading (`threading.ts` + 142 líneas de test), credenciales
cifradas (`crypto.ts`), **UI de conexión** (`src/components/settings/email-settings.tsx`) y migración
`0039_email_integrations.sql`. El stub que devolvía `email_no_configurado` dejó de existir en el
camino de facturación. Barrido cada 15 min por GitHub Actions (`cartera-sweep.yml`), porque el plan
Hobby de Vercel sólo permite crons diarios.
> 🟠 **Gap concreto que hay que cerrar:** el **canal de salida de cartera sigue sin cablear al correo**.
> `src/lib/cartera/channels.ts:37-47` mantiene `EMAIL nunca figura conectado` y `send()` devuelve
> `fail('email_no_configurado')`. Es decir: las **facturas** salen por correo y las **respuestas**
> entran por IMAP, pero los **recordatorios de cobranza** siguen siendo sólo WhatsApp. El commit dice
> "la cobranza por correo cierra el ciclo" y el ciclo de salida quedó abierto.
> Esfuerzo: **2–4 horas** (adaptar `RealMessaging` al módulo nuevo). **Sigue abierto al 30-jul 07:00.**

**[4.4] ✅ CUMPLE — Invitaciones de equipo**
Evidencia: `166c6a6`. Tres bugs de código corregidos: `redirectTo` apuntaba a la raíz en vez de
`/auth/callback`, se agregó `getAppBaseUrl()`, y `/auth/signout` pasó a **POST** (con GET, el prefetch
de un `<Link>` de Next cerraba la sesión sola).

**[4.5] ✅ CUMPLE — Historial de conversaciones**
Evidencia: `dc1c1a0`, `src/lib/athos-history.ts`. **Los datos existían desde el inicio; faltaba la
pantalla.** El server precarga los hilos y siembra `useChat`.

**[4.6] ⚠️ PARCIAL — Transcripción**
- Roles ✅ **corregido** (`05d1bd0`, `app/speaker_roles.py`): se infieren del **contenido** con
  patrones ponderados y margen mínimo, no de quién habló primero. El bug: `SPEAKER_LABELS` asumía
  hablante 0 = veterinario y Deepgram numera por orden de habla, con la etiqueta **horneada** en
  `full_text`.
- Fecha/timestamp ✅ **corregido** (`22f2cf1`): 3 pantallas ancladas a `America/Bogota`.
- **Tiempo real ❌ sigue en lotes** (`config.py:74`, ADR-0016: "batch + diarización").
  Esfuerzo: 3–5 días (Deepgram streaming vía WebSocket + UI incremental).

**[4.7 / 4.8 / 4.9] ✅ CONSTRUIDAS — UI de facturación, cartera e inventario** *(eran ❌; entraron
el 30-jul, `c4f8328`)*
Evidencia verificada hoy sobre el código integrado: **16 rutas** bajo `/dashboard/facturacion`
—facturas y su detalle, impresión, cartera, catálogo, inventario, movimientos, importación, compras,
proveedores, finanzas y configuración—, 53 archivos y 8.505 líneas.
Lo que se comprobó, porque "existe una ruta" no es lo que pide el Otrosí 2.3:
- **No son cascarones:** cada página consulta datos reales (entre 2 y 11 consultas por página; la de
  inventario tiene 324 líneas, la de facturas 375).
- **Son alcanzables:** `facturacion` figura en la navegación lateral (`app-sidebar.tsx`).
- **Tienen control de acceso propio por clínica:** `src/lib/facturacion/page-auth.ts` resuelve
  `{supabase, clinicId}` y todas las consultas del módulo reciben `clinicId` explícito.
- **Compilan:** `npx tsc --noEmit` limpio sobre un `.next` regenerado.
> El hallazgo anterior —*"lo único testeado a fondo del front es lo único que el usuario no puede
> usar"*— **queda cerrado**: esos 257 casos de prueba ahora respaldan una interfaz que existe.

**Lo que sigue bloqueado, y conviene no confundirlo con la interfaz:** la **validez fiscal**. El
proveedor de facturación electrónica sigue siendo un **sandbox** (`fiscal/sandbox.ts`) y sin
habilitación DIAN no hay emisión con valor legal. La UI está; la habilitación es de un tercero.
**Falta además verificar el módulo en caliente contra datos reales de una clínica**, que es lo único
que convierte "construido" en "operando" sin reservas.

**[4.10] ✅ DOCUMENTADO — Historial de migraciones**
La observación del cliente **se confirma**: las migraciones de facturación/cartera/inventario
(`0033`–`0036`) entraron el **29-jul a las 10:19**, cuando la entrega era el 28 (último commit del 28:
`06accc6`, 20:13). Próxima migración disponible: **`0040`**.

---

## 5. Capa agéntica — ⚠️ 75 % (▲ 5)

**[5.1] ✅ CUMPLE — Acciones documentadas**
Evidencia: `docs/ARQUITECTURA.md` (ciclo con diagrama), `docs/AGENT-SMOKE-TESTING.md`, `docs/API.md`.
El chatbot **sí ejecuta acciones** sobre la plataforma: **17 tools**, 10 de lectura y 7 de escritura.
La observación del cliente ("el sistema actual no ejecuta acciones") **quedó superada** por el trabajo
del 29-jul.
Diseño: "Athos propone, el veterinario aprueba". Las 7 tools de escritura insertan en `athos_actions`
con `status='proposed'` y `risk='approval'`; la ejecución corre **bajo la sesión del vet que aprueba**,
así que la RLS ve su `auth.uid()` real, sin impersonación. Con reserva atómica contra el doble clic.

**[5.2] ✅ CUMPLE — Inventario de capacidades**
Evidencia: `INVENTARIO-COMPONENTES.md` **v1.1** — 93 componentes: **64 operando**, 18 parciales, 4 sin
interfaz, 6 bloqueados por un insumo externo y 1 no construido (Gemini). La regla de conteo está
declarada en el documento: la v1.0 mezclaba componentes con capacidades contractuales y su total no
era reproducible contándolo.
Gap residual: 🟠 **`payload_override` no se revalida** contra el `inputSchema` de la tool al aprobar
(`{...action.payload, ...body.payload_override}`). Que el vet edite antes de aprobar es la intención;
que lo editado no tenga que ser válido, no. Radio acotado (corre bajo su sesión con RLS). **Asignado a
Pipe.** Esfuerzo: 2–3 h.

---

## 6. Formalidades de entrega — ✅ 75 % (▲ 45)

**[6.1] ✅ CUMPLE** — `INVENTARIO-COMPONENTES.md` (`96674e5`), exigido por el num. 2.1 del Otrosí.
**[6.2] ✅ CUMPLE** — Repositorio (28-jul), Supabase (29-jul), Railway (29-jul). Verificado hoy: el
backend responde en `https://athos-service-production.up.railway.app/health`.
**[6.3] ⚠️ PARCIAL** — `docs/ARQUITECTURA.md`, `docs/API.md` (22 rutas), `.env.example` (30 variables,
cada bloque dice qué se rompe si falta), `README.md` reescrito, `docs/AGENT-SMOKE-TESTING.md`.
Gap: **falta el manual de usuario.** Deliberadamente diferido hasta el rediseño de la ficha del
paciente, para no documentar pantallas que van a cambiar. Esfuerzo: 2–3 días.

---

## 7. Estándar global (Cláusula 13) — ⚠️ 85 %

**[7.1] ✅ CUMPLE — Técnicamente funcional**
Evidencia: **456 casos de test** (199 backend + 257 front), `ruff` limpio, y **el CI corre**
(`.github/workflows/ci.yml` en la raíz) con `typecheck + lint + vitest + build` en el front y
`ruff + pytest` en el backend. Más una suite **e2e contra producción cada 6 horas**
(`.github/workflows/smoke.yml`).
> **El hallazgo más importante de la auditoría anterior está cerrado.** El workflow vivía en
> `athos-service/.github/` y GitHub sólo lee `.github/workflows/` de la raíz: **los 326 tests no
> corrían nunca.** Y encenderlo encontró de inmediato una bomba: **`psycopg-pool` no estaba declarada
> como dependencia** aunque `app/db.py` la importa desde el 24-jul. Cualquier instalación limpia
> fallaba; producción sobrevivía por caché de imagen, así que **el siguiente build desde cero de
> Railway se habría caído**. Llevaba 5 días invisible precisamente porque no había CI.

**[7.2] ⚠️ PARCIAL — Integrada**
Mejoró con el correo (4.3), pero quedan: 3 módulos con esquema y sin interfaz (4.7–4.9), el canal de
salida de cartera sin cablear al correo, Calendar manual, y WhatsApp dependiendo de Meta.

**[7.3] ✅ CUMPLE — Documentada** (salvo el manual de usuario).

**[7.4] ⚠️ EN RIESGO — Apta para validación con usuarios reales**
El núcleo clínico —pacientes, consultas, transcripción, Athos, nota del Fantasma, agenda, WhatsApp,
correo— está operando y se puede poner frente a un design partner **hoy**.
Dos salvedades honestas: (a) el veterinario no puede facturar desde la plataforma; (b) el juez de
calidad sigue detectando un hallazgo afirmado sin respaldo en S u O en **~15 de 40 notas**, y ese
número es en parte real y en parte del propio juez — no se pudo separar mejor porque el instrumento
tiene ±7 de ruido sobre 40.

Lo que sí mejoró de forma verificable el 30-jul: **los términos clínicos que la nota nombra y la
consulta no contiene bajaron de 32 a 2** (métrica contable, sin juez), y los puntos dudosos que quedan
le llegan al veterinario **señalados** antes de firmar. La nota sigue siendo un borrador que él aprueba,
y eso hay que decírselo explícitamente en la inducción del design partner.

---

## Calidad clínica: qué es verificable y qué es opinión

La nota SOAP del Modo Fantasma es el artefacto de mayor riesgo del sistema: el veterinario la firma y
entra al expediente. Se midió por primera vez esta semana, contra producción.

### Contable — cualquiera puede reproducirlo

| | Resultado |
|---|---|
| **Términos clínicos que la nota nombra y la consulta NO contiene** | **32 → 2** (−94 %) |
| Notas afectadas por lo anterior | 22/40 → **2/40** |
| Extensión de S+O tras la reparación | **+15 %** (reformuló, no borró) |
| Gate de dosis: borradores con una cifra por kilo | 8 de 40 |
| **Gate de dosis: cifras que llegan a la nota final** | **0 de 40** ✅ |
| Notas vacías por fallo de generación | **0 de 40** (era 1 de 16) |
| Fármacos y cifras sin cita ni declaración, ya señalados | 14 en 12 de 40 notas |

### Juzgado — va con su margen, porque el instrumento tiene ruido

| | Resultado |
|---|---|
| Notas donde el juez ve un hallazgo sin respaldo en S u O | ~15 de 40 |
| Auditor de la nota: precisión / recall | 0,78 / 0,47 |
| Fidelidad al transcript (media 0-10) | 8,2 – 8,7 según corrida |

> **Por qué se separan las dos tablas, y es la lección más costosa de la semana.** El juez que puntúa
> en abstracto dio, sobre el **mismo** prompt y el **mismo** banco, `firmaría` = 8/16, 9/16, 17/40,
> 20/40, 24/40 y 27/40 — un ruido de ±7 sobre 40 que hace indetectable cualquier mejora menor a ~20
> puntos porcentuales. Se intentó el arreglo estándar (juez pareado por comparación directa) y resultó
> peor: **prefiere la nota que ve segunda en el 78 % de los casos, contra el 10 % cuando la ve
> primera.** Se detectó sólo porque el script alterna el orden y reporta los dos grupos por separado.
>
> **La salida no fue un juez mejor: fue dejar de preguntarle.** La propiedad que importa es verificable
> sin opinión —«este término no aparece en la consulta ni en ninguno de sus sinónimos conocidos»— y eso
> se cuenta. Cinco variantes que el juez no pudo distinguir de una moneda quedaron resueltas de
> inmediato con la métrica contable.

**Cuatro intentos previos fallaron y quedan en el repositorio con sus números**, para que nadie los
repita: dos variantes de prompt que definen explícitamente qué va en S/O/A/P (fidelidad +0,0 a 40
casos) y una variante estructural que genera S y O sin literatura a la vista (fidelidad −1,0, firmaría
20→12). El quinto —la reparación determinística— es el que funcionó.

**Lo que sigue abierto:** el auditor de la nota se le escapa la mitad de los casos, y el juez de
evidencia acierta en 61 % de los casos sin cobertura. Ninguno de los dos es un punto de falla (los dos
fallan abiertos), pero ninguno es perfecto y no conviene presentarlos como tal.

## Gaps priorizados

### P0 — bloqueadores de configuración (minutos)

| # | Ítem | Estado |
|---|---|---|
| 1 | `CRON_SECRET` en Vercel Production | ✅ **RESUELTO** — verificado hoy: `/api/health` responde 401 (existe) y no 503 (faltaría) |
| 2 | `SUPABASE_SERVICE_ROLE_KEY` en Vercel Production | ❓ **NO VERIFICABLE desde afuera.** Sin ella `admin.ts` lanza y **las 7 tools de escritura + el ciclo de aprobación fallan en caliente** |
| 3 | Template Magic Link + Site URL en Supabase Auth | ❓ sin verificar |
| 4 | Retención de audio de la Ley 1581 | ✅ **VUELVE A CORRER** — es la consecuencia de #1 |

> **Para cerrar el #2 en 30 segundos y sin exponer nada:** que Pipe ejecute
> `curl -H "Authorization: Bearer $CRON_SECRET" https://tuvetia.vercel.app/api/health` y pegue la
> respuesta. **Sólo devuelve booleanos** — ni valores, ni prefijos, ni longitudes.

### P1 — subsanable antes del 17-ago (horas o pocos días)

| # | Ítem | Esfuerzo |
|---|---|---|
| 1 | Cablear el **canal de salida de cartera** al correo (`RealMessaging`) | 2–4 h |
| 2 | Revalidar `payload_override` contra el `inputSchema` (asignado a Pipe) | 2–3 h |
| 3 | Documento de resultados del corpus (§3.2) | 0,5 día |
| 4 | Tests del ciclo autenticado aprobar→ejecutar (§2.4 gap declarado) | 0,5 día |
| 5 | ~~Rehacer la rúbrica de S/O y atacar la invención~~ → ✅ **hecho el 30-jul**: rúbrica separada, reparación determinística (32→2 términos) y auditoría de lo no citado | — |
| 6 | Transcripción en **tiempo real** (§4.6) | 3–5 días |
| 7 | Manual de usuario (§6.3) | 2–3 días |
| 8 | Calendar bidireccional automático (§4.1) | 3–4 días + verificación Google |

### P2 — requiere renegociación de alcance o cronograma

| Ítem | Por qué no cabe |
|---|---|
| **Gemini + cascada + routing + comparativas** (§1.1, 1.4, 1.5, 2.5) | 10–15 días **y** cuenta Google con crédito + crédito de producción de Anthropic. Es la mayor concentración de incumplimiento y **no depende sólo de esfuerzo** |
| **UI de facturación/cartera/inventario** (§4.7–4.9) | **5–7 semanas.** Sin habilitación DIAN no habría emisión fiscal válida igual. Si se mantiene en el Milestone 2 es incompatible con el calendario y compite por los mismos días que la calidad clínica |
| **WhatsApp embebido oficial** (§4.2) | El App Review de Meta son **2–6 semanas de un tercero**. Alternativa: aceptar formalmente Evolution (protocolo no oficial) documentando el riesgo de baneo del número del cliente |

---

## Recomendación para la reunión del 3-ago

Llevar **tres decisiones cerradas**, no tres preguntas abiertas:

1. **Facturación/cartera/inventario sale del Milestone 2, o el hito se mueve.** Son 5–7 semanas y
   compiten por los mismos días que la calidad clínica. Mantener las dos cosas es incumplir las dos.
2. **¿El cliente provee la cuenta de Google con crédito y el crédito de producción de Anthropic esta
   semana?** Sin eso, §1.1/1.4/1.5/2.5 no se cierran por esfuerzo nuestro, y es el bloque de mayor
   incumplimiento literal.
3. **¿Se acepta Evolution** (protocolo no oficial, riesgo de baneo del número) mientras corre el
   trámite de Meta, o se espera el App Review?

Argumento a favor: en 37 horas el cumplimiento pasó de ~50 % a ~74 %, con **456 pruebas corriendo en
CI** donde antes no corría ninguna, y **cinco defectos que el cliente no había detectado** encontrados y
corregidos:

1. El **CI estaba inerte** — el workflow vivía fuera de la raíz y las 326 pruebas no corrían nunca.
2. **`psycopg-pool` no estaba declarada** aunque el código la importa desde el 24-jul: el siguiente
   build desde cero de Railway se habría caído.
3. **Corrupción silenciosa de fechas** en el agente — `2026-02-30` no es inválida para JavaScript, la
   rueda a `2026-03-02`, y la cita quedaba agendada otro día sin avisar.
4. La **nota clínica se guardaba vacía** en 1 de 16 casos, sin ningún error visible.
5. Un **`chunk_id` crudo** quedaba escrito en el subjetivo de la historia clínica.

Los cinco eran invisibles a la inspección y salieron de instrumentar la medición. Es el argumento más
fuerte de que el trabajo de calidad no es cosmético.

---

*Documentos relacionados: `AUDITORIA-MILESTONE2-2026-07-29.md` (auditoría ítem por ítem),
`../../INVENTARIO-COMPONENTES.md` v1.1 (93 componentes), `../../docs/AGENT-SMOKE-TESTING.md` (capa
agéntica) y `../scripts/calidad/README.md` (metodología de medición).*
