# Billing — cómo funciona la suscripción

Todo lo que hay que saber sobre los planes, el cobro y el corte de acceso. Si vas a tocar algo de
esto, leé al menos las tres primeras secciones: hay decisiones que parecen rarezas y no lo son.

> **Estado: en producción y verificado de punta a punta el 2026-08-18.** Migración aplicada, cobro
> real aprobado ($2.000 COP de prueba, MASTERCARD), webhook validado y plan activado solo en
> **8 segundos**. Lo que todavía falta está en la §10.

---

## 1. Los dos planes

| | **Gratis** | **Pro** |
|---|---|---|
| Precio | $0, para siempre | $200.000 COP / mes (configurable) |
| Alcance | toda la clínica | toda la clínica |
| Pacientes, historia clínica | ✅ | ✅ |
| Agenda + Google/Outlook | ✅ | ✅ |
| Ventas: DIAN, inventario, cartera | ✅ | ✅ |
| Bandejas de WhatsApp y correo | ✅ | ✅ |
| Dashboard, Integraciones, Configuración | ✅ | ✅ |
| Equipo (sin tope de miembros) | ✅ | ✅ |
| Exportar todos los datos | ✅ | ✅ |
| **Athos** (chat clínico) | ❌ | ✅ |
| **Modo Fantasma** (grabar + transcribir + nota) | ❌ | ✅ |
| Athos sugiere la respuesta en WhatsApp | ❌ | ✅ |
| Modo automático de WhatsApp | ❌ | ✅ |
| Cartera clasifica respuestas con IA | ❌ | ✅ |
| Recetas por foto | ❌ | ✅ |
| Briefing diario redactado | ❌ | ✅ |

El plan es **por clínica**, no por usuario: todos los miembros comparten lo mismo. Sólo el
**administrador** puede contratar, cambiar la tarjeta o cancelar.

### El corte es por gasto, no por pantalla

Ésta es la decisión de fondo y conviene entenderla antes de mover nada.

La forma corta —"gratis todo menos Athos y Modo Fantasma"— es exacta para el vet, pero **Athos no
vive sólo en su pantalla**. Hay IA corriendo dentro de secciones que son gratis: la sugerencia de
respuesta de la bandeja, el modo automático de WhatsApp, la clasificación de cartera, las recetas
por foto y el briefing. Todas gastan del mismo bolsillo.

Si el corte fuera por pantalla, una clínica gratis seguiría quemando IA por el **modo automático de
WhatsApp** y por el **barrido diario de cartera** — las dos que gastan sin que nadie las mire. Por
eso lo que se cobra son **capacidades**, y la lista vive en un solo lugar:
[src/lib/planes/index.ts](src/lib/planes/index.ts).

Para mover una capacidad de plan se toca **una línea** de `PLAN_MINIMO`. No hay que buscar nada más.

### Lo que NO se pierde en el plan gratis

Bajar a gratis **nunca borra datos**. Las consultas grabadas, las transcripciones, las notas
aprobadas, las facturas: todo queda y se puede leer y exportar. Lo único que se apaga es la
capacidad de generar cosas nuevas con IA.

Y cartera **sigue funcionando**: los recordatorios salen, la antigüedad se calcula, los cobros se
registran. Lo único que se pierde es que una máquina lea la respuesta del cliente primero — la lee
una persona, como antes de que existiera el clasificador.

---

## 2. Wompi: qué hace y qué NO hace

**Wompi no tiene producto de suscripciones.** No hay planes, ni ciclos de facturación, ni
reintentos automáticos, ni portal de cliente. Esto no es Stripe.

Lo que Wompi da son dos piezas:

1. **Fuente de pago** (`POST /v1/payment_sources`): el cliente entrega la tarjeta una vez y queda un
   `payment_source_id` reutilizable.
2. **Cobro suelto** (`POST /v1/transactions` con ese id): cobra cuando nosotros se lo pedimos.

**Todo el motor de suscripción es nuestro**: el calendario, los reintentos, la gracia, la
cancelación y el downgrade. Vive en [src/lib/suscripcion/](src/lib/suscripcion/).

### Las cuatro llaves

