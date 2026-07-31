# Soportes técnicos para la renegociación del 3-ago — respuesta punto por punto

**Contrato:** COT-2026-TUV-001 · **Corte:** 2026-07-31, 12:40 · **Commit:** `877d964`
**Responde a:** *Guía de soportes técnicos — Milestone 2 TUVET IA*

Todo lo de abajo se verificó hoy contra el **repositorio**, las **variables reales de Railway y
Vercel** y la **base de datos de producción**. Donde no hay evidencia, se dice que no la hay.

---

## ⚠️ Léase esto antes que nada: dos premisas de la Guía son falsas

La Guía parte de dos supuestos internos que **la evidencia no sostiene**. Ir a la mesa con ellos
sería peor que no ir, porque son exactamente los datos que el cliente puede verificar solo.

### 1. «La cascada con Gemini corre hace meses» — **es imposible**

| Hecho | Evidencia |
|---|---|
| El repositorio **completo** nació el **2026-07-13** | `cca7b87` — primer commit: *"Athos: entorno base del servicio"* |
| `provider_cascade.py` se creó el **2026-07-30 09:58** | `2303731` — *"Gemini integrado y cascada entre proveedores — **inerte hasta que se configure**"* |
| **Todas** las menciones a Gemini en la historia son del **2026-07-30** | `git log -S "gemini"` no devuelve nada anterior |

El proyecto tiene **17 días**. No hay forma de que algo lleve meses corriendo.

**La acusación del cliente del 29-jul era correcta:** a esa fecha Gemini **no estaba** en el
repositorio ni en las variables de entorno, y no existía cascada.

### 2. «Hay logs de consultas ruteadas a modelos distintos» — **no existen**

Traza real de producción (`rag_answer_log`, la tabla que registra el modelo de cada respuesta):

| Modelo | Consultas | Periodo |
|---|---|---|
| `deepseek-chat` | 11 | 24-jul |
| `deepseek-v4-flash` | 5 | 24-jul → 29-jul |
| **Gemini** | **0** | — |
| **Claude** | **0** | — |

**16 respuestas en toda la vida del sistema, todas de DeepSeek.** La afirmación del cliente —*"solo
corre DeepSeek"*— es **literalmente cierta** mirando la traza.

> **Lo que sí se puede defender, y es distinto:** la cascada **existe y funciona desde hoy**,
> verificada contra los tres proveedores reales forzando caídas. Que no haya fallbacks en la traza
> es coherente: una cascada de respaldo sólo se activa cuando el primario falla, y no falló. Pero
> eso hay que decirlo así — «funciona, probado, sin tráfico que lo haya ejercitado» — no como
> «corre hace meses».

**Recomendación:** reconocer el gap con fecha (`2026-07-30`) y presentar la cascada como
**subsanación entregada**, no como algo preexistente. Es defendible: se cerró en 24 h desde la
observación. Sostener «hace meses» se cae con un `git log`, y la propia Guía pide la fecha del commit.

---


---

## 🔄 Revisión del 2026-07-31 — qué cambió en 15 horas

29 commits después (Felipe, Santiago y esta sesión), re-verificado contra el repositorio, las
variables reales de Vercel y Railway, y la base de producción.

**Lo que cambió y MEJORA la posición:**

| | Antes (30-jul) | Ahora (31-jul) |
|---|---|---|
| Google Calendar | 0 cuentas conectadas, sincronización sin credenciales | **2 cuentas · 11.550 de 11.566 citas sincronizadas** |
| Configuración de producción | faltaban 3 variables críticas | falta **una** (`PLATFORM_ADMIN_EMAILS`) |
| Pruebas de aislamiento entre clínicas | **nunca corrían** (se auto-skipeaban) | corren en CI, con dos fuentes de base |
| Entorno de desarrollo | **borrado** — por eso el `.env` apuntaba a producción | recreado (`gdiiagioiukadifejewv`) |
| Pruebas totales | 488 | **585** (258 backend + 327 front) |
| Acciones agénticas ejecutadas | 1 | 2 |

