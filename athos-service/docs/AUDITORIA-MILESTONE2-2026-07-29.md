# Auditoría técnica — Milestone 2 (COT-2026-TUV-001)

> **Fecha de la auditoría:** 2026-07-29. **Alcance:** cada requerimiento exigible al 28 de julio de
> 2026 según el Contrato, el Anexo A, el Otrosí N.° 1 y las observaciones del cliente del 29-jul.
>
> **Regla de verificación aplicada (Otrosí, num. 2.3):** sólo cuenta lo **integrado y operando en el
> entorno accesible al cliente**. Un SDK declarado sin uso no cuenta. Un esquema de base de datos sin
> interfaz no cuenta. Código que existe pero no se ejecuta con la configuración de producción no
> cuenta.
>
> **Verificado contra:** el repositorio `plogy-dev/tuvetia` en `master`, la base de producción
> (`auxlnexhkmtoedrzfsnz`, sólo lectura), las variables de entorno reales de Railway y el entorno
> desplegado (`athos-service-production.up.railway.app`).

---

## 1. Integración IA completa — ⚠️ 45 %

Cláusula: *"Integración de APIs de inteligencia artificial: **Gemini, DeepSeek y Claude**, con lógica
de **cascada**, **routing de modelos**, **system prompts** y **estructura de skills**."*

### [1.1] ❌ NO EXISTE — Google Gemini

**Evidencia:** cero resultados en todo el repositorio. No figura `@google/generative-ai`,
`@ai-sdk/google` ni `genai` en `package.json`; ni `google-generativeai` en
`athos-service/requirements.txt` ni en `pyproject.toml`. Búsqueda en los locks
(`package-lock.json`, `athos-service/uv.lock`): 0 coincidencias — no está ni como dependencia
transitiva. **`GEMINI_API_KEY` no existe en Railway** (verificado: 32 variables, ninguna de Google
IA). Los únicos `GOOGLE_*` del repo son `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, y pertenecen al
OAuth de Google Calendar (`src/lib/google-calendar.ts:53-56`), no a IA.
**Gap:** la integración no está iniciada. Falta dependencia, rama de proveedor en `LLMClient`
(`athos-service/app/generation/llm_client.py:27-42` sólo contempla `anthropic` y `openai`), provider
en el front (`src/lib/athos-agent/model.ts`), la key en Railway y Vercel, y validación contra el
golden set para poder afirmar paridad de calidad.
**Esfuerzo estimado:** 3–5 días.
**Bloqueadores externos:** alta de cuenta Google AI Studio / Vertex AI **con crédito facturable**.
Es prerrequisito de 1.4 y 1.5 (sin el tercer proveedor no hay cascada demostrable).

### [1.2] ✅ CUMPLE — DeepSeek

**Evidencia:** es el proveedor productivo del backend. Railway: `LLM_PROVIDER=openai`,
`LLM_BASE_URL=https://api.deepseek.com`, `LLM_MODEL=deepseek-v4-flash`, `LLM_API_KEY` presente. Con
esa configuración `llm_client.py:29-31` despacha siempre a la rama OpenAI-compatible
(`_openai_complete:84`, `_openai_stream:104`). Atiende `/athos/chat`, `/athos/phantom/suggest` y
`/athos/whatsapp/suggest`. Tests: `athos-service/tests/test_llm_client.py:33-41`.
**Gap:** ninguno para este ítem.

### [1.3] ⚠️ PARCIAL — Claude / Anthropic

**Evidencia:** opera **sólo en el front** (Vercel): `@ai-sdk/anthropic` en `package.json:13`, default
del agente en `src/lib/athos-agent/model.ts:26,30-31`, y **forzado sin alternativa** para visión
(`model.ts:54-60`). Code paths vivos: `api/athos/agent/route.ts:72-73` (chatbot con 17 tools),
`api/athos/suggest-reply/route.ts:63-64`, `lib/whatsapp/auto-reply.ts:135-136`,
`lib/cartera/inbound.ts:61-62`, `lib/facturacion/recipe-ingest.ts:59-60`.
**En el backend es código muerto:** el cliente Anthropic está implementado
(`llm_client.py:45-76`, con prompt caching) pero **`ANTHROPIC_API_KEY` NO está en Railway**
(verificado) y `LLM_PROVIDER=openai`, así que esa rama nunca se ejecuta.
**Gap:** (a) Anthropic no opera en el backend — falta la key en Railway y la lógica que lo active;
(b) confirmar en el panel de Vercel que `ANTHROPIC_API_KEY` está en Production: **si falta, todo el
agente del front está caído** y no es verificable desde el repositorio.
**Esfuerzo estimado:** 1–2 h (verificar env + evidencia de una llamada real).
**Bloqueadores externos:** crédito Anthropic de producción (no el de prueba de US$10).

### [1.4] ❌ NO EXISTE — Lógica de cascada entre LLMs

**Evidencia:** no hay un solo punto del repositorio donde el fallo de un LLM provoque el intento con
otro. El dispatch es un `if/else` de dos ramas resuelto por variable de entorno en el arranque
(`llm_client.py:29-31`). El único manejador de error del proveedor en el chat
(`athos-service/app/chat.py:298-300`) registra un warning y le muestra al veterinario *"No se pudo
generar la respuesta en este momento"* (`chat.py:334-336`): es **degradación de servicio, lo
contrario de una cascada**. En el front, los `catch` devuelven 502 (`suggest-reply/route.ts:95-98`) o
tragan el error (`auto-reply.ts:191-194`), sin cambiar de proveedor.

> ⚠️ **Homonimia que hay que anticipar.** El repositorio usa mucho la palabra *"cascada"*, pero se
> refiere a la **cascada de retrieval** (`app/retrieval/cascade.py`: tiers léxico/vectorial
> determinísticos sobre SQL). No tiene relación con la cláusula contractual. Presentarla como
> evidencia de cumplimiento sería incorrecto.

Lo que existe son **degradaciones de feature**, expresamente excluidas por el Otrosí 2.3: sin Cohere
se sigue sin rerank (`rerank.py:66`), sin Tier 2 se sigue con el léxico (`cascade.py:345`), el juez
de evidencia y el auditor de citas "fallan abiertos" (`evidence_judge.py:142`,
`citation_fidelity.py:141`). Y un reintento ante 429 **contra el mismo proveedor** en embeddings
(`embeddings.py:86-115`).
**Gap:** falta construir la cascada: clasificación de errores (timeout / 429 / 5xx / rechazo),
cadena ordenada de ≥3 proveedores con presupuesto de intentos, circuit breaker, y — la parte
técnicamente costosa — **failover a mitad de stream SSE** (cuando el proveedor cae ya se emitieron
tokens al veterinario), más registrar el proveedor efectivo en `rag_answer_log.model`.
**Esfuerzo estimado:** 3–5 días.
**Bloqueadores externos:** requiere las 3 cuentas activas y con crédito **simultáneamente**.

### [1.5] ⚠️ PARCIAL — Routing de modelos

**Evidencia de lo que sí hay:** asignación **estática por rol de tarea**, vía variables de entorno.
Backend, 3 ranuras: `llm_model` (redacción), `llm_light_model` (A→B y alertas), `judge_model` (juez).
Front, 3 ranuras: `agentModel()`, `autoModel()`, `visionModel()` (`model.ts:29-60`).
**Evidencia de lo que no hay:** ninguna decisión en función de la consulta. No existe clasificador de
complejidad, ni estimador de costo, ni escalado por confianza, ni política de latencia. El modelo
queda resuelto al arrancar el proceso, idéntico para todas las consultas. El propio
`athos-service/CLAUDE.md` describe el escalado selectivo de casos difíciles como **pendiente**.
**Estado real en Railway (verificado hoy):** `LLM_MODEL` = `LLM_LIGHT_MODEL` = `deepseek-v4-flash`
— la separación por rol está **colapsada**: el mismo modelo atiende redacción y tareas livianas.
`JUDGE_MODEL=deepseek-v4-pro` es la **única** ranura con un modelo distinto (se separó el 2026-07-29
tras medir que el liviano era demasiado blando para abstenerse; ver §2.2).
**Gap:** falta la capa de decisión por consulta (heurística o clasificador), tabla de costos por
proveedor (hoy son constantes en `src/lib/admin/pricing.ts:6-7`), telemetría comparativa y
persistencia del modelo elegido con su razón.
**Esfuerzo estimado:** 2–4 días el routing por consulta; 1 h desacoplar `LLM_LIGHT_MODEL`.
**Bloqueadores externos:** sin los 3 proveedores no hay universo entre el que rutear.