| Llave | Prefijo | Para qué | ¿Al navegador? |
|---|---|---|---|
| Pública | `pub_test_` / `pub_prod_` | tokenizar la tarjeta | **sí, y debe** |
| Privada | `prv_test_` / `prv_prod_` | crear fuentes de pago y cobrar | nunca |
| Integridad | `test_integrity_` / `prod_integrity_` | firmar el monto de cada cobro | nunca |
| Eventos | `test_events_` / `prod_events_` | validar los webhooks | nunca |

**El ambiente se deduce del prefijo, no de una variable aparte.** Si las cuatro no coinciden en
ambiente, la integración se declara mal configurada y no cobra nada
([config.ts](src/lib/wompi/config.ts)). Una `WOMPI_ENV=production` con llaves de prueba es el fallo
silencioso clásico: todo "funciona", nadie cobra de verdad, y se descubre al cerrar el mes.

### La tarjeta no pasa por nuestro servidor

El número va del **navegador a Wompi directo**
([tokenizar-tarjeta.ts](src/lib/wompi/tokenizar-tarjeta.ts)). A nuestra API sólo le llega un token.

Es la razón por la que la llave pública es pública, y lo que mantiene el alcance PCI de Tuvetia en
el mínimo. Si alguna vez alguien mueve la tokenización al servidor "porque es más cómodo", el número
de tarjeta empieza a pasar por nuestros logs, por Vercel y por Sentry.

Lo único de la tarjeta que se guarda es **marca y últimos 4**, para poder pintar `Visa ···· 4242`.

---

## 3. La regla que sostiene todo: el webhook manda

`POST /transactions` responde **`PENDING` casi siempre**. La respuesta inmediata no es el resultado:
el resultado llega por webhook, segundos o minutos después.

De ahí salen tres consecuencias que parecen rarezas:

**a) La fila del cobro se escribe ANTES de llamar a Wompi.** Si la llamada se cae a mitad de camino,
el cobro pudo haberse ejecutado igual. Con la fila ya escrita, el webhook la encuentra por
referencia y la cierra. Al revés, un timeout dejaría plata cobrada sin registro nuestro.

**b) Un fallo de red NO es un rechazo.** El cobro queda en `PENDIENTE`. Reintentar dando por fallido
algo que quizás se cobró es exactamente cómo se cobra dos veces.

**c) La redirección del navegador nunca confirma un pago.** Cualquiera puede visitar esa URL con el
id que se le ocurra.

---

## 4. Idempotencia

La referencia del cobro es la llave:

```
tuvetia-<clinic_id>-<YYYY-MM>-<intento>
```

Es única **en nuestra tabla** (`suscripcion_cobros.referencia unique`) **y en Wompi**, que rechaza
referencias repetidas. Las dos capas dicen lo mismo:

- Si el cron se dispara dos veces el mismo día, el segundo choca contra el `unique` y no cobra.
- Si dos lambdas corren a la vez, sólo una gana.
- `aplicarResultado` sólo actúa si el cobro sigue en `PENDIENTE`, así que tres entregas del mismo
  webhook no suman tres meses.

Por eso el barrido puede correr de más sin consecuencias: un cron que dispare dos veces, o que se
reintente, no cobra dos veces.

---

## 5. El ciclo de vida

### Alta

```
[vet] llena la tarjeta
   └─→ navegador → Wompi          POST /v1/tokens/cards      (llave pública)
   └─→ navegador → nuestra API    POST /api/suscripcion/suscribir  { token }
          ├─ 1. GET /v1/merchants/{pub}   → tokens de aceptación
          ├─ 2. POST /v1/payment_sources  → payment_source_id   (llave privada)
          ├─ 3. GUARDAR la fuente en clinics  ← antes de cobrar, a propósito
          └─ 4. POST /v1/transactions     → PENDING
   ...
   [Wompi] POST /api/wompi/webhook  transaction.updated APPROVED
          └─→ plan = 'pro', subscription_status = 'active', plan_renueva_en = fin del período
```

El paso 3 parece de más y es el que evita el peor estado posible: una tarjeta registrada en Wompi
que nosotros no conocemos. Si se guardara después del cobro y el proceso muriera en el medio, el vet
tendría que volver a escribir la tarjeta y quedarían dos fuentes de pago para la misma clínica.

### Renovación

