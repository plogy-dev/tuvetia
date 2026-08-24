---
titulo: Servicios externos
seccion: referencia
orden: 20
resumen: Cada servicio del que depende Tuvetia, qué hace exactamente, cómo se conecta y qué pasa cuando se cae.
---

# Servicios externos

Siete dependencias externas. Para cada una: **qué hace**, **cómo se autentica**, **qué se degrada
si falla** y **dónde vive el código**.

---

## Supabase

**Qué es.** Postgres gestionado con autenticación, almacenamiento y Row Level Security. Es la
frontera de seguridad del sistema, no sólo la base de datos.

**Qué guarda.** Todo: clínicas, perfiles, titulares, pacientes, consultas, citas, facturas,
inventario, mensajes de WhatsApp, hilos de correo, auditoría. Unas 66 tablas.

**Cómo se conecta.** Tres clientes distintos, y usar el que no es tiene consecuencias:

| Cliente | Dónde | Con qué credencial | RLS |
|---|---|---|---|
| `lib/supabase/client.ts` | Navegador | `anon` + sesión del usuario | **Sí** |
| `lib/supabase/server.ts` | Server components y rutas | `anon` + cookie de sesión | **Sí** |
| `lib/supabase/admin.ts` | Webhooks, crons, push de calendario | `service_role` | **No — se la salta entera** |

**Cuándo se usa `service_role`.** Sólo donde no hay sesión de la cual colgarse: un webhook de Meta,
un cron de Vercel, el empuje de una cita al calendario de otra persona. Cada uno de esos lugares
**revalida a mano** a qué clínica pertenece lo que va a tocar, porque la RLS ya no lo está haciendo.

**Si se cae.** Todo. Es la única dependencia sin la cual no hay producto.

**Código.** `src/lib/supabase/`, esquema en `athos-service/supabase/`.

---

## athos-service (FastAPI, Railway)

**Qué es.** Un servicio Python propio, no un tercero. Ingesta un corpus de literatura veterinaria, lo
indexa y responde preguntas clínicas **con citas**.

**Qué hace.**

- Ingesta y trocea el corpus (`corpus_chunks`, `glossary_term`, `glossary_synonym`).
- Recuperación en cascada: MeSH primero, texto completo después si el cupo no se llenó.
- Generación con guardas clínicas — incluido un *dose guard* que revisa las dosis.
- Memoria por paciente (`patient_embeddings`).
- Registro de lo que recuperó y respondió (`rag_retrieval_log`, `rag_answer_log`).

**Cómo se conecta.** HTTP desde la app Next, con `NEXT_PUBLIC_ATHOS_URL`.

**Si se cae.** El chat clínico y la búsqueda de literatura devuelven error. El CRM entero sigue
funcionando: agenda, pacientes, facturación y WhatsApp no lo tocan.

**Código.** `athos-service/app/`. Documentación propia en `athos-service/docs/`.

---

## Composio — correo y calendario

**Qué es.** Un intermediario de OAuth y de ejecución de herramientas. Sustituyó al OAuth propio.

**Qué resuelve, y por qué se migró.** El camino anterior guardaba un refresh token por usuario en
nuestra base y lo refrescaba a mano. Eso arrastraba tres problemas que Composio elimina de raíz:

1. Credenciales OAuth del servidor que mantener.
2. Tokens nuestros guardados en la base.
3. El refresh fallando con `invalid_grant` cada vez que el proveedor revocaba algo.

Y uno peor, que fue un incidente real: `session.provider_refresh_token` es el token del proveedor con
el que se **inició sesión**, no el del botón que se apretó. Alguien entró con Microsoft y su token
terminó guardado en la fila de Google.

**Qué hace hoy.**

| Superficie | Toolkit | Qué permite |
|---|---|---|
| Correo de Athos | `gmail`, `outlook` | Cada miembro conecta **su** cuenta; Athos escribe por esa persona |
| Calendario | `googlecalendar`, `outlook` | Las citas se crean en el calendario del veterinario asignado |

**Dos trampas documentadas.**

- **Outlook: correo y calendario son la misma cuenta conectada.** Desconectar una desconecta la
  otra, y la pantalla lo advierte antes.
- **Si alguien tiene los dos calendarios conectados, manda Google.** Conectar Google Calendar es un
  acto explícito para el calendario; la cuenta de Outlook puede existir sólo porque se conectó el
  correo, y mandarle las citas ahí sería elegir un calendario que nadie pidió.

**Si se cae.** El correo de Athos y el empuje de citas al calendario dejan de funcionar, **con aviso
en pantalla**. Las citas siguen guardándose en Tuvetia: `appointments` es la fuente de verdad.

**Código.** `src/lib/composio/`.

---

## WhatsApp — tres proveedores

Tuvetia soporta tres, y conviven. Cuál se ofrece lo decide `NEXT_PUBLIC_WA_PROVIDER`.

### Meta / WhatsApp Cloud API — el oficial