**Lo que NO cambió, y sigue siendo el punto delicado de la mesa:**

La traza de producción sigue mostrando **16 respuestas, todas de DeepSeek**. Cero de Gemini, cero de
Claude. La cascada está configurada con los tres proveedores en Railway y ahora además **registra
cuál respondió de verdad** (`ca31838`, antes anotaba `LLM_MODEL` fijo) — pero no ha habido tráfico
que ejerza el fallback, porque el primario no ha fallado.

Sigue valiendo lo dicho arriba: **es defendible como "funciona, probado, sin tráfico que lo haya
ejercitado"; no como "corre hace meses"**. El repositorio nació el 13-jul y la cascada es del 30-jul.

**Un hueco nuevo, chico y visible:** falta `PLATFORM_ADMIN_EMAILS` en Vercel. `/api/health` responde
`ok: false` y **el workflow Smoke E2E está en rojo por eso y sólo por eso**. Un minuto de trabajo, pero
conviene cerrarlo antes de que alguien audite y vea un workflow rojo.

**Y una fuga que se encontró y cerró hoy:** al endurecerse el guardarraíl anti-red aparecieron 7
pruebas llamando a APIs reales (el auditor de fidelidad de citas y el reranker). En CI no se veía
—no hay claves— pero **en la máquina de cualquier desarrollador la suite gastaba crédito en cada
corrida**. Cerrado en `877d964`.

## Lo que NO está en mi alcance y hay que conseguir aparte

| Soporte | Dónde está | Estado |
|---|---|---|
| **Anexo A (Cotización COT-2026-TUV-001)** | administración / comercial | ❌ **no está en el repositorio** |
| Transcripts Fathom (56, 35 y 22 min) | cuenta de Fathom | ❌ no están en el repositorio |

**Toda la Prioridad 3 depende del Anexo A**, que es justamente lo que decide qué era exigible. Sin
él, lo único que puedo aportar de esos módulos son **fechas y estado técnico** — no si estaban
contratados. Abajo doy las fechas, que es la mitad que sí puedo cerrar.

---

# PRIORIDAD 1 — La cascada de 3 modelos

```
[P1]
Estado: FUNCIONA EN PROD (desde 2026-07-30) — NO preexistente
Soporte: ver tabla de abajo
¿En Anexo A?: Sí — es entregable explícito del Milestone 2 (Cláusula Quinta)
Esfuerzo de subsanación: hecho
Bloqueador externo: ninguno
```

| Lo que pide la Guía | Respuesta |
|---|---|
| **Ruta del router/cascada** | `athos-service/app/generation/provider_cascade.py`. ⚠️ **No confundir con `app/retrieval/cascade.py`**, que es la cascada de *recuperación de documentos* y no prueba nada de esta cláusula. |
| **Variables de PRODUCCIÓN con las 3 keys** | Railway (`athos-service`): `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_API_KEY` (DeepSeek) — **las tres presentes**. Más `LLM_CASCADE_REDACCION`, `LLM_CASCADE_LIVIANO`, `LLM_CASCADE_DIFICIL` configuradas. |
| **Claude con key de producción, no el crédito de USD 10** | La key de Anthropic en Railway es la que entregó el cliente el 30-jul indicando que «ya tiene créditos». **No tengo forma de auditar el saldo desde acá**: hay que sacar captura del panel de Anthropic. **Pendiente de ustedes.** |
| **Logs de consultas ruteadas a modelos distintos** | ❌ **No existen.** Ver arriba: 16 respuestas, todas DeepSeek. |
| **Fecha del commit** | **2026-07-30 09:58** (`2303731`), ampliado a los tres modelos en `5cd027b` y routing por consulta en `a507043` (13:15). |
| **SDK de Gemini en dependencias** | **No hay SDK dedicado, y es correcto**: Gemini entra por su endpoint compatible con OpenAI, igual que DeepSeek. El cliente se inicializa en `app/generation/llm_client.py` (provider `google`). Que no aparezca `google-generativeai` en `requirements.txt` **no** significa que Gemini no esté. |