Un barrido diario a las **9:00 Colombia**, **dentro de** [`/api/cron/cartera`](src/app/api/cron/cartera/route.ts).

> ¿Por qué ahí adentro y no en su propio cron? El plan Hobby de Vercel permite 2 crons diarios y los
> dos cupos están usados desde hace meses (`purge-audio` y `cartera`). Ese endpoint **ya hacía dos
> trabajos** por esta misma restricción — cobranza y lectura de correo.
>
> Estuvo un día en un workflow de GitHub Actions. Se quitó: repartía la operación entre dos sitios y
> sacaba el horario del repo, a cambio de nada.
>
> Corre **antes** que la cobranza, dentro del mismo endpoint: si una clínica cae a free por falta de
> pago, conviene que caiga antes de que cartera intente usar la IA que ya no tiene. Con dos crons
> separados eso era una carrera; acá el orden está garantizado.
>
> Cada trabajo va aislado en su `try/catch`: un fallo cobrando no impide que salgan los
> recordatorios, ni al revés.

`/api/cron/suscripciones` sigue existiendo para dispararlo **a mano**, sin esperar al horario.

Una sola columna gobierna todo: **`clinics.plan_renueva_en`** = "cuándo hay que volver a mirar esta
clínica". El barrido pregunta siempre lo mismo — ¿ya venció? — y por eso no existe ninguna clínica
que pueda no ver.

La comparación es `<=`, no `===`: si el cron no corre un día, el del día siguiente lo levanta.

### Reintentos y período de gracia

| Intento | Cuándo | Estado de la clínica |
|---|---|---|
| 1 | el día del vencimiento | `active` → si falla, `past_due` |
| 2 | +2 días | sigue `past_due`, **sigue con Pro** |
| 3 | +4 días más | si falla, `plan = 'free'`, `inactive` |

**Son 6 días de gracia con Pro puesto.** El caso común de un rechazo no es alguien que se va: es una
tarjeta vencida que nadie actualizó. Cortar el Modo Fantasma en medio de una consulta por un cobro
que falló esta mañana es la peor forma posible de pedir que actualicen la tarjeta.

Los reintentos son en días y no en horas a propósito: un rechazo por fondos no se arregla en una
hora, y golpear la misma tarjeta agresivamente hace que el emisor empiece a marcar los cobros como
sospechosos y rechace también los buenos.

**Un reintento no corre el ciclo.** El período que se cobra se deriva del último cobro *aprobado*,
no de la fecha del intento: si el cobro de septiembre falla el día 1 y sale el día 5, el período
sigue siendo 1-sep → 1-oct y el próximo cobro es el 1 de octubre. Anclarlo a la fecha del intento le
regalaría días al cliente en cada rechazo y desplazaría el ciclo para siempre.

### Cancelación

**No baja el plan en el acto.** Se marca `canceled` + `plan_cancelado_en`, y la clínica sigue con
Pro hasta que termina el mes que ya pagó; el barrido la baja cuando vence.

Cortar el día que alguien cancela es quedarse con plata por un servicio no prestado, y además empuja
a que la gente cancele el último día por miedo a perder los días que le quedan.

Un pago exitoso levanta la cancelación: quien canceló y volvió a pagar quiere seguir.

### Reconciliación: cuando el webhook no llega

**Esto no es defensivo por si acaso. Pasó.** El 2026-08-17, primera prueba real contra sandbox:
Wompi aprobó el cobro en un segundo y el webhook nunca llegó (la URL de eventos no estaba guardada
del lado de Wompi). El cobro quedó `PENDIENTE` para siempre y la clínica se quedó **pagando y sin su
plan**, sin ninguna alerta. Hubo que destrabarlo a mano contra la base.

Con cobros mensuales automáticos es peor: el cobro sale a las 9 de la mañana sin nadie delante. Si
el webhook se pierde ahí, no hay ninguna persona mirando una pantalla de pago que lo note.

[`reconciliar.ts`](src/lib/suscripcion/reconciliar.ts) corre después de cobrar: busca los cobros que
llevan **más de 15 minutos** en `PENDIENTE`, le pregunta a Wompi el estado real de cada transacción
(`GET /v1/transactions/{id}`) y aplica el resultado con el **mismo `aplicarResultado` del webhook**
— que es idempotente, así que un webhook que llegue tarde no duplica nada.

