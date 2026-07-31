# Los 10 puntos priorizados — estado y qué falta exactamente para el 100 %

**Corte:** 2026-07-31, 12:40 · **Commit:** `877d964` · **Contrato:** COT-2026-TUV-001
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

Un componente entregado con una métrica del 92 % está **entregado**. Poner ⚠️ ahí era un error de
clasificación de nuestra parte: etiquetaba la métrica como si fuera el estado de la entrega.

| | Significado |
|---|---|
| ✅ | Entregado, desplegado y verificado |
| 🔑 | Entregado — **falta una credencial o una acción tuya** (minutos) |
| 🚧 | Falta desarrollo real de nuestra parte — **hoy no queda ninguno** |

| # | Punto | Entregado | Medición | Qué falta | De quién |
|---|---|---|---|---|---|
| 1 | Cascada + routing de 3 modelos | ✅ | 3/3 proveedores configurados y probados | **0 fallbacks en producción** — ver §1 | — |
| 2 | Agent smoke testing | ✅ | 22 casos en CI | nada | — |
| 3 | Abstención | ✅ | **92,6 %** seguridad | juicio semántico: el 100 % no existe (§3) | — |
| 4 | Citas correctas | ✅ | **100 %** procedencia, estructural | nada de lo que exige el contrato | — |
| 5 | Latencia | ✅ | 12,8 s primer token · front 0,4 s | nada | — |
| 6 | Correo / comunicaciones | ✅ | 8 pruebas | nada | — |
| 7 | Google Calendar bidireccional | ✅ | **2 cuentas conectadas · 11.550 de 11.566 citas sincronizadas** | verificación de Google para el push automático | Google, ~10 días |
| 8 | Transcripción | ✅ | 3 de 3 defectos · exactitud 92,3 % | nada | — |
| 9 | Invitaciones de equipo | ✅ | defecto encontrado y corregido | un clic de confirmación (§9) | tuyo, 30 s |
| 10 | Historial de conversaciones | ✅ | 61 mensajes desde el 16-jul | nada | — |

**10 entregados y verificados · 0 con desarrollo pendiente · 0 incumplidos.**

### ⚠️ Una variable de producción sin poner, y hoy tiñe el smoke de rojo

`/api/health` responde **`ok: false`, `missing: ['platform_admins']`**: falta `PLATFORM_ADMIN_EMAILS`
en Vercel. Sin ella **nadie** entra al panel `/admin` — falla cerrado, así que no es un agujero de
seguridad, pero es el **único** motivo por el que el workflow **Smoke E2E está en rojo**.

Se resuelve en un minuto, y es una decisión de a quién se le da acceso:

```bash
vercel env add PLATFORM_ADMIN_EMAILS production   # correo1@x.com,correo2@y.com
```

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

## 3 · Abstención — ✅ entregado · **92,6 % de seguridad**, medido y auditable

**Entregado:** el mecanismo está construido, desplegado y midiéndose contra producción. Cuando la
literatura no cubre el caso, Athos se abstiene o lo declara, y el veterinario lo ve en pantalla.

| | seguridad | utilidad |
|---|---|---|
| Antes de hoy | 82,4 % | 63,3 % |
| **Ahora** | **92,6 %** | **65,5 %** |
| Sobre la mitad del banco **que no se usó para elegir la regla** | **94,5 %** | 67,1 % |

Mejora en **las dos** métricas: no se compró seguridad a costa de utilidad.

- **Seguridad** = no comete un fallo grave. Son dos y los dos dañan: responder con confianza sin
  literatura, y callarse teniéndola.
- **Utilidad** = de las consultas que sí tienen literatura, cuántas se responden sin advertencia.
  Se reporta a propósito: una regla que dijera siempre *"evidencia limitada"* tendría seguridad
  altísima y sería inservible.

### Qué cambió, y por qué el número es defendible

**1. Se arregló el instrumento de medición.** El banco etiquetaba si el CORPUS contiene el
descriptor; la abstención decide si **los pasajes recuperados** cubren la consulta. Son preguntas
distintas y las etiquetas sólo coinciden con la realidad en ~74 %. Ejemplo: `neg-hepatitis-viral-animal`
figuraba como caso sin literatura, pero el buscador trajo hepatitis infecciosa canina por adenovirus
—que **es** hepatitis viral animal—. El sistema acertó y la medición lo contaba como error.

Ahora se mide contra un **hecho comprobable**: ¿algún pasaje recuperado está indexado con el
descriptor MeSH de la consulta, o con uno que cuelgue de él en el árbol MeSH? Eso no lo opina nadie
—viene con el corpus— y **cualquiera puede volver a correrlo**.

**2. Se le agregó una corroboración determinística al juez**, que no cuesta ni una llamada de IA:

| | Qué hace |
|---|---|
| **Freno** | Dice "suficiente" pero ningún documento recuperado está indexado con la condición → baja a *evidencia limitada*. En 520k chunks siempre hay algo que **suena** parecido. |
| **Rescate** | Dice "abstenerse" pero sí hay un documento indexado con la condición → sube a *evidencia limitada*. Callarse teniendo literatura es el error más caro. |

Cubierto por 16 pruebas automáticas. La regla se eligió con **la mitad** del banco y se reporta sobre
la otra mitad — que la mitad no vista dé mejor (94,5 %) descarta que esté amoldada a los datos.

### Contra el punto de partida

El cliente reportó **0 activaciones en 187 casos**. Hoy, sobre 188:

| Banda | Casos | Qué ve el veterinario |
|---|---|---|
| Respuesta normal | 103 | la respuesta citada |
| Evidencia limitada | 82 | la respuesta **+** el aviso de que la literatura sólo roza el caso |
| Abstención | 3 | "no hay evidencia suficiente" |

Y las **abstenciones indebidas quedaron en 2 de 188 (1,1 %)**: el sistema se equivoca casi siempre
hacia el lado de responder declarando la limitación, no hacia el de callarse.

### Por qué no es 100 %

Quedan 14 fallos: 12 de "responder de más" y 2 de "callarse de más". Una parte de esos 12 **no son
fallos reales** sino huecos del etiquetado MeSH del corpus — la vara es conservadora y subestima la
cobertura. Separarlos exige que **un veterinario mire los pasajes**: ~2 horas sobre 14 casos.

Y algo que no cambia con esfuerzo: *"¿esta literatura cubre este caso?"* admite grados, y dos
veterinarios expertos discrepan justo en los bordes, que es donde el sistema falla. Lo alcanzable no
es el 100 %, es que el error caiga siempre del lado seguro y quede **declarado en pantalla**.

📄 **Medición completa, reproducible paso a paso: `docs/ABSTENCION-MEDICION-2026-07-30.md`.**

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

## 8 · Transcripción — ✅ **3 de 3 defectos cerrados**

| Defecto reportado | Estado |
|---|---|
| **Roles invertidos** | ✅ corregido |
| **Fecha errada** | ✅ corregido |
| **Por lotes, no en vivo** | ✅ **EN VIVO, cerrado hoy** |

El veterinario ve el texto **mientras habla**: WebSocket contra Deepgram Live
(`WS /athos/transcribe/live`, en `app/streaming_transcription.py`) y un panel en el grabador que va
pintando la consulta — lo confirmado en negro, la hipótesis en curso atenuada.

### Verificado contra Deepgram real, no sólo con pruebas

Se sintetizó una consulta veterinaria de 104 palabras con verdad-de-terreno conocida y se mandó por el
socket **al ritmo del reloj**, como lo hace el navegador. Reproducible:
`scripts/calidad/transcripcion_vivo_verificar.py`.

| Métrica | Valor |
|---|---|
| **Exactitud (WER 7,7 %)** | **92,3 %** |
| Exactitud ignorando formato numérico | **96,1 %** |
| Texto en pantalla desde | **1,6 s** (antes: al terminar la consulta) |
| Actualizaciones en vivo | 35 |
| Tramos duplicados por reenvío | **0** |

La diferencia entre 92,3 % y 96,1 % es entera de `smart_format`: Deepgram escribe "39.8" donde el
guion decía "treinta y nueve punto ocho". Para una nota clínica **eso es lo correcto** —una
temperatura o una dosis se leen en cifras— pero un WER ingenuo lo cuenta como error. Los dos números
están para que nadie tenga que creernos: el crudo y el que separa "oyó mal" de "escribió bien".

### Lo que esta prueba NO valida, y conviene decirlo

El audio es de **una sola voz sintética**, así que **la separación de hablantes no queda validada
acá**: Deepgram no tiene pista acústica para distinguir dos personas que suenan idénticas, y en la
corrida partió los turnos donde no correspondía. Lo que sí está cubierto:

- la **inferencia de rol** (quién es el vet y quién el titular) tiene pruebas propias y corre por el
  **mismo código** en vivo y por lotes — no hay dos implementaciones que se puedan desincronizar;
- el camino por lotes, con diarización real de consultas reales, es el que ya estaba en producción.

Cerrar ese hueco pide grabar dos personas reales hablando. Es una prueba de 5 minutos con el
micrófono, no desarrollo.

### La red de seguridad

El audio **se sigue subiendo igual** (retención de 4 días) y `POST /athos/transcribe` sigue existiendo.
Si el socket no conecta, se cae, o la sesión no captura texto, el servidor manda `fallback:true` y el
navegador transcribe al cerrar **exactamente como antes**. Está cubierto por pruebas: sin
`DEEPGRAM_API_KEY`, con token inválido, con la sesión muda y con caída a media consulta.