### La evidencia que sí es fuerte: la prueba de caída forzada

Medida hoy contra los tres proveedores **reales**, no simulados:

| Escenario | Quién responde | Latencia |
|---|---|---|
| Camino feliz | DeepSeek | 1,4 s |
| Primario caído | **Gemini** | 3,9 s |
| Primario y secundario caídos | **Claude** | 3,7 s |

Documentado en `docs/COMPARATIVA-MODELOS-2026-07-30.md`.

**Routing en dos niveles:** por **tarea** (redacción vs. liviano) y por **consulta** — cuando el juez
de evidencia dictamina cobertura `limited`, la nota escala al modelo que mide mejor en fidelidad.

---

# PRIORIDAD 2 — Gaps reales del hito

## 2.1 Abstención — el «0 de 187»

```
[2.1]
Estado: FUNCIONA EN PROD (corregido y medido hoy)
Soporte: docs/ABSTENCION-MEDICION-2026-07-30.md · app/generation/evidence_judge.py
¿En Anexo A?: Sí — es el entregable "sin alucinaciones"
Esfuerzo de subsanación: hecho
Bloqueador externo: ninguno
```

**¿El 0/187 era real?** **Sí, y no era un error de redacción.** La causa: el umbral determinístico
está **saturado**. Medido sobre 187 casos:

| Señal | Casos con literatura | Casos sin literatura |
|---|---|---|
| Score determinístico | 1.701 | 1.700 |
| Score del reranker | 0,532 | 0,499 |
| Nº de citas verificadas | 6,0 | 6,0 |

**Ninguna señal gratuita distingue cobertura real de plausibilidad temática.** En un corpus de 520.000
fragmentos siempre hay algo que *suena* parecido. Por eso hacía falta **leer** los pasajes.

**Qué se hizo:** un juez semántico que lee la literatura recuperada y dictamina en bandas
(`ninguna` / `limitada` / `suficiente`), **más** una corroboración determinística que cruza el
veredicto con un hecho comprobable: ¿algún pasaje recuperado está indexado con el descriptor MeSH de
la consulta, o con uno que cuelgue de él?

**Resultado medido sobre los 188 casos, contra producción:**

| | seguridad | utilidad |
|---|---|---|
| Antes | 82,4 % | 63,3 % |
| **Ahora** | **92,6 %** | **65,5 %** |
| Mitad del banco **no usada para elegir la regla** | **94,5 %** | 67,1 % |

Y contra el reclamo original: de 188 consultas, hoy **103** se responden normal, **82** con aviso
explícito de evidencia limitada y **3** con abstención. **Ya no es 0.**

⚠️ **Advertencia para la mesa:** el instrumento de medición anterior estaba mal. El banco etiquetaba
*«¿el corpus contiene el descriptor?»* y la abstención decide *«¿los pasajes recuperados cubren la
consulta?»* — coinciden sólo en ~74 %. Cualquier cifra anterior a hoy medía en parte el etiquetado.
La medición nueva es **reproducible con un comando** por quien quiera auditarla.

## 2.2 Agent smoke testing

```
[2.2]
Estado: FUNCIONA EN PROD
Soporte: docs/AGENT-SMOKE-TESTING.md · 22 casos corriendo en CI
¿En Anexo A?: Sí — entregable explícito del M2
Esfuerzo de subsanación: hecho
Bloqueador externo: ninguno
```

**¿Existían?** No como documento entregable. **Ahora sí**, y encontraron un defecto real que estaba
en producción: **corrupción silenciosa de fechas** — `2026-02-30` se agendaba el 2 de marzo sin
avisar. Ese hallazgo es el mejor argumento de que la suite sirve y no es un trámite.