Los 15 minutos son deliberados: el camino normal es que el webhook llegue en segundos, y preguntar
antes es gastar llamadas para recibir `PENDING`.

**Lo que NO cubre, y hay que saberlo.** Sólo reconcilia cobros que tienen `wompi_transaction_id`.
Queda afuera el caso en que la llamada a Wompi se cortó antes de devolvernos el id: ahí el cobro
pudo haberse ejecutado y no tenemos con qué preguntarlo. Wompi expone búsqueda por referencia
(`GET /v1/transactions?reference=`), que cerraría el hueco, pero requiere la llave privada y **no se
pudo verificar la forma de su respuesta** al escribir esto; implementarla a ciegas sería código que
falla en silencio justo en el escenario para el que existe. Esos cobros **no se adivinan: se
reportan** como `huerfanos` y gritan en el log, para que los mire una persona en el panel de Wompi.

### Mes calendario, no 30 días

`unMesDespues` suma un mes **calendario** y sujeta al último día del mes destino:

- 31 de enero → **28 de febrero** (29 en bisiesto), no el 3 de marzo.
- Con 30 días fijos, doce cobros caerían en 360 días y a los pocos años se cobraría dos veces en el
  mismo mes.

Todo esto está cubierto en [periodo.test.ts](src/lib/suscripcion/__tests__/periodo.test.ts).

---

## 6. Dónde corta el acceso

Tres capas, y las tres hacen falta.

### a) Base de datos — la que no se puede esquivar

Un trigger `before insert on consultations` rechaza la consulta si el plan no es Pro
(migración [0065](athos-service/supabase/migrations/0065_planes_y_suscripcion.sql)).

**No es paranoia:** «Iniciar consulta» hace un `insert` directo desde el navegador con la sesión del
vet, sin pasar por ninguna ruta de API. Un gate sólo en React lo esquiva cualquiera con la consola
abierta, y el Modo Fantasma es el módulo más caro del producto.

### b) Rutas de API — la que corta el gasto

[`clinicaDeLaSesion`](src/lib/api/clinica-de-la-sesion.ts) trae el plan **en el mismo select** que ya
hacía, embebido: sin round-trip extra, y la ruta número diez nace con el gate puesto.

`requiereCapacidad(plan, capacidad)` devuelve **402 Payment Required** — no 403. El 402 existe para
esto, y le permite al navegador distinguir "te falta plan" (abre la ventana de Pro) de "te falta
permiso". El agente lo marca además con la cabecera `X-Requiere-Plan: pro`, porque esa ruta responde
un stream y no JSON.

Para los caminos **sin sesión** —modo automático de WhatsApp, cartera, briefing— está
[`clinicaPuede()`](src/lib/planes/servidor.ts), que lee con la llave de servicio.

| Superficie | Dónde corta | Qué pasa en free |
|---|---|---|
| Athos (chat y widget) | `/api/athos/agent` | 402 antes del modelo |
| Sugerencia de WhatsApp | `/api/athos/suggest-reply` | 402 antes del modelo |
| Modo automático | `lib/whatsapp/auto-reply.ts` | silencio; el mensaje queda para el vet |
| Cartera IA | `lib/cartera/inbound.ts` | degrada a `OTRO`; escala a una persona |
| Recetas por foto | `lib/facturacion/recipe-ingest.ts` | lanza `RequierePlanPro` |
| Briefing | `lib/briefing/generar.ts` | filtrado en SQL; no gasta un token |
| Modo Fantasma | trigger de la BD | el insert falla |

### c) Interfaz — la que explica

- **Athos**: al escribir aparece una advertencia bajo el compositor; al enviar se abre la ventana de
  invitación a Pro. **Lo escrito no se borra** — perder la pregunta al chocar con el muro de pago es
  castigar a alguien por intentar.
- **Modo Fantasma**: la ventana salta **al abrir** el cajón de nueva consulta, no al enviarlo.
  Hacerle elegir paciente y escribir el motivo para decirle al final que no puede es la peor versión
  de este muro.

Esta capa **no es seguridad**. Si alguien edita el contexto desde la consola, lo único que consigue
es que la ventana no se abra y que el servidor le responda 402.