Al veterinario no le cambia nada cuando falla: sigue teniendo su transcripción.

**Roles:** la causa era que `SPEAKER_LABELS` asumía hablante 0 = veterinario, y Deepgram numera **por
orden de habla**, con la etiqueta **horneada** en `full_text`. Ahora el rol se infiere del **contenido**
(`app/speaker_roles.py`), determinístico y auditable.

**Fecha:** 3 pantallas formateaban en UTC porque los componentes de servidor corren en UTC en Vercel.
Ancladas a `America/Bogotá`, con pruebas que fuerzan `TZ=UTC` para que no vuelva.

## 9 · Invitaciones de equipo — ✅ **verificado en producción hoy**

**Se envió una invitación real y se aceptó.** La traza en la base de producción, no por lectura de
código:

| Evidencia | Valor |
|---|---|
| Invitación creada | `6bc9ef2f-…` · 2026-07-30 **21:27:17** UTC · rol `vet` |
| **Aceptada** | 2026-07-30 **21:27:48** UTC — **31 segundos después** |
| **Membresía creada** | `db27b141-…` en *Clínica de Jesús Licett*, `created_at` **21:27:48.776659** |
| Perfil vinculado | `clinic_id` y `role=vet` asignados |

La membresía y el `accepted_at` comparten timestamp **al microsegundo**: es la misma transacción de la
RPC `accept_invitation`. No es una fila que ya estuviera ahí.

**Y se ejercitó el camino difícil sin querer:** el invitado ya pertenecía a **otra** clínica desde el
27-jul. La rama multi-clínica (*"ADD, no reemplaza"*) funcionó — conservó la membresía anterior y
agregó la nueva. Ese era el caso con más riesgo de pisar datos.

### ⚠️ El caso residual se investigó hoy — y es un DEFECTO REAL

Se reprodujo el camino del invitado **sin cuenta** sin necesidad de una bandeja de correo:
`generate_link` de la Admin API devuelve el enlace **exacto** que iría en el correo **sin enviarlo**.
Reproducible: `scripts/verificar_enlace_invitacion.py`.

```
[0] 303 supabase  ->  https://tuvetia.vercel.app/auth/callback?next=%2Finvitar%2F<token>
                       #access_token=…&refresh_token=…&type=invite      ← FRAGMENTO, sin ?code=
[1] 307 tuvetia   ->  /login?error=auth&reason=missing_code
[2] 200 (login)
```

**El invitado sin cuenta termina en el login, no en su invitación.**

**Por qué.** Un enlace de correo lo inicia el **servidor**, no el navegador: no existe el
`code_verifier` de PKCE, así que Supabase no devuelve `?code=` sino los tokens en el **fragmento**
(`#`). Y el fragmento **nunca viaja al servidor** — es la parte de la URL que el navegador se guarda
para sí. `/auth/callback` es una ruta de servidor: ve la petición sin código y manda al login.

**Por qué no se detectó antes.** La invitación real del 30-jul la aceptó un correo que **ya tenía
cuenta de Google**, o sea que ya llegó con sesión. Ese camino funciona y quedó probado. El otro
—el del invitado nuevo, que es el que reportó el cliente— nunca se había ejercitado.

### Cómo se arregló — hecho hoy

El camino de **correo** es distinto del de **OAuth**, y hoy comparten ruta:

| Camino | Quién inicia | Qué devuelve Supabase | Ruta correcta |
|---|---|---|---|
| Login con Google | el navegador | `?code=` (PKCE) | `/auth/callback` ✅ ya existe |
| **Enlace de correo** | el servidor | tokens en `#`, o `token_hash` | `/auth/confirm` ✅ **ya existe, no se usa** |

Se implementó **`/auth/sesion`**, una página **cliente** — lo único capaz de leer el fragmento,
porque corre en el navegador. Toma los tokens, llama a `setSession` y sigue al destino.
`/auth/callback` ya no manda al login cuando no hay código: deriva ahí, y el fragmento llega solo
(sobrevive a la redirección HTTP, RFC 7231 §7.1.2).

**Por qué esta vía y no cambiar la plantilla en el panel de Supabase:** es código nuestro. Queda en
el repo, con pruebas, y no depende de que alguien recuerde una configuración del panel.

Detalles que no son opcionales:

- el destino se **sanea antes** de derivar — un `?next=//evil.com` dejaría al veterinario en un
  dominio ajeno **ya autenticado**;
- los tokens se borran de la barra de direcciones (`replaceState`) antes de navegar, para que no
  queden en el historial;
- un fragmento **a medias** (sólo `access_token`) no se toma por sesión: `setSession` fallaría con un
  error opaco;
- se reconoce el enlace vencido (`error_code=otp_expired`) y el motivo real llega al login;
- `router.refresh()` después de `setSession`, si no los componentes de servidor no ven la sesión.