**Y el ciclo agéntico completo se verificó hoy en producción:** Athos propuso una cita → apareció la
tarjeta de aprobación → el veterinario aprobó → quedó `status: executed` con
`appointment_id: 474b353a-…`.

⚠️ **Dato incómodo que conviene tener listo:** en producción hay **una sola** acción agéntica
ejecutada en toda la historia. Si preguntan por volumen de uso, el número es 1.

## 2.3 Citas que no corresponden

```
[2.3]
Estado: FUNCIONA EN PROD
Soporte: app/generation/citations.py (procedencia) · citation_fidelity.py (fidelidad)
¿En Anexo A?: Sí — parte de "sin alucinaciones"
Esfuerzo de subsanación: hecho
Bloqueador externo: ninguno
```

**¿Sabemos por qué pasaba?** Sí, y **no era el ranking ni los embeddings**. Medido: **18 de 24
respuestas citaban al menos un pasaje que no respaldaba la afirmación.** El modelo redactaba desde su
propio conocimiento y «decoraba» con una referencia real pero que no venía al caso.

Hay **dos capas distintas** y conviene no mezclarlas:

| Capa | Qué garantiza | Estado |
|---|---|---|
| **Procedencia** (determinística) | la fuente mostrada existe y es la recuperada | ✅ **100 %, estructural** |
| **Fidelidad** (LLM) | además, el pasaje **sostiene** lo afirmado | filtro adicional |

**La procedencia es 100 % por construcción, no por estadística:** el modelo **no puede escribir una
fuente**. Sólo emite un número entre corchetes. Título, año, revista y enlace los reconstruye el
código desde el fragmento recuperado de la base. Inventar una fuente **no está representado en el
camino de datos**. Cubierto por pruebas en CI.

La segunda capa **sólo quita** referencias: su único error posible es ser demasiado estricta, nunca
mostrar una cita incorrecta.

## 2.4 Revisión de calidad interna de Plogy

```
[2.4]
Estado: NO IMPLEMENTADO (gap de proceso)
Soporte: no existe documento de revisión para el M2
¿En Anexo A?: Sí — "Plogy: equipo, consultoría y gestión"
Esfuerzo de subsanación: 2-4 h
Bloqueador externo: ninguno
```

**Es el único gap que no puedo cerrar yo**: es un acto de proceso (una revisión firmada por Plogy),
no código. Lo que sí existe hoy y sirve de insumo: `AUDITORIA-MILESTONE2-2026-07-29.md`,
`INVENTARIO-COMPONENTES.md`, `VERIFICACION-10-PUNTOS-2026-07-30.md` y este documento.

**Recomendación:** cerrarlo antes del 3-ago. Es barato y elimina un reclamo formal entero.

---

# PRIORIDAD 3 — Módulos presuntamente fuera de alcance

> ⚠️ **Sin el Anexo A no puedo decir si estaban contratados.** Doy fecha y estado técnico, que es lo
> que responde a la insinuación de «aparecieron después de la entrega».

## 3.1–3.3 Facturación · Cartera · Inventario

```
Estado: FUNCIONA EN PROD (UI completa)
¿En Anexo A?: NO SÉ — hace falta el Anexo A
Esfuerzo: no aplica
```

**Fechas exactas — esto responde la insinuación del cliente, y no nos favorece:**

| Qué | Cuándo | Evidencia |
|---|---|---|
| Tablas `0029_facturacion_core`, `0030_..._cartera`, `0031_..._catalogo_inventario`, `0032_..._compras_gastos` | **2026-07-29 03:16–03:18** | registro `supabase_migrations.schema_migrations` del proyecto principal |
| Código del núcleo fiscal | **2026-07-29 09:39** | commit `b02ac21` |
| UI completa (16 rutas) | **2026-07-30** | commit `bfd5150` |