### [1.6] ✅ CUMPLE (definidos) / ⚠️ PARCIAL (versionados) — System prompts

**Evidencia:** 14 system prompts en código de producción. Backend: `CHAT_SYSTEM`
(`app/chat.py:47`), `CLINICAL_SYSTEM_PROMPT` (`generate.py:20`), `JUDGE_SYSTEM`
(`evidence_judge.py:52`), `_DISTILL_SYSTEM` (`query_builder.py:22`), `_EXPLAIN_SYSTEM`
(`condition_alerts.py:16`), `WHATSAPP_SYSTEM_PROMPT` (`whatsapp_reply.py:15`), `VERIFY_SYSTEM`
(`citation_fidelity.py:39`, hoy apagado). Front: `ATHOS_AGENT_SYSTEM_PROMPT`
(`lib/athos-agent/system-prompt.ts:8`) más 4 prompts inline
(`auto-reply.ts:138`, `cartera/inbound.ts:65`, `recipe-ingest.ts:34`, `import/ingest.ts:41`).
**Gap:** "versionados" no se cumple en sentido estricto. No hay campo de versión ni registro de
prompts, y **el número de versión no se persiste junto a la respuesta** (`rag_answer_log` sólo
guarda `model`): hoy no se puede reproducir con qué prompt se generó una nota clínica ya aprobada,
que es relevante en un producto sanitario con aprobación humana. El versionado de hecho es el
historial de Git.
**Esfuerzo estimado:** 1–2 días (extraer los inline a un módulo, añadir `PROMPT_VERSION` y
persistirlo).

### [1.7] ⚠️ PARCIAL — Estructura de skills

**Evidencia:** hay function-calling real y bien construido: **17 tools** con esquema Zod en
`src/lib/athos-agent/tools.ts` (482 líneas), consumidas por el loop del agente
(`api/athos/agent/route.ts:72-73`). 10 de lectura y 7 de escritura mediada por aprobación humana.
**No existe** una estructura de skills: no hay agrupación por dominio, ni registro declarativo, ni
carga condicional, ni prompt por skill — un único prompt monolítico de 54 líneas gobierna las 17
tools. El backend no tiene function-calling en absoluto (por diseño).

> ⚠️ **Falso positivo a desactivar:** existen `.agents/skills/` y `skills-lock.json` en el repo, pero
> son skills de **Claude Code para el equipo de desarrollo** (`supabase`,
> `supabase-postgres-best-practices`). **No deben computarse como cumplimiento contractual.**

**Gap:** depende de la interpretación de "estructura de skills". Si el cliente acepta que 17 tools
con esquema y aprobación humana satisfacen la cláusula, es una refactorización cosmética.
**Esfuerzo estimado:** 1–2 días. **Requiere fijar por escrito la definición con el cliente antes de
estimar en firme** — es la diferencia entre 1 día y una reescritura.

### [1.8] ⚠️ PARCIAL — "API routing setup" y "Agent connections" (Milestone 1)

**Evidencia:** las conexiones de agente existen y operan (17 tools, `/athos/retrieve` como
herramienta de evidencia). El "routing setup" es el de 1.5: estático por rol, no dinámico.

### [1.9] ✅ CUMPLE — Deepgram

**Evidencia:** `app/transcription.py:69-88` (POST real a `api.deepgram.com/v1/listen`), modelo
`nova-2` (`config.py:66`), diarización y español. **`DEEPGRAM_API_KEY` presente en Railway**
(verificado). Ruta viva `POST /athos/transcribe` (`main.py:113-121`), consumida por
`src/lib/athos.ts:131-146` y `components/consultation-recorder.tsx`.
**Gap:** ninguno de integración. **Es batch, no tiempo real** — ver §4.6.

### [1.10] ⚠️ PARCIAL — Variables de entorno de producción

**Evidencia (Railway, verificado el 2026-07-29 — 32 variables):** presentes `LLM_PROVIDER=openai`,
`LLM_BASE_URL`, `LLM_MODEL`, `LLM_LIGHT_MODEL`, `JUDGE_MODEL`, `LLM_API_KEY`, `EMBEDDING_*`,
`DEEPGRAM_API_KEY`, `STT_MODEL`. **Ausentes: `GEMINI_API_KEY`, `GOOGLE_API_KEY`,
`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`.**
**Gap:** (a) cero variables de Gemini; (b) sin `ANTHROPIC_API_KEY` en Railway, el backend no puede
usar Claude ni siquiera cambiando `LLM_PROVIDER`; (c) las keys de IA del front no son verificables
desde el repositorio — hay que auditarlas en el panel de Vercel; (d) `athos-service/.env.example`
está desactualizado (no documenta `JUDGE_*`, `RERANK_*`, `FIDELITY_ENABLED`); (e) existe
`athos-service/.env.bak` con credenciales en el árbol de trabajo — verificar que `.gitignore` lo
cubra.
**Esfuerzo estimado:** 2–4 h.

### Resumen §1 — qué proveedores operan hoy

| Proveedor | ¿Opera? | Dónde | Modelo |
|---|---|---|---|
| **DeepSeek** | ✅ sí | backend completo (chat, Fantasma, juez, A→B) | `deepseek-v4-flash` + `deepseek-v4-pro` (juez) |
| **Claude** | ⚠️ sólo front | agente con tools, WhatsApp, visión de facturación | `claude-sonnet-5` / `claude-haiku-4-5` |
| **Gemini** | ❌ no existe | — | — |

**Los dos proveedores que existen no conviven en el mismo proceso.** Cascada: no existe. Routing:
estático por rol.

---

## 2. Chatbot sin alucinaciones + LLM Harness — ⚠️ 60 %

### [2.1] ✅ CUMPLE — LLM Harness

**Evidencia:** suite completa y ejecutable en `athos-service/scripts/calidad/` — **22 scripts** y 3
bancos de casos, documentados en `scripts/calidad/README.md`:
- **Bancos:** `tests/golden/cases.json` (11 casos, prueba de humo), `ampliado.json` (**146 casos**
  positivos anclados al corpus por descriptor MeSH), `ampliado_negativos.json` (**42 casos** de
  control sin cobertura).
- **Retrieval:** `golden_eval.py` (hit@k, precision@k, rank del primer acierto),
  `recall_ciego.py` (localiza en qué paso de la cascada se pierde el target).
- **Calidad de respuestas:** `respuestas_eval.py` (rúbrica de 5 dimensiones + veredicto binario
  juzgado por un modelo distinto del redactor), `respuestas_ab.py` (comparación **pareada** de
  variantes sobre la misma literatura).
- **Abstención:** `abstencion_roc.py`, `abstencion_juez.py`, `abstencion_citas.py`,
  `abstencion_validar.py`.
- **Latencia:** `latencia_db.py` (tiempo de servidor), `latencia_e2e.py` (end-to-end).
- **Glosario:** pipeline de 4 pasos con gate de no-regresión.

**Gap:** el harness cubre el **backend RAG**. No cubre el **agente del front** (0 tests sobre las 17
tools) — ver 2.4.

### [2.2] ⚠️ PARCIAL — Mecanismo de abstención (era 0/187; corregido parcialmente hoy)

**Evidencia del problema que reportó el cliente:** confirmado y documentado. El umbral determinístico
`passes_threshold` daba `True` en **187/187** casos. Medido: ninguna señal gratuita discrimina
(score determinístico 1.701 vs 1.700; score del reranker 0,532 vs 0,499; nº de citas 6,0 vs 6,0).
**Correcciones aplicadas:**
1. **Juez semántico en bandas** (`app/generation/evidence_judge.py`), en producción desde el
   2026-07-28: `none` → abstención dura, `limited` → responde declarando evidencia limitada,
   `sufficient` → normal. Falla abierta.
2. **El juez con el modelo liviano seguía siendo demasiado blando** (hallazgo del 2026-07-29):
   contrastado con un árbitro fuerte, de los negativos donde la literatura genuinamente no alcanza
   **falló 4 de 5** — premiaba que los pasajes *mencionaran* la entidad en vez de exigir que
   *respondieran al caso*. Corregido con `JUDGE_MODEL=deepseek-v4-pro` (ya en Railway): los casos
   que responden con confianza sin literatura **bajaron de 9/10 a 5/10**, se abstiene en 2 y declara
   evidencia limitada en 3, **sin aumentar la sobre-abstención** (2/24 positivos).

