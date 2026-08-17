# Auditoría completa — 2026-08-16

Recorrido de todo el proyecto: onboarding, sistema de diseño, UI, backend, frontend, features y
deuda. La pregunta que la ordena no es "¿hay bugs?" sino la que pidió Felipe: **¿qué le falta a esto
para ser un SaaS agéntico listo para vender?**

Dos zonas se auditaron **sin tocar**, por acuerdo: Wompi (Santiago) y el corpus (Infinity). Sus
hallazgos van en notas aparte al final.

**Método.** Todo hallazgo se verificó antes de escribirse: contra la base con el MCP de sólo lectura,
leyendo el código, o calculando. Las hipótesis que se cayeron están escritas como tales al final —
son cuatro, y esa sección es la que dice cuánto vale el resto.

---

## Resumen

**Estado al 2026-08-16, 21:30.** Este documento se mantiene al día a medida que se cierran los
hallazgos — un informe que describe un pasado que ya no existe se vuelve `CONFIGURACION-PRODUCCION.md`,
que es el hallazgo 2 de esta misma auditoría.

| # | Hallazgo | Gravedad | Frente | Estado |
|---|---|---|---|---|
| 1 | Ninguna clínica puede facturar; 14 de 15 no pueden agendar con Athos | 🔴 | Onboarding | ✅ **cerrado** (PR #105) |
| 2 | Los canales externos se mueren sin que nadie se entere | 🔴 | Dependencias | ✅ **cerrado** (PR #106) |
| 3 | `fg-faint` reprueba contraste AA en modo claro — 216 usos | 🟠 | Diseño | ✅ **cerrado** (PR #107) |
| 4 | No hay servicio de seguimiento de errores | 🟠 | Vara de mercado | 🟡 **cableado** (PR #108) — falta el DSN |
| 5 | El trial de 3 días no existe en el código | 🟠 | Suscripciones | 👤 **Santiago** |
| 6 | La traza no cubre lo que hacen las personas fuera de la nota clínica | 🟡 | Vara de mercado | ✅ **cerrado** (PR #110 + 0063) |
| 7 | Tres defectos latentes en los datos de ejemplo | 🟡 | Onboarding | ✅ **cerrado** (PR #111 + 0064) |
| 8 | Foco de teclado inconsistente en el módulo de facturación | 🟡 | Diseño | ✅ **cerrado** (PR #112) |
| 9 | `rateLimit` en memoria; roles binarios; una tabla sin scroll | 🟢 | Varios | ✅ **cerrado** (PR #113) — 2 de 3 no eran defectos |
| — | El corpus a 5× | 🟡 | athos-service | 👤 **Jesús (Infinity)** |

### Lo que quedó cerrado, y con qué

- **1 · Facturar y agendar.** Horarios y servicios entraron al wizard, que pasó de 4 a 6 pasos. Los
  horarios llegan pre-llenos; los precios los escribe el vet, porque una cifra inventada en una
  factura no es un placeholder sino un error. Con un solo precio la clínica ya puede facturar.
- **2 · Canales mudos.** No hizo falta un sistema de alertas: un canal caído es "algo que espera a
  una persona", así que entró como **señal**, y eso lo puso en cuatro superficies sin cañería nueva
  —el riel, la tira de móvil, el prompt del agente y el briefing—. Va primero en el orden porque no
  es una tarea sino una **precondición**.
- **3 · Contraste.** No alcanzaba con subir un token: eso colapsaba la jerarquía de tres niveles en
  dos. Se replicó la estructura de la paleta oscura, que ya estaba bien. El test lee `globals.css` y
  hace la cuenta — el contraste no es algo que un test de componente pueda fallar, y por eso 216 usos
  ilegibles sobrevivieron a 972 tests.
- **4 · Errores.** El hueco era peor de lo que decía este informe: lo que corre solo —crons, webhooks,
  server actions— no pasaba por ninguna costura. `onRequestError` de Next 16 cubre las cuatro
  superficies. Sentry queda cableado e **inerte hasta que exista `NEXT_PUBLIC_SENTRY_DSN`**.

- **6 · La traza.** Un trigger registra cada UPDATE y DELETE de pacientes, titulares, consultas y
  citas, con el antes y el después de los campos que cambiaron. Un trigger y no llamadas desde la
  app, porque los caminos de escritura están repartidos y una traza con agujeros es peor que ninguna:
  invita a concluir "no pasó nada" donde lo correcto es "no lo registramos".
- **7 · El demo.** La siembra parcial ya no sobrevive, el wizard no vuelve a pedir lo que la clínica
  ya tiene, y borrar un titular dejó de poder fallar con un error de llave foránea.
- **8 · El foco.** 34 campos pasan al anillo del sistema, con un test que impide que el patrón vuelva.
- **9 · Los menores.** De los tres, **sólo uno era un defecto** (la tabla de cartera). Ver la sección.

### Lo que falta

**Bloqueado por terceros:** el 5 (Santiago, suscripciones) y el corpus (Jesús). Cada uno tiene su
nota en `docs/`.

**Nuestro:** sólo el DSN de Sentry, que es de Felipe y toma dos minutos. Nada más queda abierto de
esta auditoría.

**Planteado, sin resolver, y a propósito:** los roles. Hoy hay `admin` y `vet`; una clínica de ocho
personas necesitaría más, pero definir qué puede hacer cada uno tiene consecuencias legales —
*"¿quién puede aprobar una nota clínica?"* no es una pregunta de implementación. Es una decisión de
producto, no un arreglo pendiente.

---

## 1 · 🔴 Ninguna clínica puede facturar; 14 de 15 no pueden agendar

> ✅ **Cerrado** en el PR #105. Horarios y servicios entraron al wizard, que pasó de 4 a 6 pasos.

**Qué se rompe.** Las dos capacidades insignia del producto —que Athos agende y que la clínica
cobre— están apagadas para prácticamente todas las cuentas en producción. No por un bug: porque el
paso que las habilita no lo hace nadie.

**Evidencia.** Reproduciendo en SQL las seis definiciones de `src/lib/onboarding/consultar.ts`:

| paso | clínicas que lo tienen |
|---|---|
| primer paciente | 8 / 15 |
| equipo invitado | 4 / 15 |
| logo | 3 / 15 |
| horarios de atención | **1 / 15** |
| **servicios en el catálogo** | **0 / 15** |
| WhatsApp conectado | **0 / 15** |

El propio `src/lib/onboarding/progreso.ts` dice qué desbloquea cada uno:

- `servicios` → *"Sin servicios no se puede facturar una consulta."*
- `horarios` → *"Sin ellos Athos no puede ofrecer un espacio libre ni agendar nada."*

**La causa es estructural.** Hay dos superficies de onboarding y cubren cosas distintas:

- **Wizard** (`welcome-wizard.tsx:25`), activo, te lleva de la mano: `["Clínica", "Primer paciente",
  "Ejemplo", "Equipo"]`
- **Riel** (`riel-configuracion.tsx`), pasivo, en el dashboard, **plegable y recordado en
  `localStorage`**: logo, horarios, paciente, servicios, whatsapp, equipo

Los tres pasos que el wizard **no** cubre son exactamente los tres del fondo de la tabla.

**El wizard no es el problema.** De los 9 perfiles que de verdad lo vieron, **8 lo terminaron**. La
separación se hace por el timestamp: 8 perfiles comparten `2026-07-24 05:56:21.996069+00` al
microsegundo (el backfill de la migración 0017, que el propio `bienvenida/page.tsx:44` documenta) y 8
tienen marca individual.

**El problema es que terminarlo no deja la clínica funcionando.** Ocho clínicas completaron el
onboarding y aterrizaron donde no pueden cobrar ni agendar.

**Agravante.** No existe siembra de catálogo por defecto: no hay ni un `insert` a `catalog_items` en
ninguna migración. Se le pide a un veterinario que teclee su catálogo de servicios completo, a mano,
antes de poder emitir una sola factura. En un mes no lo hizo nadie.

**Trampa de medición.** `setup_completed_at` dice **16 de 17**. Quien mire esa métrica concluye que
el onboarding funciona perfecto.

**Cómo reproducirlo.** La consulta SQL de la tabla de arriba, contra el principal.

**Qué no verifiqué.** Por qué cada clínica se detuvo. No hay telemetría de producto que lo diga —
sólo el estado final.

---

## 2 · 🔴 Los canales externos se mueren sin que nadie se entere

> ✅ **Cerrado** en el PR #106. Un canal caído entró como señal y va primero, por ser precondición.

**Qué se rompe.** Una dependencia externa cae, el producto sigue mostrándose sano, y nadie recibe
nada. Se descubre probando.

**Evidencia.** Las dos integraciones de WhatsApp están `disconnected`. Mensajes por día:

| día | entrantes | salientes |
|---|---|---|
| 08-08 | 337 | 348 |
| 08-09 | 335 | 388 |
| 08-10 | 370 | 578 |
| **08-11** | **26** | **44** |
| 12 al 16 | — | — |

Cinco días sin una sola fila. El webhook escribe el estado en
`src/app/api/whatsapp/evolution/webhook/[token]/route.ts:90` con el comentario *"(aviso en
Configuración)"* — un aviso **pasivo**: sólo lo ve quien entre a esa pantalla. Un grep por
notificación, alerta o tarea humana sobre esa ruta no devuelve nada.

**Es la sesión, no el servidor.** Evolution es WhatsApp Web; que la sesión expire es normal y
esperable. El defecto no es que se caiga: es el silencio.

**Alcance real.** Son las clínicas de prueba (la de Felipe, 5.202 mensajes; la de Santiago, 1.464).
Ningún cliente perdió nada. Pero el mecanismo es idéntico al que sufriría una clínica que pague, y
ahí esos entrantes son titulares escribiendo.

**La tesis, que es más grande que WhatsApp:**

> `/api/health` tiene 14 chequeos y **los 14 miran variables de entorno**. Ninguno mira estado vivo.
> El sistema sabe decir *"¿está cableado?"* y no sabe decir *"¿está funcionando?"*.

**Lo que sí está bien resuelto, y no hay que tocar.** Los fallos en **primer plano**.
`ENVIA_AFUERA` (`src/app/api/athos/actions/[id]/execute/route.ts:185`) hace que un Composio caído o
un WhatsApp muerto exploten al aprobar la acción, con el texto correcto — y ahí hay un veterinario
mirando la pantalla. La asimetría es limpia: **primer plano avisa, fondo no.**

**Efecto colateral.** `docs/CONFIGURACION-PRODUCCION.md` (31-jul) dice que faltan cuatro variables.
El workflow `smoke` exige `missing === []` y pasa, así que ese documento **hoy miente**, incluido
sobre el correo de Athos por Composio, que está cableado. Hay que fecharlo o borrarlo.

**Qué no verifiqué.** Si la cascada de IA tiene respaldo configurado en producción. Las cuatro
superficies respondieron siempre con `deepseek-v4-flash`, lo que es compatible tanto con "el primario
nunca falló" como con "no hay respaldo", y el endpoint no lo distingue a propósito.

---

## 3 · 🟠 `fg-faint` reprueba contraste AA en modo claro

> ✅ **Cerrado** en el PR #107. Se replicó la estructura de la paleta oscura; hay test de regresión.

**Qué se rompe.** El rótulo de sección de todo el producto es ilegible según WCAG AA, y sólo en el
tema claro.

**Evidencia.** Ratios calculados sobre los tokens reales de `globals.css`:

| par | claro | oscuro |
|---|---|---|
| `fg-faint` sobre fondo | **2.95:1** ✗ | 5.26:1 ✓ |
| `fg-faint` sobre `surface-2` | **2.76:1** ✗ | 4.74:1 ✓ |
| los otros 11 pares medidos | ✓ | ✓ |

AA pide 4.5:1 para texto normal. **El mismo token pasa en oscuro y falla en claro: la paleta oscura
se afinó y la clara no.**

**Alcance.** 216 usos en 57 archivos, y ninguno alcanza el umbral de "texto grande" que permitiría
3:1 — 8 a `10px`, 38 a `11px`, 72 en `text-xs`, 49 en `text-sm`.

**Arreglo, calculado.** Un token en `globals.css:155`:

```css
--muted: #5f6f67;   /* era #8a9a93 — da 5.31:1 sobre blanco y 4.97:1 sobre surface-2 */
```

No conviene llevarlo a `#5c6d66`: ese ya es `--text-2` (`fg-muted`) y colapsaría los dos niveles.

**Cómo reproducirlo.** Calcular el ratio WCAG entre `#8a9a93` y `#ffffff`.

**Qué no verifiqué.** El renderizado real en un dispositivo. Esto es cálculo sobre los tokens: es
exacto para el color, pero no sustituye abrir la app.

---

## 4 · 🟠 No hay servicio de seguimiento de errores

> 🟡 **Cableado** en el PR #108, e inerte hasta que exista `NEXT_PUBLIC_SENTRY_DSN`. La costura de
> servidor (`onRequestError`) sí quedó activa: era la parte que faltaba del todo.

**Qué se rompe.** Un fallo en producción se entera por una llamada del cliente.

**Evidencia.** `src/lib/errores.ts` es la costura —está bien hecha y bien documentada— pero sigue
escribiendo sólo a consola (línea 34). La línea de Sentry está escrita, comentada, en la línea 30.
Enchufarlo es tocar **una** función.

**Por qué importa más que antes.** La capa agéntica ya corre sola: el briefing diario, el barrido de
cartera y la purga de audio son crons sin nadie mirando. Un fallo ahí no tiene a quién avisarle, y
es exactamente el hallazgo 2 aplicado a nuestro propio código.

---

## 5 · 🟠 El trial de 3 días no existe en el código

**Qué se rompe.** Nada expira. `presupuesto.ts:6` documenta *"hay un free trial de 3 días"*; no hay
columna `trial_ends_at` ni código que lo aplique.

**Evidencia.** Las 15 clínicas están en `subscription_status = 'trial'`, cero con
`wompi_subscription_id`, la más vieja desde el 15 de julio — **32 días de trial de 3 días**.

Detalle para el hallazgo: `subscription_status` se **lee en un solo lugar**
(`src/lib/admin/metrics.ts:70`, para mostrarlo en el panel admin) y **nada lo escribe ni lo usa como
puerta**. La columna tiene default `'trial'`, `NOT NULL`, y ninguna clínica se movió nunca de ahí.

Ver la nota para Santiago al final: el mecanismo de corte ya existe y sólo hay que conectarlo.

---

## 6 · 🟡 La traza no cubre lo que hacen las personas

> ✅ **Cerrado** en el PR #110 (migración 0063, aplicada y verificada). Un trigger registra cada
> UPDATE y DELETE de pacientes, titulares, consultas y citas.

**Qué se rompe.** "¿Quién editó el peso de este paciente?" y "¿quién borró este titular?" no se
pueden contestar.

**Evidencia.** `audit_logs` tiene seis tipos de acción y **todos son del agente**:
`athos_action.executed` (22), `athos_action.failed` (5), `whatsapp.unofficial_consent` (2),
`athos_action.rejected` (1), `whatsapp.agent_mode.auto` (1), `whatsapp.agent_mode.review` (1).

**Lo importante SÍ está cubierto, y hay que decirlo:** `clinical_notes` tiene `approved_at`,
`approved_by` y `locked_by` — el momento en que la nota entra a la historia legal está trazado. Las
facturas tienen `created_by`.

**Lo que no:** `patients`, `owners` y `consultations` sólo tienen `updated_at`. Sin `updated_by` y
sin borrado suave, un cambio o una eliminación son anónimos e irreversibles salvo desde respaldo.

**Qué no verifiqué.** Si el proyecto tiene point-in-time recovery activo. No se puede consultar
desde el MCP; hay que mirarlo en el panel de Supabase.

---

## 7 · 🟡 Tres defectos latentes en los datos de ejemplo

> ✅ **Cerrado** en el PR #111 (migración 0064, aplicada y verificada). Y uno de los tres resultó
> más grande de lo que decía este informe: yo mismo lo amplié en el PR #105.

Ninguno ocurrió: los dos demos en producción están íntegros (1 paciente, 1 consulta, 1 transcript,
1 nota cada uno). Se listan porque son alcanzables.

1. **Siembra parcial permanente.** `demo-data/route.ts` no es transaccional y la idempotencia se
   decide por el titular (línea 75). Si falla el insert del transcript, quedan titular, paciente y
   consulta escritos; el reintento encuentra el titular y devuelve `{ ok: true, already: true }` —
   el demo queda roto para siempre **reportando éxito**.
2. **Duplicados al repetir.** `crearPrimerPaciente` (`welcome-wizard.tsx:65`) no tiene guarda de
   idempotencia: repetir el onboarding vuelve a crear titular y paciente.
3. **Borrado frágil.** `consultations.owner_id` es **NO ACTION** y el DELETE del demo confía en el
   cascade `owners → patients → consultations`. Hoy funciona porque PostgreSQL chequea NO ACTION al
   final de la sentencia, pero una consulta del titular demo cuyo paciente no sea el demo haría
   fallar el borrado con violación de FK.

**Qué no verifiqué.** El punto 3 por ejecución: el MCP es de sólo lectura contra el principal y no
se puede probar un DELETE ahí. Es análisis de las reglas de PostgreSQL, no una medición.

---

## 8 · 🟡 Foco de teclado inconsistente en facturación

> ✅ **Cerrado** en el PR #112. 34 campos pasan al anillo del sistema, con un test que impide que
> el patrón vuelva.

**Evidencia.** 18 archivos, casi todos de `facturacion/`, sustituyen el anillo del sistema por
`focus:border-brand focus:outline-none` — un tinte de borde de 1px, cuando el `button.tsx` del propio
sistema usa `focus-visible:ring-3`.

**El contraste pasa**: 4.58:1 contra el fondo y 3.69:1 de cambio percibido al enfocar. Lo que no pasa
es la consistencia: un usuario de teclado tiene dos experiencias distintas según el módulo, y 1px
está por debajo del área que pide WCAG 2.2 §2.4.11.

---

## 9 · 🟢 Menores

> ✅ **Cerrado** en el PR #113 — pero de los tres, sólo uno era un defecto.

**Tabla de cartera sin scroll.** `dashboard/facturacion/cartera/page.tsx:145` usaba `overflow-hidden`
donde las otras 13 tablas usan `overflow-x-auto`. Con siete columnas en un teléfono se apretaba hasta
ser ilegible en vez de poder desplazarse. Verificado que **no clipeaba** (ninguna celda tiene
`nowrap`, `tabular-nums` ni `font-mono`, así que encogen). Arreglado.

**`rateLimit` en memoria: NO era un defecto, y este informe lo dijo mal.** Escribí *"no es un tope por
clínica"*, que es cierto, pero la implicación —que el gasto queda desprotegido— es falsa. El orden
real en `api/athos/agent/route.ts` es:

1. `rateLimit` (línea 67) — freno de ráfaga en memoria, por usuario
2. **`consultarPresupuesto(clinicId)`** (línea 92) — tope mensual **contra la base**, responde 402
3. `streamText` (línea 158) — el gasto

O sea que el dinero está protegido por un tope persistido que se comprueba **antes de cada llamada**,
y el propio código ya explica la diferencia en la línea 86. Que el `rateLimit` sea por instancia
significa que una ráfaga puede colarse N veces con N lambdas concurrentes — pero el techo mensual
sigue en pie, así que el radio del daño está acotado. Construir un limitador distribuido para esto
sería agregar un servicio (Redis) y una ida a la base en el camino caliente del chat, a cambio de
nada que el tope mensual no cubra ya.

**Roles binarios: es una decisión de producto, no un arreglo.** Hay `admin` (12 perfiles) y `vet` (5),
con tres puntos de aplicación —invitar gente, y dos de configuración—. Para una clínica de ocho
personas (recepción, auxiliar, peluquería) haría falta más, pero definir qué puede hacer cada rol
tiene consecuencias legales: *"¿quién puede aprobar una nota clínica?"* no es una pregunta de
implementación. Queda planteado, sin inventar una matriz de permisos.

---

## Lo que está sano y conviene no re-abrir

- **Disciplina de tokens**: 22 colores crudos en 70k líneas, todos en la factura pública
  `/f/[token]`, y ahí son correctos.
- **Fallos en primer plano**: `ENVIA_AFUERA` hace lo correcto (hallazgo 2).
- **Cartera**: 4 recordatorios pendientes, 0 vencidos, nada atascado.
- **Purga de audio**: corre y funciona.
- **El bucle de redirección del onboarding**: documentado, guardado por orden de comprobación, con
  test propio (`bienvenida/__tests__/redirects.test.ts`).
- **Disciplina general**: 20 `TODO`/`FIXME` reales en todo el repo.

---

## Las cuatro hipótesis que se cayeron

Esta sección importa tanto como las otras: un informe que sólo muestra los aciertos no deja saber
cuánto confiar en el método.

1. **"Once audios sin purgar — incumplimiento de la Ley 1581."** Falso. Las 11 filas tienen
   `storage_path` en null: el archivo se borró y la fila se conserva a propósito
   (`purge-audio/route.ts:4`). Mi consulta estaba mal etiquetada; el sistema, bien.
2. **"`[].every()` es `true`, así que la cascada da verde estando vacía."** Cierto pero **deliberado
   y documentado** (`health/route.ts:120`). El chequeo se llama `cascada_con_credenciales`, no
   `cascada_configurada`, y cumple lo que promete.
3. **"La factura pública se rompe en modo oscuro."** Falso. La tarjeta es `bg-white` con texto
   `neutral-900`, y el modo oscuro es sólo por clase (`localStorage`), sin `prefers-color-scheme`.
4. **"Hay anchos fijos que desbordan en móvil."** Falso: los dos casos eran `max-w-[...]`; mi regex
   matcheó dentro del prefijo.

Y una corrección de una auditoría anterior: dije que el correo de Athos estaba roto porque
`email_integrations` estaba vacía. **Es otra cosa** — esa tabla es el SMTP de la clínica para
cartera. El correo de Athos va por Composio y está cableado.