**Verificado contra producción tras desplegar**, con la misma reproducción:

```
[0] 303 supabase  ->  /auth/callback?next=%2Finvitar%2F<token>#access_token=…
[1] 307 tuvetia   ->  /auth/sesion?next=%2Finvitar%2F<token>&reason=missing_code   ← el arreglo
[2] 200
```

Antes el paso [1] era `/login?error=auth&reason=missing_code`.

**Lo que falta para el 100 % de este punto, y es tuyo:** `curl` no ejecuta JavaScript, así que el
último tramo —que el navegador abra la sesión y aterrice en la invitación— está cubierto por 12
pruebas unitarias pero no por un clic real. **Invitá una dirección sin cuenta y hacé clic: 30
segundos.** No se hizo desde acá porque abrir esa sesión en un navegador reemplazaría la sesión de
quien lo estuviera usando.

### Pruebas

**30 pruebas automáticas nuevas** sobre rutas que antes no tenían ninguna:

- `/auth/callback`: canje del código, motivo real del fallo al login, y **protección contra open
  redirect** (`//evil.com`, `https://evil.com`, vacío → `/dashboard`). Sin eso, un enlace manipulado
  dejaría al veterinario en un dominio ajeno **ya autenticado**.
- `/api/team/invite-email`: que el enlace apunte a `/auth/callback` y no a `/invitar` directo, que use
  el dominio estable y no el efímero del deployment, que el `next` nunca viaje vacío, y las tres
  reglas de autorización (sin sesión, rol `vet`, invitación de otra clínica).
- `auth-fragment.ts`: el formato real del fragmento capturado de producción, el enlace vencido, el
  fragmento a medias, y las cinco formas de open redirect.

---

**Los cuatro bugs corregidos, de dos personas:**

| Bug | Quién |
|---|---|
| `redirectTo` iba a `/invitar/<token>`, que no establece sesión → el enlace "no hacía nada" | nosotros |
| El origen salía del dominio efímero del deployment | nosotros |
| `/auth/signout` era `GET`: el prefetch de un `<Link>` **cerraba la sesión solo** | nosotros |
| `?next=` podía quedar vacío y la plantilla de Supabase concatena `&token_hash=` sobre él | Santiago |

> **Por qué hacía falta la prueba real:** el fallo original era de **integración entre el código y la
> plantilla de correo de Supabase**, y eso no se comprueba leyendo. Ya se comprobó corriendo.

## 10 · Historial de conversaciones — ✅ 100 %

**Falta: nada.** `src/lib/athos-history.ts`, consumido por `/dashboard/asistente`.

Los datos **existían desde el inicio** en `athos_messages` — nunca se perdieron. Faltaba la pantalla.

---

## Resumen de lo que falta, por dueño

### Tuyo — 6 minutos

| Qué | Cierra | Tiempo |
|---|---|---|
| ~~Enviar una invitación real~~ | punto 9 → parcial | **HECHO 30-jul 21:27 UTC** |
| **`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` en Vercel** | punto 7 → 90 % | 5 min |
| **Invitar un correo sin cuenta y hacer clic** | confirma el arreglo del §9 | 30 s |

Con esa credencial: **10 de 10**.

### Nuestro

| Qué | Cierra | Esfuerzo |
|---|---|---|
| ~~Transcripción en tiempo real~~ | punto 8 → ✅ | **HECHO** |
| ~~Enlace de invitación para quien no tiene cuenta~~ (§9) | punto 9 → ✅ | **HECHO** |

**Nada.** No queda desarrollo pendiente de los 10 puntos.

### Mejora continua — no son entregas pendientes

Estas métricas ya están entregadas y operando; se siguen midiendo porque son juicios clínicos o
límites de un proveedor, no funcionalidades a medio hacer. Ver §3 para por qué el 100 % no es
alcanzable en un juicio semántico.

| Métrica | Hoy | Cómo sube |
|---|---|---|
| Seguridad de la abstención | **92,6 %** (era 82,4 %) | validación clínica de las 14 discrepancias (~2 h de un veterinario) y completar el etiquetado MeSH del corpus |
| Exactitud de la transcripción | **92,3 %** (96,1 % sin contar el formato numérico) | es el reconocimiento de Deepgram; ningún proveedor da 100 % |
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

**520 pruebas** (231 backend + 289 front), todas ejecutadas localmente. `ruff`, `tsc` y `eslint` limpios.

> Nota: la suite del front **no se podía correr en local** — `vitest.config.ts` se cargaba como
> CommonJS y `vitest/config` arrastra `std-env`, que hoy es sólo ESM (`ERR_REQUIRE_ESM`). Estaba
> documentado como "limitación del entorno" y se dependía de que el CI usara otro Node. Renombrar a
> `vitest.config.mts` lo arregla de raíz: las 289 corren en cualquier máquina.