**⚠️ ACTUALIZACIÓN (misma fecha, más tarde): el instrumento de medición estaba roto, y se arregló.**
Se validaron los **42 negativos** con un árbitro fuerte: **24 (57 %) NO eran negativos** — el corpus
cubre el tema bajo otro descriptor, con puntaje 8-9/10 (no hay `Impetigo` pero sí el tratamiento del
impétigo con clorhexidina; no hay `Exophthalmos` pero sí las patologías retrobulbares que lo causan).
En esos 24 casos **responder era lo correcto**. Toda medición previa de la abstención —incluido el
«0 activaciones en 187 casos» del reporte del cliente— se hizo con un banco que no medía lo que decía
medir.

**El número real, con el banco depurado a 18 negativos válidos** (`ampliado_negativos_validado.json`
vía `negativos_validar.py`) y medición **pareada** (`juez_calibrar.py`):

| juez | acierta en negativos | sobre-abstiene en positivos |
|---|---|---|
| **liviano (el de producción)** | **11/18 · 61 %** | **1/16 · 6 %** |
| grande (`deepseek-v4-pro`) | 12/18 · 67 % | 2/16 · 12 % |

**La abstención funciona razonablemente**: 61 % de aciertos con sólo 6 % de daño colateral. "Acierta"
incluye la banda `limited` (responde declarando evidencia limitada), que cumple la función de avisar
al veterinario; contando sólo la abstención dura serían 3/18.

Y **el modelo grande queda descartado con instrumento válido**: gana un solo caso en negativos y
**duplica la sobre-abstención**. Confirma la reversión que ya se había hecho.
**Gap:** ampliar el banco de negativos válidos (hoy 18) antes de tocar los cortes
`JUDGE_ABSTAIN_MAX`/`JUDGE_LIMITED_MAX` — con n=18 calibrarlos sería sobreajustar, el mismo error que
ya costó una reversión.
**Esfuerzo estimado:** 1–2 días (ampliar el banco; el instrumento de medición ya está construido).

### [2.3] ⚠️ PARCIAL — Citas de fuentes correctas (el hallazgo más grave que queda)

**Evidencia:** confirmado el reporte del cliente, y cuantificado: **18 de 24 respuestas citan al
menos un pasaje que no sostiene la afirmación**. Existen dos capas distintas y sólo una está activa:
- **Procedencia (activa, determinística):** `app/generation/citations.py` descarta cualquier `[n]`
  que no esté en la literatura recuperada. **El modelo no puede inventar fuentes.**
- **Pertinencia (construida, APAGADA):** `app/generation/citation_fidelity.py` (12 tests) pregunta
  al LLM liviano, por cada afirmación, si el pasaje la sostiene. **`FIDELITY_ENABLED=false`** porque
  sin calibrar **descarta el 58 % de las referencias** (81 de 140), incluso en respuestas que el juez
  de calidad puntúa 8-9 de fundamentación; en un caso se lleva las 8 fuentes y deja la respuesta sin
  ninguna referencia. Encenderlo así degradaría justo lo que el veterinario usa para verificar.

**Los tres patrones de fallo** (revisados uno por uno): extrapolar el pasaje a más de lo que dice;
citar una tabla de datos para sostener una afirmación narrativa; y cita múltiple decorativa
(`[1, 5, 11]` donde ninguna sostiene la afirmación entera). **No son cifras inventadas** — se midió:
de 14 cifras duras presentadas con cita, 11 estaban en el pasaje citado.
**Dos caminos ya descartados por medición** (no repetir): un guard determinístico de cifras
(resolvería un problema que casi no existe) y una variante de prompt con reglas de citación
estrictas, que **empeoró todas las dimensiones** y subió las citas de 6 a 8 por respuesta.
**Gap:** calibrar el auditor — pedirle que marque sólo lo que **claramente** no sostiene, con
"en caso de duda, sostiene", y validar a mano una muestra de descartes antes de encenderlo.
**Esfuerzo estimado:** 2–3 días (calibración + validación manual + medición).

### [2.4] ⚠️ PARCIAL — Agent smoke testing (construido el 2026-07-29)

**Evidencia:** el backend tiene **150 tests** que pasan (`athos-service/tests`, verificado hoy) y
`ruff` limpio. El front tiene 20 archivos de test, **todos de facturación/cartera**: cero tests sobre
`src/lib/athos-agent/` (las 17 tools, el loop del agente, la aprobación de acciones). **No existe
ningún documento de smoke testing** del agente con resultados (búsqueda de `smoke` en los `.md`: sólo
2 menciones no relacionadas).
**✅ Construido el 2026-07-29:** `src/lib/athos-agent/__tests__/agent-smoke.test.ts` cubre los
**invariantes de seguridad** de la capa agéntica, que es lo que un auditor querría ver:
- `risk:"approval"` **siempre** — no existe camino de auto-aprobación.
- La propuesta nace sin `status` ni `executed_at`: nunca se crea ya ejecutada.
- El `clinic_id` sale del **contexto de sesión, no del payload** — la clínica no es inyectable aunque
  el modelo la ponga en los argumentos (test explícito con `clinic_id: "clinic-DE-OTRO"`).
- Trazabilidad: `created_by` y `proposed_by_model` quedan registrados; en modo auto `created_by` es
  `null` y no se atribuye a un veterinario.
- Si el insert falla, devuelve error legible y **no finge** que se propuso.
- **Inventario cerrado: exactamente las 17 tools esperadas**, cada una con `inputSchema`, y **las 7 de
  escritura terminan en una propuesta** (se ejercitan una por una verificando que insertan con
  `risk:"approval"`).
- `localToIso` fija el offset de Colombia, así que una cita de las 23:30 no se corre de día.

**Gap que queda:** (a) el job del front del CI **no se pudo ejecutar en la máquina de desarrollo**
(Node 22.11 local vs `>=22.12` que exigen `vite`/`rolldown`); los tests están escritos y el
type-check pasa sin errores, y su primera corrida en GitHub Actions es la validación real; (b) falta
cubrir el ciclo `proponer→aprobar→ejecutar` de la ruta HTTP (requiere mockear el cliente de sesión) y
los límites (expiración, doble ejecución, rate limit); (c) el documento formal de resultados.
**Esfuerzo estimado restante:** 1–1,5 días.

### [2.5] ❌ NO EXISTE — Pruebas comparativas de calidad entre modelos

**Evidencia:** no existe ningún script ni documento que compare Gemini vs DeepSeek vs Claude sobre
el mismo banco. Lo que sí se hizo (2026-07-29) son **comparativas de prompts con el mismo modelo**
(`respuestas_ab.py`, A/B pareado) y una comparativa de **modelos de juez** (liviano vs grande, §2.2).
La comparativa entre proveedores es **imposible hoy** por 1.1 y 1.3: sólo hay un proveedor por
proceso y falta Gemini por completo.
**Gap:** depende de 1.1 (cuenta Gemini) y 1.3 (key de Anthropic en Railway). Una vez disponibles, el
banco ya existe: `respuestas_eval.py` acepta el modelo por parámetro.
**Esfuerzo estimado:** 1–2 días **después** de resolver 1.1 y 1.3.
**Bloqueadores externos:** cuentas y crédito de los tres proveedores.

### [2.6] ✅ CUMPLE — Latencia (el reporte de ~5 minutos NO se reproduce)

**Evidencia (medido hoy con `latencia_e2e.py`, 8 consultas secuenciales del banco, contra el corpus
de producción de 520 k chunks, con el pipeline real):**

| | mediana | p95 | máximo |
|---|---|---|---|
| **Hasta el primer token** (lo que el vet percibe como espera) | **12,8 s** | 25,4 s | 25,4 s |
| **Respuesta completa** | **27,6 s** | 40,1 s | 40,1 s |
| desglose: retrieval | 10,5 s | 22,9 s | 22,9 s |
| desglose: juez de evidencia | 2,1 s | 2,8 s | 2,8 s |
| desglose: generación completa | 15,1 s | 19,7 s | 19,7 s |