### Fallar cerrado

`comoPlan()` cae a `free` ante cualquier valor que no sea exactamente `"pro"`. Es lo **contrario**
del criterio del presupuesto de IA, que falla abierto para no dejar a un veterinario sin Athos en
medio de una consulta.

La diferencia: el tope de IA protege un costo nuestro; esto protege el cobro. Un fallo de lectura
que regalara Pro sería un agujero provocable a voluntad.

---

## 7. El modelo de datos

### `clinics` (columnas nuevas)

| Columna | Para qué |
|---|---|
| `plan` | `free` \| `pro`. **La única que leen los gates.** |
| `subscription_status` | `trial` \| `cortesia` \| `inactive` \| `active` \| `past_due` \| `canceled` |
| `plan_renueva_en` | cuándo cobrar o reintentar. La columna que gobierna el barrido |
| `plan_cancelado_en` | marca de cancelación; el plan cae cuando vence el período |
| `wompi_payment_source_id` | la tarjeta guardada en Wompi |
| `wompi_customer_email` | Wompi exige el mismo correo en cada cobro |
| `tarjeta_marca`, `tarjeta_ultimos4` | sólo para pintar `Visa ···· 4242` |

**Por qué `plan` es una columna aparte de `subscription_status`.** Son preguntas distintas: `plan`
es "¿qué puede hacer ahora?" y `subscription_status` es "¿en qué estado está su relación de cobro?".
Mezclarlas obligaría a cada gate del código a conocer la tabla completa de estados y decidir cuáles
dan acceso. Con `plan` aparte, **el gate lee una columna con dos valores**. Una clínica en `past_due`
dentro de su gracia sigue con `plan = 'pro'`: es el motor el que decide cuándo bajarla.

> `wompi_subscription_id` ya existía y **queda muerta**. Wompi no tiene suscripciones. No se borra
> —tirar una columna de una base compartida es más riesgoso que dejarla— pero no la uses.

### `suscripcion_cobros`

Una fila **por intento**, no por mes. Un mes reintentado tres veces son tres filas, y eso es lo que
permite contestar "¿por qué esta clínica quedó en `past_due`?".

Los miembros de la clínica pueden **leer** los suyos (RLS); nadie escribe desde la sesión.

### `suscripcion_eventos`

El registro crudo de cada webhook, **incluidos los que llegan con firma inválida**. Un evento mal
firmado es precisamente el que hay que poder mirar después: o alguien está probando la URL, o
rotaron el secreto y nadie actualizó la variable. Ninguna de las dos se ve si el evento se descarta
en silencio. Tabla cerrada a todo el mundo salvo la llave de servicio.

---

## 8. El webhook

`POST /api/wompi/webhook` — **URL pública**. No hay sesión ni `CRON_SECRET` que la proteja: Wompi no
manda credenciales. Lo que la protege es el checksum.

```
SHA256( valores de signature.properties en orden + timestamp + WOMPI_EVENTS_SECRET )
```

Comparado en **tiempo constante** (`timingSafeEqual`), y prefiriendo la cabecera `X-Event-Checksum`
sobre el cuerpo: quien arma el cuerpo entero controla `signature.checksum`.

**Un evento sin firma válida se guarda pero no se aplica.** Sin esa regla, cualquiera que conozca la
URL podría regalarse Pro mandando un JSON con `status: APPROVED`.

**Siempre responde 200**, incluso cuando rechaza. Wompi reintenta ante cualquier cosa que no sea
2xx: devolver 400 a un evento con firma mala invita a reintentos indefinidos de algo que nunca vamos
a aceptar. La única excepción es un cuerpo que no es JSON.

### El checksum: confirmado ✅ (y por qué no hay un vector fijo)

La documentación de Wompi publica un ejemplo con su cadena concatenada y su hash, pero **los dos no
se corresponden**: el SHA256 de la cadena que ellos muestran no da el hash que ellos muestran
(verificado con `node:crypto` el 2026-08-17). Es un error de su documentación.

La implementación sigue el **algoritmo documentado**, y los tests cubren su comportamiento (el orden
importa, alterar el monto invalida, otro secreto invalida, nada lanza). Pero no hay un vector fijo
del proveedor contra el cual anclarlo — fijar uno inventado daría la falsa sensación de estar
verificado contra Wompi.