**La insinuación del cliente es correcta en los hechos:** estas tablas se crearon el 29-jul de
madrugada, es decir **después del Otrosí (28-jul)**. No se puede sostener que existían antes.

Lo que sí se puede argumentar es **el alcance**: si no están en el Anexo A, son trabajo **no
contratado** que se hizo igual. Eso juega a favor — pero **sólo con el Anexo A en la mano**.

## 3.4 Google Calendar (sync bidireccional)

```
Estado: IMPLEMENTADO PERO INCOMPLETO
Soporte: migración calendar_integrations 2026-07-23 22:42 · calendar_feeds 2026-07-24 00:10
¿En Anexo A?: NO SÉ
Esfuerzo: 5 min (credenciales) + ~10 días (verificación de Google, tercero)
Bloqueador externo: SÍ — verificación de Google
```

| Dirección | Estado |
|---|---|
| Plataforma → Google | ✅ automático |
| Citas creadas por el agente | ✅ |
| Google → Plataforma | manual, con botón «Sincronizar» |

⚠️ **Faltan `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en Vercel.** Hoy `calendar_integrations`
tiene **0 filas**, y por eso no falla: la sincronización devuelve `null` antes de intentar nada. **El
día que alguien conecte Google, empezará a lanzar error.** Ponerlas antes de la demo.

## 3.5 Gmail / comunicaciones

```
Estado: FUNCIONA EN PROD
Soporte: migración 0039_email_integrations (2026-07-30 04:35) · src/lib/cartera/channels.ts
¿En Anexo A?: NO SÉ
Esfuerzo: no aplica
```

Envío por SMTP, lectura de respuestas por IMAP, hilos, credenciales cifradas, pantalla de conexión,
facturas por correo y recordatorios de cobranza. Cubierto por 8 pruebas.

**Sobre la disputa «Pipe dijo que Gmail estaba completo»:** la fecha de la migración es **30-jul
04:35**, o sea **posterior** a la reunión del 28-jul. En la reunión el módulo **no** estaba completo.
Si el transcript muestra a Pipe diciendo *«debería estar conectado»* (con duda), eso es **consistente
con los hechos** y conviene apoyarse en esa literalidad.

> Ojo: que el módulo esté completo **no** significa que una clínica lo haya conectado. Cada clínica
> conecta su cuenta desde `/dashboard/settings`.

## 3.6 WhatsApp embebido

```
Estado: IMPLEMENTADO, bloqueado por tercero
Soporte: migraciones whatsapp_integrations (2026-07-24 04:44), whatsapp_inbox (19:10),
         0028_whatsapp_evolution_provider (2026-07-28 23:00)
¿En Anexo A?: el CLIENTE admite que NO
Esfuerzo: no aplica
Bloqueador externo: SÍ — verificación de Meta (~6 semanas)
```

Hay **proveedor alternativo** implementado (Evolution) justamente para no depender de Meta. ⚠️ Faltan
en Vercel: `WHATSAPP_TOKEN_KEY` (**lanza al conectar**), `META_APP_ID`, `META_APP_SECRET`,
`NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_ES_CONFIG_ID`, `EVOLUTION_*`.

## 3.7 Invitaciones de equipo

```
Estado: FUNCIONA EN PROD (defecto encontrado y corregido HOY)
Soporte: commits 4a7f095 (hallazgo) y ac8fb8d (arreglo) · scripts/verificar_enlace_invitacion.py
¿En Anexo A?: NO SÉ
Esfuerzo de subsanación: hecho
```

**El cliente tenía razón: el enlace fallaba, y no era un bug puntual — eran cinco.**

Cuatro corregidos antes (de dos personas: `redirectTo` mal apuntado, origen del dominio efímero,
`/auth/signout` como GET que cerraba la sesión con el prefetch de un `<Link>`, y `?next=` vacío).

**Y un quinto encontrado hoy, que era el que de verdad rompía el caso del cliente:** quien recibía la
invitación y **no tenía cuenta** terminaba en el login. Causa: un enlace de correo lo inicia el
**servidor**, así que Supabase devuelve la sesión en el **fragmento** (`#access_token=…`), y el
fragmento **nunca viaja al servidor**. La ruta que lo recibía era de servidor: veía la petición sin
código y mandaba al login.