**Son segundos, no minutos.** Y la medición es **pesimista**: se tomó desde una notebook en
Colombia contra Supabase en `us-west-2`, mientras el backend en Railway corre junto a la base — el
retrieval real en producción es menor. Contexto histórico que probablemente explica el reporte del
cliente: el Tier 1 del retrieval tardaba **15.397 ms de tiempo de servidor** y estaba al filo del
`statement_timeout` de 15 s, lo que producía **consultas canceladas** (que se perciben como cuelgue,
no como lentitud). Se corrigió el 2026-07-28 a **143 ms** (108× del lado del servidor) separando las
ramas del `OR` en `cascade.TIER1_SQL`, y con `TIER1_MESH_STOPLIST`, que evita que el descriptor de
especie (`Dogs`, presente en 43.033 chunks) haga estallar la consulta.
**Gap:** la respuesta completa creció a ~27 s porque las respuestas ahora son ~3× más largas
(1.656 → ~4.500 caracteres) tras el cambio de prompt del 2026-07-29. El chat va en **streaming**, así
que el veterinario ve texto a los ~12,8 s; pero conviene medirlo desde Railway para tener el número
real y considerar acotar el largo.
**Esfuerzo estimado:** 4 h (instrumentar la latencia en `rag_answer_log` para medirla en vivo y de
forma continua, no por muestreo manual).

### [2.7] ⚠️ PARCIAL — Tasa de respuestas sin información suficiente

**Evidencia (traza de producción, verificada hoy):** `rag_retrieval_log` tiene **73 recuperaciones**
(41 del Fantasma, 32 del chat) de 5 clínicas, entre el 2026-07-16 y el 2026-07-29;
`rag_answer_log` tiene 16 respuestas, **1 con `insufficient_evidence`**. `athos_messages`: 61
mensajes en 13 pacientes. `clinical_notes`: 22 `approved` + 15 `draft`, **todas con
`evidence_level='sufficient'`**.
**Gap:** la afirmación de "~0,03 %" **no es verificable ni defendible con 73 recuperaciones y 16
respuestas logueadas** — el volumen de uso real es demasiado bajo para sostener cualquier tasa. Y
`passed_threshold=false` aparece en **0** casos, coherente con §2.2 (el umbral no discrimina; la
abstención la decide el juez, cuya banda **no se persiste en `rag_retrieval_log`**).
**Esfuerzo estimado:** 4 h (persistir `evidence_level` y el veredicto del juez en la traza para poder
reportar la tasa real).

### [2.8] ❌ NO EXISTE — Revisión de calidad interna documentada

**Evidencia:** no hay documento de revisión de calidad de Plogy para este milestone. Lo que existe es
documentación técnica de ingeniería (`scripts/calidad/README.md`, `ESTADO.md`, este informe).
**Gap:** falta el acta o informe de revisión interna que el Anexo A asocia al ítem "Plogy — Equipo,
consultoría y gestión".
**Esfuerzo estimado:** 1 día.

---

## 3. Base de conocimiento veterinaria — ✅ 85 %

### [3.1] ✅ CUMPLE — Corpus importado e indexado

**Evidencia (base de producción, verificada hoy):** **519.999 chunks**, **todos** con embedding
(519.999) y **todos** con `tsvector` (519.999). Cinco índices sobre `corpus_chunks`:
`corpus_chunks_embedding_idx` (**HNSW**, m=16 ef_construction=64), `corpus_chunks_mesh_gin` (GIN),
`corpus_chunks_metadata_idx` (GIN), `corpus_chunks_tsv_idx` (GIN) y la PK. Glosario: **2.506
términos** y **7.378 sinónimos**. Corresponde a los 61.544 documentos entregados por el cliente.
**Gap:** ninguno de importación.

### [3.2] ⚠️ PARCIAL — Pruebas sobre el corpus completo, finalizadas y documentadas

**Evidencia:** las pruebas de **recuperación** están finalizadas y documentadas contra el corpus
completo: **hit@15 83,6 %**, precision@15 30,5 %, primer acierto en el puesto 2 (mediana),
**146/146 casos sin fallos**, ~13 min de corrida (`scripts/calidad/README.md`). Gate del golden
11/11 verificado contra el principal.
Las pruebas de **calidad de las respuestas** se construyeron el 2026-07-29 (no existían al 28-jul) y
se corrieron sobre una muestra de 24 + 10 casos, no sobre el banco completo.
**Hallazgo relevante para leer las cifras:** el `hit@15` de 83,6 % **subestima** el retrieval, porque
exige el descriptor MeSH exacto. Al abrir los 24 fallos uno por uno: 12 son descriptores paraguas que
ningún veterinario consulta (`Inflammation`, `Syndrome`, `Recurrence`), 3 son **el mismo loro** con
signos idénticos etiquetado con tres diagnósticos distintos, 4 son el mismo cuadro de diarrea aguda
con cuatro etiquetas, 2 usan el término humano en vez del veterinario y 1 es un sinónimo correcto.
**Queda un solo fallo real** (`lyme-disease`), con culpable identificado: el reranker lo descarta
aunque el vector lo recupere en el puesto 36 de 40.
**Gap:** correr la evaluación de respuestas sobre el banco completo (146 + 42) y publicar el informe.
**Esfuerzo estimado:** 1 día (la corrida completa son ~4 h de cómputo + redacción).

### [3.3] ⚠️ PARCIAL — Procedimiento de la Cláusula 13 (deficiencias de formato)

**Evidencia:** la ingesta documenta decisiones sobre el material recibido (validación por
`content_hash`, frontmatter → `metadata`, chunking con `locator`). **No consta comunicación formal al
cliente** dentro de los 5 días hábiles sobre deficiencias de formato o estructura.
**Gap:** documentar retroactivamente si hubo deficiencias y si se comunicaron; si las hubo y no se
comunicaron, el procedimiento contractual no se cumplió.
**Esfuerzo estimado:** 2 h (revisión del historial de comunicaciones — requiere al equipo).

---

## 4. Componentes presentados pero no operando — ❌ 25 %

**Cómputo bajo el Otrosí 2.3:** de 9 componentes auditados, **0 cumplen plenamente**, **4 son
parciales** y **5 no cuentan**.

### [4.1] ⚠️ PARCIAL — Google Calendar bidireccional

**Evidencia:** la dirección **plataforma → Google opera** (`appointment-calendar.tsx:137` llama a
`/api/google/calendar/push` al crear la cita). La dirección **Google → plataforma existe pero es
MANUAL**: `pullEvents()` (`src/lib/google-calendar.ts:164-224`) sólo se dispara con el botón
"Sincronizar" (`google-calendar-connect.tsx:76`). **No hay `events.watch` ni webhook** (cero
ocurrencias de `watch`, `channelId`, `X-Goog-Resource-State` en el repo) **ni cron de sincronización**
(`vercel.json` sólo declara `purge-audio` y `cartera`).
**Fuga relevante:** las citas que crea el agente **nunca llegan a Google** —
`api/athos/actions/[id]/execute/route.ts:127` crea la cita por RPC y no invoca el push. Toda cita
agendada por Athos o por WhatsApp queda fuera del calendario del veterinario. Y los errores de push
se silencian (`appointment-calendar.tsx:143-145`, `catch { /* best-effort */ }`).
**Gap:** la bidireccionalidad automática no existe. Falta `events.watch` + receptor con renovación de
canal (expiran a 7 días) o al menos un cron de pull; llamar al push desde el ejecutor del agente; y
hacer visible el error.
**Esfuerzo estimado:** 3–4 días. **Bloqueadores externos:** verificación de Google (~10 días) si se
abre al público; hoy sólo funciona con test users (máx. 100).

### [4.2] ⚠️ PARCIAL — WhatsApp embebido

**Evidencia:** hay **tres** caminos y el activo depende de variables de entorno
(`whatsapp-settings.tsx:247`). El **Embedded Signup de Meta está construido y sí es embebido**
(popup del SDK de Facebook, sin salir de la plataforma, `whatsapp-settings.tsx:142-193`) pero se
activa sólo con `NEXT_PUBLIC_META_APP_ID` + `NEXT_PUBLIC_META_ES_CONFIG_ID`. **Evolution** (el
proveedor vigente) muestra el QR dentro de la app, pero es **protocolo no oficial** (Baileys) con
riesgo de baneo asumido en `docs/EVOLUTION.md:6`. **Kapso, que es el fallback por defecto si no hay
ninguna env, SALE de la plataforma**: `whatsapp-settings.tsx:204` hace
`window.location.href = json.setup_url`. En la única configuración visible del repo no está ninguna de
las tres variables.
**Verificación ante Meta: NO realizada.** `WHATSAPP.md` §Trámite lista como pendientes el Business
Manager verificado, el App Review de `whatsapp_business_messaging`/`management` con 2 videos demo y la
Access verification de Tech Provider. Límite mientras no se complete: 10 clínicas por semana.
**Esfuerzo estimado:** 1–2 días técnicos (habilitar envs + grabar los videos). **El trámite: 2–6
semanas de calendario — no es subsanable antes del 17 de agosto.**