**Cómo se confirmó, sin adivinar:** está construido en el producto. `suscripcion_eventos.firma_valida`
guarda el veredicto de cada webhook entrante, así que la primera transacción real lo dice sola:

```sql
select evento, firma_valida, procesado_en, created_at
from suscripcion_eventos
order by created_at desc limit 5;
```

**Verificado el 2026-08-17 en sandbox y el 2026-08-18 en producción: `firma_valida = true` en los
dos.** La concatenación es correcta; el ejemplo de la documentación es el que está mal.

Si algún día `firma_valida` empieza a dar `false` en eventos legítimos, lo más probable es que hayan
rotado el secreto de eventos y nadie haya actualizado `WOMPI_EVENTS_SECRET` — no que el algoritmo
haya cambiado.

---

## 9. Variables de entorno

```
NEXT_PUBLIC_WOMPI_PUBLIC_KEY=      # la única que va al navegador
WOMPI_PRIVATE_KEY=                 # crea fuentes de pago y cobra
WOMPI_INTEGRITY_SECRET=            # firma el monto
WOMPI_EVENTS_SECRET=               # valida los webhooks
PLAN_PRO_PRECIO_CENTAVOS=          # 20000000 = $200.000 COP. Vacía = ese mismo default
CRON_SECRET=                       # ya existía; lo comparten los dos crons de Vercel
```

Detalle completo en [.env.example](.env.example).

**El precio no es `NEXT_PUBLIC_`** a propósito. El monto que se le manda a Wompi sale del servidor y
de ningún otro lado; la interfaz recibe el número resuelto sólo para mostrarlo, y el servidor lo
vuelve a resolver al cobrar. Con una variable pública habría dos fuentes —la que se pinta y la que
se cobra— y bastaría editar el bundle para intentar pagar otra cifra.

Sin las credenciales, **nada revienta**: la pantalla de Plan muestra la comparación y dice que los
pagos no están habilitados. Es la regla del repo para toda integración externa.

---

## 10. Estado de la puesta en marcha

### Lo que ya está hecho y verificado

Todo esto se comprobó contra la base y contra Wompi el **17–18 de agosto de 2026**, no se da por
supuesto:

| | Cómo se verificó |
|---|---|
| Migración 0065 aplicada | 7 columnas, 2 tablas, trigger y policies consultadas en el principal |
| El trigger corta de verdad | probado en los dos sentidos con rollback forzado: free rechaza, pro pasa |
| Checksum del webhook | `firma_valida = true` en sandbox **y** en producción |
| Cobro real | $2.000 COP aprobados, MASTERCARD, plan activado solo en **8 segundos** |
| **3D Secure NO se exige** | `is_three_ds: false` en la transacción real → **no hay que construir el flujo 3RI** |
| Cron sin secretos nuevos | corre dentro de `/api/cron/cartera`, que ya tenía `CRON_SECRET` |
| Reconciliación | 7 tests; y el caso que la motiva ocurrió de verdad el 17-ago |

### Lo que falta

1. **Devolver `PLAN_PRO_PRECIO_CENTAVOS` a `20000000`** si se bajó para probar — y redesplegar, que
   un cambio de variable no toma efecto hasta el deploy. Con $2.000 puestos, la primera clínica que
   contrate paga dos mil pesos al mes para siempre.
2. **Limpiar las tarjetas de prueba.** Una tarjeta personal que quedó registrada se cobra sola al
   mes siguiente, por el monto que tenga la variable ese día.
3. **Probar los tres caminos que faltan**, todos sin gastar plata: cancelación (debe quedar
   `canceled` sin bajar el plan hasta el vencimiento), rechazo con la tarjeta `4111 1111 1111 1111`
   de sandbox (debe quedar `past_due` con 6 días de gracia), y reconciliación (borrar la URL del
   webhook, pagar, y disparar `/api/cron/suscripciones` a mano).
4. **Confirmar el procesador.** El `recurrent: true` (Credential On File) sube la tasa de
   aprobación, pero sólo aplica a VISA/Mastercard **con RBM** como procesador. Con otra combinación
   Wompi lo ignora en silencio — no rompe nada, pero conviene saberlo.