Corregido con `/auth/sesion`, una página cliente. Verificado contra producción.

⚠️ **Por qué no se había detectado:** la invitación de prueba se aceptó con un correo que **ya tenía
cuenta de Google** — llegaba con sesión y el fallo no aparecía. Es la trampa de verificación que
conviene mencionar si preguntan por qué se dio por cerrado antes.

## 3.8 Historial de conversaciones

```
Estado: FUNCIONA EN PROD
Soporte: src/lib/athos-history.ts · /dashboard/asistente
¿En Anexo A?: NO SÉ
Esfuerzo: no aplica
```

**Los datos existían desde el principio y nunca se perdieron:** `athos_messages` tiene **61 mensajes
desde el 2026-07-16**. Lo que faltaba era la **pantalla** que los mostrara. El reclamo *«no
persiste»* es **incorrecto**: persistía, no se veía.

---

# PRIORIDAD 4 — Zona gris

## 4.1 Latencia de ~5 minutos

```
[4.1]
Estado: FUNCIONA EN PROD
Soporte: docs/VERIFICACION-10-PUNTOS-2026-07-30.md §5
Esfuerzo: hecho
Bloqueador externo: ninguno
```

**No es infraestructura, y esto es importante para no cobrarle al cliente un upgrade que no
resuelve nada.** Medido desde fuera del datacenter: **12,8 s al primer token**, 27,6 s completo.

**Los 5 minutos no se reproducen.** Causa probable del reporte original: el Tier 1 del retrieval
tardaba **15.397 ms y se cancelaba por `statement_timeout`** — eso se percibe como *cuelgue*, no como
lentitud. Corregido: **143 ms**, separando dos ramas de una consulta SQL que antes iban con `or` y
rankeaban ~19.000 coincidencias antes del `LIMIT`.

⚠️ **No usar el argumento «es el plan gratuito».** La evidencia dice que era nuestro código.
Sostener lo contrario es insostenible si piden la medición.

## 4.2 Transcripción

```
[4.2]
Estado: FUNCIONA EN PROD (los 3 defectos cerrados hoy)
Soporte: app/speaker_roles.py · app/streaming_transcription.py ·
         scripts/calidad/transcripcion_vivo_verificar.py
Esfuerzo: hecho
```

| Defecto reportado | Estado | Causa real |
|---|---|---|
| **Roles invertidos** | ✅ | El código asumía que el hablante 0 era el veterinario «porque inicia la consulta». **Es falso**: el dueño suele abrir («Doctor, mi perro no come»), así que **el diálogo entero salía invertido**. Ahora el rol se infiere del **contenido**, determinístico. |
| **Fecha errada** | ✅ | Tres pantallas formateaban en UTC porque los componentes de servidor corren en UTC en Vercel. Ancladas a `America/Bogotá`, con pruebas que fuerzan `TZ=UTC`. |
| **Por lotes, no en vivo** | ✅ | **Cerrado hoy**: WebSocket contra Deepgram Live. |

**¿Se comprometió tiempo real?** El contrato pide «transcripción de voz» **sin especificar tiempo
real**. Contractualmente es zona gris — pero **ya no importa: está entregado**, así que conviene
presentarlo como cumplido y no discutir el alcance.

Verificado contra Deepgram real con una consulta de 104 palabras con verdad-de-terreno conocida:
**92,3 % de exactitud** (96,1 % sin contar el formato numérico), **primer texto a los 1,6 s**.

## 4.3 Capa agéntica