### [4.3] ❌ NO EXISTE — Correo electrónico (Gmail)

**Evidencia:** cero dependencias de correo en `package.json` (no hay `nodemailer`, `resend`,
`@sendgrid/mail`, ni cliente de Gmail API). El módulo es un **stub declarado**:
`src/lib/facturacion/email.ts:3-9` dice literalmente *"STUB (contrato §5): el destino NO tiene email
configurado (nada de Gmail/nodemailer)"* y `sendInvoiceByEmail` **siempre** retorna
`{ ok: false, reason: 'email_no_configurado' }`. No existe `/api/email`. La página de Comunicaciones
es 100 % WhatsApp (`comunicaciones/page.tsx:6,19`) y si WhatsApp no está conectado la página entera
muestra "WhatsApp no está conectado". Lo único que envía correo es la invitación de equipo, y reusa el
SMTP de autenticación de Supabase.
**La afirmación del cliente es correcta: el correo no existe como código funcional.**
**Esfuerzo estimado:** 6–9 días. **Bloqueadores externos:** verificación de dominio y reputación de
envío (SPF/DKIM/DMARC); si se exige Gmail API nativa, revisión de Google por scopes restringidos
(semanas a meses).

### [4.4] ✅ CORREGIDO en código (2026-07-29, commit `166c6a6`) — Invitaciones de equipo

> **Los 3 bugs de código están arreglados.** (1) `redirectTo` ahora apunta a
> `/auth/callback?next=/invitar/<token>`, que **sí canjea** el `?code=` de PKCE — antes el invitado
> aterrizaba sin sesión y el enlace "no hacía nada"; (2) el origin sale de `getAppBaseUrl()` en vez de
> `new URL(req.url).origin`, que en preview daba un dominio fuera de la allow-list de Supabase; (3) se
> agregó `POST /auth/signout` (POST a propósito: con GET, el prefetch de `<Link>` cerraría la sesión
> al pasar el mouse) y el botón "cambiar de cuenta" ahora **cierra sesión de verdad**, preservando el
> destino para volver a la invitación.
>
> ⏳ **Queda 1 ítem de configuración, no de código (30 min):** la plantilla "Magic Link" del panel de
> Supabase tiene el destino fijo en `/dashboard`, así que quien reintenta por "Ya tengo cuenta" cae en
> el panel en vez de volver a la invitación. Requiere acceso al panel de Auth.

*Diagnóstico original, conservado como referencia:*

**Evidencia:** el link **sí** incluye el token y la ruta **sí** existe
(`src/app/invitar/[token]/page.tsx`); el backend está completo. Los fallos son de integración:
- **Bug 1 — el correo aterriza SIN sesión.** `api/team/invite-email/route.ts:44-46` manda
  `redirectTo: /invitar/<token>`, pero esa ruta es un server component que sólo hace
  `auth.getUser()`: **no canjea el `?code=` de PKCE**. Las rutas que sí lo hacen son `/auth/callback`
  (`exchangeCodeForSession`) y `/auth/confirm` (`verifyOtp`). Resultado: el invitado ve "Inicia sesión
  o crea tu cuenta" — **el enlace del correo "no hace nada"**. La corrección es apuntar `redirectTo` a
  `/auth/callback?next=/invitar/<token>`.
- **Bug 2 — el `next` se pierde en el reintento.** La plantilla de Supabase tiene `next` hardcodeado
  a `/dashboard`, así que quien reintenta por "Ya tengo cuenta" cae en el dashboard y **nunca acepta**
  la invitación; peor, queda con `clinic_id = NULL` porque `ensure_clinic_membership` detecta la
  invitación pendiente y retorna sin crear clínica.
- **Bug 3 — "Cambiar de cuenta" es un callejón sin salida** (`invitar/[token]/page.tsx:94-108`): pide
  cerrar sesión pero el botón no llama a `signOut`.
- **Bug 4 —** `new URL(req.url).origin` en deployments de preview genera un dominio que probablemente
  no esté en la allow-list de Supabase; existe `src/lib/base-url.ts` y no se usa aquí.

**Esfuerzo estimado:** 4–6 h de código + 30 min de configuración en Supabase + 4 h de test e2e.
**Bloqueadores externos:** ninguno.

### [4.5] ⚠️ PARCIAL — Historial de conversaciones

**Evidencia:** **existe y persiste** (`athos_messages`, con RLS por clínica; escritura en
`app/trace/logs.py:6-13`) y **se lee, pero sólo como memoria del LLM**
(`load_thread`, `chat.py:193`, últimos 8 turnos). **No es consultable por el veterinario**:
`asistente/assistant.tsx:195-199` monta `useChat` **sin `initialMessages`** y sin consultar
`athos_messages`. Al recargar la página el hilo se ve vacío aunque los mensajes estén en la base. La
consulta general (sin paciente) no tiene memoria alguna. El historial de WhatsApp sí es consultable,
acotado a 100 mensajes sin paginación.
**Gap:** falta la superficie de lectura (precargar el hilo en el server component), un selector de
conversaciones y paginación. **El dato está guardado y es recuperable.**
**Esfuerzo estimado:** 1,5–2 días.

### [4.6] ⚠️ PARCIAL — Transcripción de consultas (1 de 3 defectos corregido)

**(a) Roles invertidos — ✅ CORREGIDO (2026-07-29, commit `05d1bd0`).** El rol ya no se supone: se
**infiere del contenido** en `app/speaker_roles.py`, determinístico y sin LLM. En español hay
marcadores confiables — quien dice "doctor" o "mi perro" es el dueño; quien dice "vamos a palpar",
"voy a revisarlo" o pide un hemograma es el clínico. Se puntúa el texto completo de cada hablante
para que un marcador aislado no decida por todo el diálogo, y **cuando no hay señal suficiente no se
inventa**: se marca `role_inferred: false` para que la UI pueda ofrecer el intercambio manual.
Verificado contra producción (`scripts/calidad/transcripts_reetiquetar.py`, dry-run): de las 5
transcripciones con segmentos, **1 estaba invertida** y la corrección es evidente al leerla.
⏳ **El backfill NO se ejecutó** — modifica datos clínicos existentes y requiere autorización; el
script queda con dry-run por defecto. 11 tests nuevos.