- **Ventaja:** es el protocolo soportado. No hay riesgo de baneo.
- **Costo:** requiere App Review de Meta aprobado.
- **Conexión:** Embedded Signup dentro de la app.
- **Autenticación del webhook:** firma de Meta + `META_WEBHOOK_VERIFY_TOKEN`.

### Evolution API — no oficial, autoalojado

- **Qué es:** un contenedor Docker que desplegás vos (Railway), basado en Baileys. **No es un SaaS**:
  no hay cuenta ni panel de terceros.
- **Riesgo:** protocolo no oficial. **Riesgo real de baneo del número.**
- **Conexión:** QR.
- **Autenticación del webhook:** Evolution **no firma sus llamadas**. El `EVOLUTION_WEBHOOK_TOKEN` va
  como segmento secreto de la URL (`/api/whatsapp/evolution/webhook/[token]`) y **ese token es la
  autenticación entera**.

### Kapso — legado

En retirada. Sólo si queda algún inquilino ahí.

**Cómo se guardan las credenciales de cada clínica.** Cifradas con AES-256-GCM usando
`WHATSAPP_TOKEN_KEY`, en `whatsapp_integrations`.

**Si se cae.** La bandeja de Comunicaciones deja de recibir y enviar. Nada más se ve afectado.

**Código.** `src/lib/whatsapp/` (16 archivos), rutas en `src/app/api/whatsapp/`.
Documento de referencia: `WHATSAPP.md`.

---

## Wompi — pagos

**Qué es.** La pasarela de pagos colombiana. Cobra la suscripción a Pro.

**Cómo funciona el cobro.**

1. El navegador manda el número de tarjeta **directo a Wompi**, sin pasar por nuestro servidor. Eso
   es lo que mantiene el alcance PCI en el mínimo.
2. Wompi devuelve un token de la fuente de pago.
3. El servidor cobra con `WOMPI_PRIVATE_KEY`, firmando el monto con `WOMPI_INTEGRITY_SECRET`.
4. Wompi confirma por webhook, validado con `WOMPI_EVENTS_SECRET`.

**El ambiente se deduce de las llaves**, no se configura: `pub_test_` → sandbox, `pub_prod_` →
producción. Si las cuatro no coinciden, la integración se declara mal configurada y no cobra nada.

**La renovación** corre dentro del cron de cartera, no en uno propio: el plan Hobby de Vercel permite
dos crons y los dos están usados.

**Si se cae.** `/dashboard/plan` muestra la comparación pero no deja pagar. Quien ya sea Pro sigue
siéndolo; quien esté en free sigue con todo el CRM. Nadie puede contratar ni renovar.

**Código.** `src/lib/wompi/`, `src/lib/suscripcion/`. Documento: `BILLING.md`.

---

## Resend — correo transaccional

**Qué es.** El servicio por el que salen las facturas y los recordatorios de cobranza.

**Cómo se ve un correo.** El remitente es siempre el mismo (`TRANSACTIONAL_FROM_EMAIL`), el **nombre
visible es el de la clínica** y el Reply-To son sus administradores. Es decir: el titular ve un
correo de su veterinaria, y si responde, le llega a la veterinaria.

**No confundir con el correo de Athos.** Son dos cosas distintas:

| | Resend | Composio |
|---|---|---|
| Quién manda | Tuvetia, a nombre de la clínica | La cuenta personal del miembro |
| Para qué | Facturas, cobranza | Lo que Athos escribe por esa persona |
| Se configura | Una vez, en el despliegue | Cada miembro, desde Integraciones |

**Antes del primer envío** hay que verificar el dominio (SPF y DKIM). Sin eso Resend rechaza todo con
*"domain is not verified"*.

**Si se cae.** Las facturas no salen por correo y el canal EMAIL de cobranza queda deshabilitado, con
el mensaje de error correspondiente.

**Código.** `src/lib/email/`. Documento: `CORREOS.md`.

---

## Sentry

**Qué es.** Reporte de errores del front y del servidor.

**Cómo se conecta.** `NEXT_PUBLIC_SENTRY_DSN`, vía `@sentry/nextjs`.

**Si se cae.** Nada del producto. Se pierden los reportes.

---

## Los modelos de IA

No son "un" servicio: son varios proveedores intercambiables.

| Proveedor | Variable | Se usa cuando |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | Por defecto, en todo |
| DeepSeek | `DEEPSEEK_API_KEY` | Si algún rol lo apunta |
| Google (Gemini) | `GEMINI_API_KEY` | Si alguna cascada nombra `@google` |

La elección se hace **por rol**, no global: el agente con herramientas, el modo automático de
WhatsApp y la visión pueden usar modelos distintos. Y las **cascadas** permiten un respaldo
automático ante fallos del proveedor. Ver [Secretos](10-secretos.md#inteligencia-artificial).

**Si se caen todos.** Las siete capacidades de IA dejan de responder. El CRM sigue entero — es
exactamente la razón por la que el corte entre planes está donde está.