```
[4.3]
Estado: FUNCIONA EN PROD
Soporte: src/lib/athos-agent/ (17 herramientas) · INVENTARIO-COMPONENTES.md
Esfuerzo: no aplica
```

**Este punto nos favorece y la Guía lo lee bien.** Inventario de lo que el sistema **sí** hace hoy:

- **17 herramientas** en el agente, de las cuales **7 son de escritura** (crear cita, registrar
  consulta, etc.) y pasan **sin excepción** por aprobación humana: el agente **propone** insertando
  una fila `status='proposed'`; la ejecución corre bajo la **sesión del veterinario que aprueba**.
- Verificado en producción hoy: propuso → aprobó → ejecutó → `appointment_id` real.

⚠️ **El dato débil: una sola acción ejecutada en toda la historia de producción.** Si el cliente
pregunta «¿y cuánto se ha usado?», el número es 1. Conviene adelantarse y encuadrarlo como
disponibilidad, no como adopción.

---

# Soportes transversales

| Soporte que pide la Guía | Estado |
|---|---|
| **Anexo A** | ❌ **no está en el repositorio** — conseguirlo es la tarea nº 1 |
| **Transcripts Fathom** | ❌ no están en el repositorio |
| **Historial de migraciones con timestamps** | ✅ **completo, 45 migraciones** — ver §3.1 y el listado en la base |
| **Inventario formal de componentes** | ✅ `INVENTARIO-COMPONENTES.md` (v1.4) |

## Base de conocimiento (entregable 2 del hito) — no estaba en la Guía, pero conviene tenerlo

Es uno de los tres entregables del Milestone 2 y **está cumplido sin reservas**:

| | |
|---|---|
| Fragmentos en producción | **519.999** |
| Con embedding | **519.999 (100 %)** |
| Glosario | 2.506 términos (824 aprobados) |

---

# Recomendación para la mesa del 3-ago

**Lo que se defiende sin reservas:**

1. **Base de conocimiento** — 520.000 fragmentos, 100 % embebidos. Cumplido.
2. **Citas correctas** — la procedencia es 100 % **estructural**, no estadística.
3. **Latencia** — 12,8 s medidos; los 5 minutos eran un cuelgue por `statement_timeout`, ya corregido.
4. **Capa agéntica** — ni el contrato ni el Anexo A definen «agéntico»; no se puede incumplir un
   estándar indefinido, y aun así el ciclo completo funciona.
5. **Historial** — nunca se perdió nada; faltaba la pantalla.

**Lo que hay que reconocer, con fecha de subsanación ya cumplida:**

6. **Cascada de 3 modelos** — el cliente tenía razón el 29-jul. Entregada el **30-jul**, verificada
   contra los tres proveedores reales. **Reconocer la fecha; no decir «hace meses».**
7. **Abstención** — el 0/187 era real. Hoy: 92,6 % de seguridad, medido y auditable.
8. **Smoke testing** — no se había presentado. Ahora existe, y encontró un defecto real de fechas.
9. **Invitaciones** — el cliente tenía razón; eran cinco bugs, el último encontrado y corregido hoy.
10. **Transcripción** — los tres defectos cerrados.

**Lo que falta y es de ustedes:**

11. **Anexo A** — sin él, toda la Prioridad 3 queda sin defensa de alcance.
12. **Revisión de calidad interna de Plogy** (2.4) — 2-4 h, cierra un reclamo formal entero.
13. **Captura del panel de Anthropic** que pruebe que Claude opera con créditos reales.
14. **`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` en Vercel** — 5 min, y **antes** de cualquier demo.

**Lo que NO conviene llevar a la mesa:**

- «La cascada corre hace meses» → se cae con un `git log`; el repo tiene 17 días.
- «Hay logs de routing entre modelos» → la traza dice 16 respuestas, todas DeepSeek.
- «La latencia era el plan gratuito» → era nuestro código, y está medido.
- «Las tablas de facturación existían antes de la entrega» → la migración dice 29-jul 03:16.