*Diagnóstico original:* `app/transcription.py:29` tenía:
`SPEAKER_LABELS = {0: "Veterinario", 1: "Titular"}`, con el comentario que lo admite: *"Deepgram
devuelve índices de hablante, no roles. Asumimos que el hablante 0 es el veterinario"*. Deepgram
asigna `speaker 0` a **quien habla primero**, y en consulta real el titular suele abrir ("Doctor, mi
perro…"): **todo el diálogo queda invertido**. Peor, la etiqueta se **hornea como texto** en
`render_full_text` (`:118-122`) y se persiste en `transcripts.full_text`, así que no se puede
corregir en lectura. **No existe UI para intercambiar roles.** Defecto adicional:
`src/lib/transcript.ts:21` atribuye al titular toda línea sin prefijo.
*El dato crudo es recuperable desde `transcripts.segments`, así que el backfill es posible.*
**(b) Es por lotes, no en tiempo real.** `transcription.py:69-87` hace un POST único al endpoint
pre-recorded sobre el audio ya completo. No hay WebSocket ni streaming. `config.py:64` lo declara
("batch + diarización").
**(c) Fecha incorrecta por zona horaria — ✅ CORREGIDO (2026-07-29, commit `22f2cf1`).** El defecto
era real: `toLocaleDateString("es-CO")` **sin `timeZone`** en server components, que corren en UTC en
Vercel, así que una consulta de las 19:00 en Bogotá se mostraba **con la fecha del día siguiente**.
Afectaba **tres** pantallas, no dos: el listado de consultas, la ficha del paciente (donde además
corría la hora 5 h) y **las próximas citas del dashboard**. Se centralizó en `src/lib/date-utils.ts`
(`bogotaDate`, `bogotaDateTime`, junto a las que ya estaban ancladas) y los tests fuerzan
`process.env.TZ = "UTC"` para reproducir Vercel: si alguien vuelve a formatear sin `timeZone`, fallan.
Los componentes de WhatsApp, historial y adjuntos usan la zona del navegador porque son *client
components* — correcto, y se dejaron así.
**Esfuerzo estimado:** (a) 1–1,5 días + 2 h de backfill; (b) 4–6 días si se exige tiempo real;
(c) 3–4 h. **Total 6–8 días.** **Bloqueadores externos:** ninguno (Deepgram ya soporta streaming).

### [4.7 / 4.8 / 4.9] ❌ NO EXISTE como componente operando — Facturación / Cartera / Inventario

**Evidencia:** **69 archivos** de dominio y **25 tablas** en 1.968 líneas de SQL, contra
**0 archivos de UI**. Las rutas `/dashboard/facturacion`, `/cartera`, `/inventario`, `/catalogo`,
`/compras` **no existen** (inventario completo de `dashboard/`: asistente, ayuda, calendario,
comunicaciones, consultas, owners, patients, settings). El sidebar **no tiene ninguna entrada**.
19 `revalidatePath` apuntan a rutas inexistentes.
**El propio equipo lo declara**, y hasta el título del merge lo dice: commit `594f9f3` — *"motor de
facturacion y cartera (port multi-tenant, **sin UI**)"*.
Es el caso textual de la regla del Otrosí 2.3: **esquema de base de datos sin interfaz. No cuenta.**
**Esfuerzo estimado:** **5–7 semanas** de UI + 3–5 días para sustituir `xlsx` + 1 día para separar la
cuota de cartera de la del asistente clínico.
**Bloqueadores externos:** habilitación ante la **DIAN** — el proveedor fiscal actual es un
**sandbox** (`src/lib/facturacion/fiscal/sandbox.ts`). Sin proveedor homologado no hay emisión con
validez fiscal. Trámite de semanas a meses.

### [4.10] ✅ CONFIRMADO — La afirmación del cliente es correcta

**Evidencia (fechas de Git):** el último commit del 28-jul en `master` es `06accc6`
(**2026-07-28 20:13:50 -05:00**). Las migraciones `0033`–`0036` y todo el código de facturación
entraron con `b02ac21` y `bd005fa`, **autoría 2026-07-29 09:39–09:40 -05:00**, mergeados a `master`
entre las **10:19 y 10:31 del 29-jul**. Ninguno de los 78 archivos de esos dos commits es de UI.
Además, el propio `ESTADO.md:262-264` documenta que **las tablas se aplicaron directamente a
producción por MCP la noche del 28-jul**, después de la entrega — *"el esquema vive en producción
desde antes que el código que lo usa"*. La rama se llama `feat/facturacion-28jul` pese a haberse
creado y mergeado el 29, y las migraciones fueron renumeradas el 29-jul, por lo que su numeración
actual no refleja un orden histórico previo a la entrega.
**Conclusión: ni el esquema ni el código de facturación/cartera/inventario existían en el repositorio
al momento de la entrega del 28 de julio.**

---

## 5. Capa agéntica — ⚠️ 70 %

### [5.1] ⚠️ PARCIAL — Qué acciones ejecuta el chatbot sobre la plataforma

**Evidencia:** **17 tools** en `src/lib/athos-agent/tools.ts:37-482`. **10 de lectura**:
`search_patients`, `get_patient_summary`, `get_owner_by_phone`, `list_appointments_on_day`,
`get_clinic_hours`, `list_available_slots`, `search_whatsapp_conversation`, `search_consultations`,
`get_consultation_details`, `search_clinical_evidence` (esta llama a nuestro `POST /athos/retrieve`).
**7 de escritura, y las 7 sólo PROPONEN**: `send_whatsapp_message`, `create_appointment`,
`update_appointment`, `create_owner`, `create_patient`, `create_owner_and_patient`,
`update_patient_record`.

**El diseño de aprobación es riguroso y verificable:** toda escritura inserta una fila en
`athos_actions` con `risk:"approval"` **hardcodeado** (`actions.ts:48`) — no hay ningún camino de
auto-aprobación. La ejecución corre **bajo la sesión del veterinario que aprueba**
(`execute/route.ts:26-30`), así que la RLS ve el `auth.uid()` real, sin impersonación. Hay reserva
atómica compare-and-set contra doble clic (`execute/route.ts:55-65`), expiración de propuestas y
auditoría en `audit_logs`. Cobertura del dispatch: 7/7 sin huecos.
**Gap:** (a) `payload_override` no se revalida contra el esquema Zod del tool al aprobar
(`execute/route.ts:48-49`); (b) **el agente nunca se abstiene**: su tool y su prompt cuelgan la
abstención de `passed`, que está saturado — el backend ya expone `evidence_level` desde el
2026-07-29 y el front todavía no lo usa; (c) 2 de 10 tools de lectura no tienen etiqueta en la UI y
muestran el nombre crudo en inglés al veterinario.
**Esfuerzo estimado:** 6–10 h.

### [5.2] ✅ CUMPLE — El chatbot es agéntico

**Evidencia:** hay **tres superficies de chat** y dos son agénticas:

| Superficie | Motor | ¿Tools? |
|---|---|---|
| `/dashboard/asistente` | `/api/athos/agent` (Next, AI SDK, `stepCountIs(8)`) | **sí, las 17** |
| Botón "Sugerir" de la bandeja de WhatsApp | `/api/athos/suggest-reply` | **sí, las 17** |
| Chat dentro de la consulta | `athos-service` `POST /athos/chat` (SSE) | no — RAG puro, por diseño |

**Gap:** `POST /athos/whatsapp/suggest` y su cliente `athosWhatsappSuggest` quedaron **sin llamadores**
(la bandeja migró al agente de Next). Código muerto en ambos lados. **Esfuerzo:** 1 h.

---

## 6. Formalidades de entrega — ❌ 30 %

### [6.1] ❌ NO EXISTE — Inventario de componentes (exigido por el Otrosí, num. 2.1)

**Evidencia:** búsqueda exhaustiva por `*inventar*`, `*entrega*`, `*COMPONENTES*`, `*milestone*`,
`*acta*`, `*COT-2026*` en todo el repositorio: **ningún documento de entrega**. Los dos aciertos son
la migración de inventario de stock y una plantilla CSV para el veterinario.
**Gap:** no existe ningún artefacto que enumere los componentes entregados, los mapee contra las
cláusulas y declare el estado de cada uno. El sustituto de facto es `ESTADO.md` (309 líneas): un
handoff técnico honesto y detallado, pero organizado por tandas de trabajo y fechas de sesión, no por
entregable contractual, y sin firma, versión ni criterio de aceptación.
**Esfuerzo estimado:** 1–2 días (la materia prima existe dispersa).
**Bloqueadores externos:** el contratante debe fijar la plantilla del acta y quién firma.

### [6.2] ✅ CUMPLE — Accesos

**Evidencia:** repositorio, Supabase y Railway verificados y operativos en esta auditoría (se leyó la
base de producción y las 32 variables de Railway). **Gap:** confirmar acceso al panel de **Vercel**,
que es el único entorno que no se pudo auditar y donde viven las keys de IA del front y
`SUPABASE_SERVICE_ROLE_KEY`.

### [6.3] ✅ CORREGIDO en lo esencial (2026-07-29, commit `d6782eb`) — Documentación técnica

> Se cerraron los cuatro huecos que impedían que un dev nuevo trabajara: **`.env.example`** en la raíz
> (30 variables agrupadas, cada bloque con qué se rompe si falta; el `.gitignore` la excluía y se
> agregó la excepción), **`docs/ARQUITECTURA.md`** (las cuatro decisiones que explican el código, los
> cuatro clientes de Supabase y cuándo usar el que se salta la RLS, el ciclo de aprobación),
> **`docs/API.md`** (las 22 rutas con método, autenticación y uso de `service_role`, extraído del
> código) y el **`README.md`** reescrito (arranque real con el prerrequisito de Node ≥22.12, cómo
> verificar, mapa del repo y tabla de "si vas a tocar X, leé Y"). Los 17 enlaces internos verificados.
>
> ⏳ **Queda el manual de usuario**, que conviene esperar al rediseño de la ficha del paciente para no
> documentar pantallas que van a cambiar.

*Diagnóstico original:*

**Evidencia:** 19 documentos, ~3.100 líneas. Fuerte en backend y despliegue
(`tuvetia_rag_documento_final.md` 380 líneas de arquitectura del RAG, `SETUP.md` 358, `DEPLOY.md` 152,
`scripts/calidad/README.md` 451, `ESTADO.md` 309).

| Eje de la Cláusula 13 | Estado |
|---|---|
| Arquitectura | ⚠️ excelente para el RAG; **cero para el front** |
| API / endpoints | ⚠️ los 6 del backend con contrato cerrado; **las 22 rutas `/api/*` de Next sin documentar** |
| Despliegue | ✅ cubierto |
| Variables de entorno | ⚠️ `.env.example` sólo en el backend y desactualizado; **el front no tiene `.env.example`** |
| README de onboarding | ❌ el `README.md` raíz sigue siendo el **boilerplate de `create-next-app`** |
| Manual de usuario | ❌ no existe (lo más cercano: `/dashboard/ayuda`, 64 líneas) |

**Esfuerzo estimado:** 3–5 días.

---

## 7. Estándar global de aceptación (Cláusula 13) — ⚠️ 55 %

### [7.1] ⚠️ PARCIAL — Funcional: 326 tests reales, pero **el CI está INERTE**

**Evidencia:** **140 tests de backend** en 21 archivos (150 corriendo hoy, todos verdes, `ruff`
limpio) que cubren las reglas duras: gate de alergia, gate de dosis, procedencia de citas,
aislamiento cross-tenant. **186 tests del front** en 21 archivos, **todos de facturación/cartera**.

> 🔴 **Hallazgo principal: ninguno de los 326 corre automáticamente.** Existe un único workflow,
> `athos-service/.github/workflows/ci.yml`, pero **no hay `.github/` en la raíz del monorepo** y
> `athos-service/` no es un repositorio propio. GitHub Actions sólo lee `.github/workflows/` de la
> raíz: **el workflow nunca se registró**. Los PRs se mergearon a `master` sin ninguna gate
> automática, y el `ruff check` tampoco corre.

**Gap adicional:** **cero tests de la capa agéntica** — las 17 tools, `proposeAction` y el
compare-and-set del ciclo de aprobación no tienen un solo test, siendo el código que escribe en la
historia clínica y manda WhatsApp a clientes reales. No existe Playwright ni ningún e2e. Y los 186
tests del front cubren el único módulo **sin UI**: lo único testeado del front es lo único que el
usuario no puede usar.
**Esfuerzo estimado:** 3–4 h mover el CI a la raíz; 1–1,5 días tests de tools; 1 día smoke e2e.
**Bloqueadores externos:** el job de backend necesita secretos de Supabase dev en GitHub Actions.

### [7.2] ❌ NO CUMPLE (facturación/cartera) — Integrada

**Evidencia:** el módulo de facturación/cartera son **52 archivos** `.ts` en 11 subdirectorios, con
**186 tests que pasan**, y el **esquema ya aplicado en producción** (migraciones `0033`–`0036`,
28-jul). Pero:
- **50 llamadas a `revalidatePath` apuntan a 7 rutas que no existen** (`/dashboard/facturacion`,
  `/cartera`, `/inventario`, `/catalogo`, `/compras`, `/compras/proveedores`, `/finanzas`).
  `revalidatePath` sobre una ruta inexistente no lanza error: son no-ops permanentes.
- **Cero componentes** lo importan, **cero enlaces** apuntan a él, **cero páginas** existen.
- Único consumidor vivo: el cron `/api/cron/cartera`, que hoy devuelve **503** por falta de
  `CRON_SECRET`.

Está reconocido en `ESTADO.md:280-281`: *"el motor está completo y testeado, pero
`/dashboard/facturacion/*` no existe. Hoy el módulo es inalcanzable desde la app."`
**Es el hallazgo más grave bajo el Otrosí 2.3:** un módulo completo con esquema en producción,
íntegramente inalcanzable.
**Nota a favor:** el sidebar **no tiene ningún enlace roto** — las 9 entradas resuelven (auditadas
contra las 26 páginas reales).
**Esfuerzo estimado:** 8–12 días la UI completa; **o 2 h** para retirarlo formalmente del alcance del
milestone y documentarlo como diferido.
**Bloqueadores externos:** `xlsx@0.18.5` (prototype pollution + ReDoS) **sin fix en npm** corre
server-side en el import de facturación — hay que resolverlo antes de exponer el módulo.

### [7.3] ⚠️ PARCIAL — Documentada. Ver 6.3.

### [7.4] ⚠️ PARCIAL — Apta para validación con usuarios reales

**5 bloqueadores duros, y tres se resuelven en ~2 horas de configuración:**

1. 🔴 **`SUPABASE_SERVICE_ROLE_KEY` pendiente en Vercel Production** → `src/lib/supabase/admin.ts:9-13`
   **lanza excepción** si falta, y `proposeAction` no captura ese throw: **las 7 tools de escritura y
   todo el ciclo de aprobación fallan en caliente**. *(15 min de config + 1 h para degradar con
   gracia.)*
2. 🔴 **`CRON_SECRET` ausente** → los dos crons devuelven 503 y con ellos muere
   `/api/cron/purge-audio`: **se incumple la retención de audio a 4 días de la Ley 1581** con
   grabaciones de consultas reales. Exposición legal desde el día 1. *(15 min.)*
3. 🔴 **Login puede fallar en silencio**: el template "Magic Link" de Supabase sigue con
   `{{ .ConfirmationURL }}` (PKCE) en vez de `{{ .SiteURL }}/auth/confirm?token_hash=...`, y el Site
   URL no se revisó tras mover el login a `/login`. Un design partner que no puede entrar no evalúa
   nada. *(1–2 h de config.)*
4. **Facturación/cartera inalcanzable** (7.2) — bloqueador sólo si facturar está en el alcance.
5. **`xlsx` vulnerable server-side** — bloquea exponer facturación.

**6 riesgos clínicos / de confianza:** el auditor de fidelidad de citas apagado (§2.3); el agente que
nunca se abstiene (§5.1); ~~la cobranza que agota la cuota diaria del asistente clínico y lo deja
mudo~~; ~~respuestas duplicadas de WhatsApp por reintento de webhook~~; cartera que se queda con
mensajes que no son de cobranza; y el riesgo de baneo del número por usar Evolution API (protocolo no
oficial), con el trámite Meta Tech Provider pendiente.

> ✅ **Cerrados el 2026-07-29 a las 16:47** (commit `a64cfdc`, mergeado en `c848e28`): los dos riesgos
> tachados. La cuota del modo auto ahora se cuenta sobre `athos_actions` con `source='auto'`, que
> cartera no toca, así que **cada subsistema gasta la suya**; y la idempotencia del entrante pasó a
> compare-and-set con la columna nueva `whatsapp_messages.auto_reply_claimed_at` (migración `0038`),
> de modo que un reintento del webhook **ya no puede provocar una segunda respuesta al titular**. Es
> el mismo patrón que se usó en las acciones de Athos.
>
> **Nota de numeración:** la próxima migración disponible es la **`0039`** (`0037` fue el fix de la
> policy de logos y `0038` esta reserva del modo auto).

---

## Resumen ejecutivo

### Cumplimiento por sección

| § | Sección | Cumplimiento | Estado |
|---|---|---|---|
| 1 | Integración IA completa | **45 %** | ⚠️ Gemini inexistente; cascada inexistente; routing estático |
| 2 | Chatbot sin alucinaciones + LLM Harness | **60 %** | ⚠️ harness sólido; citas y smoke testing abiertos; latencia OK |
| 3 | Base de conocimiento veterinaria | **85 %** | ✅ corpus completo e indexado |
| 4 | Componentes presentados pero no operando | **25 %** | ❌ de 9 componentes: 0 cumplen, 4 parciales, 5 no cuentan |
| 5 | Capa agéntica | **70 %** | ⚠️ existe y es rigurosa; no se abstiene |
| 6 | Formalidades de entrega | **30 %** | ❌ sin inventario de componentes |
| 7 | Estándar global (Cláusula 13) | **55 %** | ⚠️ CI inerte; facturación inalcanzable |

**Cumplimiento global ponderado: ≈ 50 %.** Las tres secciones más débiles (§4 con 25 %, §6 con 30 %
y §1 con 45 %) concentran el riesgo contractual. Las dos más fuertes (§3 con 85 % y §5 con 70 %) son
precisamente las que se construyeron con medición y evidencia.

**Observaciones del cliente que esta auditoría CONFIRMA:** el correo no existe (§4.3), la
transcripción tiene los roles invertidos y es batch (§4.6), las invitaciones fallan (§4.4),
facturación/cartera/inventario son esquema sin interfaz (§4.7-4.9), las tablas aparecieron después de
la entrega (§4.10), la abstención no disparaba (§2.2) y hay citas que no corresponden (§2.3).

**Observación del cliente que esta auditoría NO reproduce:** las latencias de ~5 minutos (§2.6). Hoy
medido: **12,8 s hasta el primer token y 27,6 s de respuesta completa** (mediana, medición pesimista
desde fuera del datacenter). La causa probable del reporte original es que el Tier 1 del retrieval
tardaba 15.397 ms de servidor y **se cancelaba por `statement_timeout`**, lo que se percibe como
cuelgue; se corrigió el 28-jul a 143 ms.

### Gaps priorizados

**P0 — configuración, horas de trabajo, desbloquean uso real (hacer ya):**
1. `SUPABASE_SERVICE_ROLE_KEY` en Vercel Production — sin ella la capa agéntica de escritura no
   funciona (15 min).
2. `CRON_SECRET` en Vercel — restablece la purga de audio y la retención de Ley 1581 (15 min).
3. Template Magic Link + Site URL en Supabase Auth — el login puede fallar en silencio (1–2 h).
4. Mover el CI a `.github/workflows/` en la raíz — hoy **326 tests no corren nunca** (3–4 h).

**P1 — críticos para la calidad clínica que exige el contrato (días):**
5. Calibrar y encender el auditor de fidelidad de citas (§2.3) — 2–3 días.
6. Que el agente use `evidence_level` en vez de `passed` para abstenerse (§5.1) — 2–3 h.
7. Agent smoke testing + su documento de resultados (§2.4) — 2–3 días.
8. Revalidar `payload_override` al aprobar una acción (§5.1) — 3 h.

**P2 — cumplimiento contractual de la cláusula de IA (requiere insumos externos):**
9. Integrar Gemini (§1.1) — 3–5 días. **Bloqueado por**: cuenta Google con crédito.
10. Lógica de cascada entre los 3 proveedores (§1.4) — 3–5 días. **Bloqueado por**: las 3 cuentas
    activas simultáneamente.
11. Routing dinámico por consulta (§1.5) — 2–4 días.
12. Pruebas comparativas entre modelos (§2.5) — 1–2 días **después** de 9 y 10.
13. `ANTHROPIC_API_KEY` en Railway para que Claude opere también en el backend (§1.3) — 1–2 h.

**P3 — formalidades y documentación (días):**
14. Inventario de componentes firmado (§6.1) — 1–2 días.
15. Documentación del front: arquitectura, referencia de las 22 rutas de API, `.env.example`, README
    de onboarding (§6.3) — 3–5 días.
16. Manual de usuario (§6.3) — 1–2 días.
17. Versionado de prompts persistido en la traza (§1.6) — 1–2 días.

**P1-bis — defectos de plataforma que el cliente ya reportó (días, sin bloqueadores):**
8-a. Invitaciones de equipo: apuntar `redirectTo` a `/auth/callback?next=…`, corregir la plantilla de
     Supabase, añadir `signOut` en "cambiar de cuenta" (§4.4) — 4–6 h + 30 min de config.
8-b. Transcripción: derivar el rol desde `transcripts.segments` en vez de hornear la etiqueta, control
     de intercambio en la UI y backfill de los transcripts ya emitidos (§4.6a) — 1,5 días + 2 h.
8-c. Fechas: anclar todo el formateo a `America/Bogota` (§4.6c) — 3–4 h. **Es el arreglo de mejor
     relación costo/impacto de toda la lista.**
8-d. Historial de conversaciones consultable por el veterinario (§4.5) — 1,5–2 días.
8-e. Que las citas creadas por el agente lleguen a Google Calendar (§4.1) — 4 h.

**P4 — decisión de alcance:**
18. UI de facturación/cartera/inventario (§4.7-4.9, §7.2) — **5–7 semanas** (no 8–12 días: son 25
    tablas y 7 módulos) **o** retirarlo formalmente del alcance del Milestone 2 (2 h).
    **Requiere decisión del cliente.** Sin habilitación DIAN no hay emisión con validez fiscal de
    todos modos: el proveedor fiscal actual es un sandbox.
19. Reemplazar `xlsx` (§7.2) — 3–5 días. **Bloqueado por**: no hay fix en npm.
20. Definición por escrito de "estructura de skills" (§1.7) — es la diferencia entre 1 día y una
    reescritura.
21. Correo electrónico / Gmail (§4.3) — 6–9 días. **Bloqueado por**: verificación de dominio; y
    revisión de Google de semanas a meses si se exige la API nativa de Gmail.
22. Google Calendar bidireccional automático (§4.1) — 3–4 días + verificación de Google (~10 días).
23. WhatsApp embebido oficial (§4.2) — 1–2 días técnicos, pero **el trámite ante Meta son 2–6
    semanas: no cabe antes del 17 de agosto**.

### Subsanable antes del 17 de agosto vs. renegociación

Del 30 de julio al 17 de agosto hay **13 días hábiles**.

**Subsanable con el equipo actual (cabe en el calendario):**
- Todo **P0** — medio día, y es lo que separa "no arranca" de "arranca".
- Todo **P1** y **P1-bis** — ~2 semanas de una persona; incluye los defectos que el cliente ya
  reportó (invitaciones, roles de la transcripción, fechas, historial).
- **P3** (inventario + documentación) — ~1 semana en paralelo, por otra persona.
- De P2: el ítem 13 (`ANTHROPIC_API_KEY` en Railway, 1–2 h) y el 20 (definición de "skills").

Con eso, §2 llega a ~90 %, §4 a ~65 %, §5 a ~95 %, §6 a ~90 % y §7 a ~80 %.

**NO subsanable antes del 17 de agosto — requiere renegociación de alcance o cronograma:**

| Ítem | Por qué no cabe |
|---|---|
| **Gemini + cascada + routing + comparativas** (§1.1, 1.4, 1.5, 2.5) | 10–15 días de trabajo **más** una cuenta Google con crédito y crédito de producción de Anthropic. Es la mayor concentración de incumplimiento y **no depende sólo de esfuerzo**. Cabe sólo si las cuentas están disponibles el 1 de agosto y se dedica una persona en exclusiva |
| **WhatsApp embebido oficial** (§4.2) | El App Review + Access verification de Meta son **2–6 semanas** de trámite de un tercero. Alternativa: aceptar formalmente Evolution (no oficial) documentando el riesgo de baneo del número del cliente |
| **UI de facturación/cartera/inventario** (§4.7-4.9) | **5–7 semanas.** Y sin habilitación DIAN no habría emisión con validez fiscal igual (hoy el proveedor es un sandbox). **Si se mantiene en el Milestone 2, es incompatible con el calendario y compite por los mismos días que los P0/P1 de calidad clínica** |
| **Correo electrónico / Gmail** (§4.3) | 6–9 días de trabajo + verificación de dominio; y si se exige la API nativa de Gmail, la revisión de Google por scopes restringidos lleva de semanas a meses |
| **Google Calendar bidireccional real** (§4.1) | 3–4 días técnicos, pero la verificación de Google para abrirlo al público son ~10 días. Ajustado, no imposible |
| **`xlsx` sin fix upstream** (§7.2) | Decisión de arquitectura (CDN de SheetJS, migrar a `exceljs`, o mover el parseo al cliente) |

**Recomendación para la reunión de renegociación del 3 de agosto:** llevar tres decisiones cerradas —
(1) si facturación/cartera/inventario sale del Milestone 2 o el hito se mueve; (2) si se acepta
Evolution como transporte de WhatsApp mientras corre el trámite de Meta, con el riesgo documentado y
firmado; y (3) si el cliente provee la cuenta de Google y el crédito de Anthropic esta semana, porque
sin eso la cláusula de integración de IA no se puede cerrar por más esfuerzo que se le dedique.

### Nota sobre la calidad de ingeniería, en honor a la evidencia

Los gaps de este informe son mayoritariamente de **cierre de integración, mecanización y formalidades
de entrega**, no de calidad del núcleo. Lo que está construido está construido con rigor poco común:
el ciclo "Athos propone / el veterinario aprueba" no tiene atajos de auto-aprobación, ejecuta bajo la
sesión del aprobador sin impersonación y protege contra doble ejecución con compare-and-set; las
reglas clínicas duras (gate de alergia severa, gate de dosis) están impuestas por código y cubiertas
por tests, no confiadas al prompt; y las mediciones adversas están documentadas en el propio
repositorio, incluidas las features que se dejaron apagadas por no estar calibradas. Ese estándar es
el que hace que esta auditoría haya podido hacerse con evidencia verificable en lugar de con
declaraciones.
