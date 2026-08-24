---
titulo: Comunicaciones
seccion: guias
orden: 60
resumen: La bandeja de WhatsApp, los cuatro modos del agente automático, y la bandeja de correo.
---

# Comunicaciones

`/dashboard/comunicaciones` — WhatsApp
`/dashboard/comunicaciones/correo` — correo

## WhatsApp

La bandeja de la clínica. Los mensajes entran por el webhook del proveedor a `whatsapp_messages`
(aislada por clínica), y el envío sale por `/api/whatsapp/send`.

Un hilo se ata a un titular por los **últimos 10 dígitos** del teléfono, para no depender de cómo
esté escrito el prefijo.

### Los cuatro modos del agente

`whatsapp_integrations.agent_mode`, un enum:

| Modo | Qué hace Athos |
|---|---|
| `auto` | **Responde solo** las preguntas operativas |
| `review` | Sugiere la respuesta; la manda una persona |
| `paused` | No hace nada |
| `intervene` | Una persona tomó el hilo |

`review` es el default y es el modo seguro: la IA redacta, el humano decide.

### Qué puede contestar el modo automático

Sólo lo operativo: horarios, qué mascotas tiene registradas quien escribe, sus próximas citas, y
**proponer** una cita.

Tres límites que están en el código, no en el prompt:

1. **Nunca agenda.** `propose_appointment` deja la cita pendiente de confirmación, y las
   instrucciones dicen que le avise al titular que le confirmarán en breve — **nunca que ya quedó
   agendada**.
2. **Un número desconocido no puede enumerar nada.** Sin titular reconocido sólo se ofrecen los
   horarios disponibles.
3. **Nunca dice de quién es lo ocupado.** Los cupos se calculan y se devuelven como horas: los
   nombres de los pacientes de otros clientes no son suyos.

Cuando no puede resolver algo, **escala a una persona** (`human_tasks`).

### La sugerencia de respuesta

En modo `review`, el botón "Athos sugiere la respuesta" redacta un borrador con el contexto del hilo.
Es una capacidad de plan Pro (`sugerencia-whatsapp`).

### Conectar el número

Se hace **en la propia pantalla de Comunicaciones**, no en Integraciones. Eso se cambió a propósito:
antes había que irse hasta Integraciones, y el botón llevaba a una sección que ya no tenía el
conector — dos saltos para escanear un código. Hay un test que vigila que no vuelva a pasar.

Los tres proveedores están en [Servicios externos](../30-referencia/20-servicios-externos.md).

## Correo

`/dashboard/comunicaciones/correo`

La bandeja de la cuenta que **cada miembro** conectó por Composio. Athos lee y escribe **por esa
persona**, nunca desde la cuenta de otro.

Los hilos se guardan en `email_threads` / `email_messages`. Cuando alguna dirección del hilo coincide
con `owners.email`, se ata al titular: eso es lo que permite ver el correo en su ficha.

### Los dos correos que no hay que confundir

| | **Correo de Athos** (Composio) | **Correo transaccional** (Resend) |
|---|---|---|
| Quién manda | La cuenta personal del miembro | Tuvetia, a nombre de la clínica |
| Para qué | Lo que Athos escribe por esa persona | Facturas y cobranza |
| Se conecta | Cada miembro, en Integraciones | Una vez, en el despliegue |
| Si el titular responde | Le llega a esa persona | Le llega a los administradores |

En Integraciones hay una nota explicando justo esto, porque la pantalla anterior pedía una contraseña
de aplicación de Gmail para un envío SMTP que ya no existía: decía *"Envío (SMTP) verificado"*, que
era falso, y pedía una credencial que no se usaba para nada.

## Cobranza

El módulo de cartera manda recordatorios de facturas vencidas por los canales autorizados
(`channel_authorizations`), lee las respuestas del cliente y **clasifica la intención** con IA
(capacidad `cartera-ia`).

Corre en el cron de las 14:00. `CARTERA_MESSAGING_SIMULATED=1` lo deja sin enviar nada real.

Los titulares se pueden dar de baja del correo: `/baja/[token]` escribe en `owner_email_optout`.