5. **Decidir qué pasa con las clínicas de cortesía.** La migración dejó a las 15 existentes en
   `plan = 'pro'`, `subscription_status = 'cortesia'`: nadie perdió acceso al desplegar. Pasarlas a
   free es un `update` de una línea, cuando se decida y **después de avisarles**.
6. **Páginas legales.** Cobrar sin términos de servicio reales no es viable, y hoy siguen siendo un
   placeholder.

> ⚠️ **La URL del webhook se configura por ambiente.** La que se guarda en modo de pruebas **no
> viaja a producción**. Es el error que ya costó una tarde: el pago sale, Wompi lo aprueba, y el
> plan nunca se activa porque el evento no llega a ninguna parte. Al cambiar de ambiente, volvé a
> Programadores y confirmá que esté guardada.

### Lo que este trabajo no trae

- **Facturación de Tuvetia al cliente.** No se emite factura ni cuenta de cobro por la suscripción.
  El módulo de Ventas le factura a los *clientes de la clínica*, no a la clínica.
- **Trial.** Se menciona un trial de 3 días en el código y no tiene reloj. Con un plan gratis de por
  vida, un trial de Pro es otra cosa distinta y no se implementó.
- **Correo transaccional de cobro.** No se avisa por correo de un pago aprobado ni de uno fallado;
  el aviso de mora sólo se ve dentro de la app. Depende de `RESEND_API_KEY`, que sigue sin
  configurar.
- **Medidor de consumo por clínica.** El cupo de IA existe y está probado, pero no hay tope
  comercial por plan. Cuando se defina, `CupoDeIA` se enciende solo.
- **Prorrateo y cambios de plan a mitad de mes.** Sólo hay alta, renovación y cancelación al final
  del período.

---

## 11. Mapa de archivos

| Qué | Dónde |
|---|---|
| Qué incluye cada plan | [src/lib/planes/index.ts](src/lib/planes/index.ts) |
| El precio | [src/lib/planes/precio.ts](src/lib/planes/precio.ts) |
| Gate sin sesión | [src/lib/planes/servidor.ts](src/lib/planes/servidor.ts) |
| Gate con sesión (402) | [src/lib/api/clinica-de-la-sesion.ts](src/lib/api/clinica-de-la-sesion.ts) |
| Firmas de Wompi | [src/lib/wompi/firma.ts](src/lib/wompi/firma.ts) |
| Llaves y ambiente | [src/lib/wompi/config.ts](src/lib/wompi/config.ts) |
| Llamadas a Wompi | [src/lib/wompi/api.ts](src/lib/wompi/api.ts) |
| Tokenizar (navegador) | [src/lib/wompi/tokenizar-tarjeta.ts](src/lib/wompi/tokenizar-tarjeta.ts) |
| Motor: cobrar y aplicar | [src/lib/suscripcion/motor.ts](src/lib/suscripcion/motor.ts) |
| Calendario y reintentos | [src/lib/suscripcion/periodo.ts](src/lib/suscripcion/periodo.ts) |
| Barrido diario | [src/lib/suscripcion/barrido.ts](src/lib/suscripcion/barrido.ts) |
| Reconciliación | [src/lib/suscripcion/reconciliar.ts](src/lib/suscripcion/reconciliar.ts) |
| Webhook | [src/app/api/wompi/webhook/route.ts](src/app/api/wompi/webhook/route.ts) |
| Alta / cancelar | [src/app/api/suscripcion/](src/app/api/suscripcion/) |
| Cron diario (dentro de cartera) | [src/app/api/cron/cartera/route.ts](src/app/api/cron/cartera/route.ts) |
| Disparo manual | [src/app/api/cron/suscripciones/route.ts](src/app/api/cron/suscripciones/route.ts) |
| Pantalla de Plan | [src/app/dashboard/plan/page.tsx](src/app/dashboard/plan/page.tsx) |
| Ventana de invitación | [src/components/planes/modal-subir-a-pro.tsx](src/components/planes/modal-subir-a-pro.tsx) |
| Migración | [0065_planes_y_suscripcion.sql](athos-service/supabase/migrations/0065_planes_y_suscripcion.sql) |
