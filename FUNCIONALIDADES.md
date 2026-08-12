# Mapa de funcionalidades — insumo para decidir qué se cobra

Inventario **completo** de lo que hace Tuvetia hoy, para poder marcar después qué entra en el plan
gratis y qué en el pago. No decide nada: describe, ubica y —lo importante— dice **cuánto cuesta cada
cosa cada vez que se usa**.

> Estado del código: `master` @ `5909a43` (2026-08-12). Lo que está apagado o roto se marca 🔴 en su
> fila; hay un resumen al final en «Lo que hoy NO se puede vender».

---

## Antes de empezar: "CRM" quiere decir dos cosas distintas

La idea de partida fue *"todo lo de CRM va gratis"*. Hay que fijar cuál de los dos CRM, porque la
diferencia son varios módulos grandes.

**El CRM de la barra lateral** ([app-sidebar.tsx:67-85](src/components/app-sidebar.tsx#L67-L85)) es un
corte por **modo de trabajo**, no por valor comercial. Lo pidió el cliente así: *"en el consultorio
tiene el athos y el phantom… y en el CRM tiene lo demás"*. O sea, CRM ahí significa literalmente
**todo lo que no es la consulta**:

| Grupo en la barra | Qué contiene hoy |
|---|---|
| **Consultorio** | Athos, Modo Fantasma |
| **CRM** | Dashboard, Pacientes, Titulares, Agenda, **Ventas (facturación entera)**, **Comunicaciones**, Conexiones |

Si se toma ese corte literal, **gratis se llevaría el módulo de facturación completo** (inventario,
compras, DIAN, cartera) **y WhatsApp con respuesta automática**. Facturación regalada es defendible
—no cuesta nada por uso—; cartera y WhatsApp automático **no**, porque gastan IA y mensajes en cada
disparo.

Por eso este documento **no agrupa por la barra lateral**. Agrupa por módulo y le pone a cada uno su
costo marginal, que es el dato con el que se decide.

---

## Cómo leer las tablas

- **Costo/uso** — lo que le cuesta a Tuvetia cada vez que un vet lo usa. Es el que manda: lo de
  costo `—` se puede regalar sin límite; lo de costo `$$` necesita plan, tope o ambos.
  - `—` gratis (solo base de datos, ya pagada en los $25/mes fijos de Supabase)
  - `$` bajo (centavos por uso)
  - `$$` alto (decenas de centavos, o escala con el minuto/mensaje)
- **Rol** — `vet` cualquier miembro · `admin` solo administrador de clínica · `plataforma` solo
  equipo Tuvetia · `público` sin sesión.
- **¿Pago?** — columna en blanco a propósito. Es lo que hay que llenar.

---

## 1. Athos — copiloto clínico

Ruta: [/dashboard/asistente](src/app/dashboard/asistente) · desde #80 también flota en cualquier
pantalla ([athos-dock.tsx](src/components/athos/athos-dock.tsx)) sabiendo qué estás mirando.

| # | Funcionalidad | Dónde | Rol | Costo/uso | ¿Pago? |
|---|---|---|---|---|---|
| 1.1 | Chat clínico con literatura citada (RAG sobre 61.544 docs / 519.999 chunks) | `/dashboard/asistente` | vet | `$$` | |
| 1.2 | Reranking Cohere sobre los candidatos recuperados | backend | vet | `$` | |
| 1.3 | Memoria semántica del paciente (notas + transcripciones indexadas) | backend | vet | `$` | |
| 1.4 | Cascada de modelos con failover (DeepSeek → Gemini → Anthropic) | [athos-agent/cascada.ts](src/lib/athos-agent/cascada.ts) | vet | `$$` | |
| 1.5 | Athos accesible desde cualquier pantalla, con contexto de la pantalla | dock global | vet | `$$` | |
| 1.6 | Flujo «Athos propone, el vet aprueba» (tarjetas de acción) | `athos_actions` | vet | `—` | |
| 1.7 | Límite diario por clínica + anti-loop | [rate-limit.ts](src/lib/athos-agent/rate-limit.ts) | — | `—` | |

### Las 21 herramientas de Athos

Cada una es una capacidad vendible por separado. Viven en
[athos-agent/tools.ts](src/lib/athos-agent/tools.ts).

| Familia | Herramientas | Efecto | ¿Pago? |
|---|---|---|---|
| **Consulta de datos** | `search_patients`, `get_patient_summary`, `get_owner_by_phone`, `search_consultations`, `get_consultation_details` | solo lee | |
| **Agenda** | `list_appointments_on_day`, `get_clinic_hours`, `list_available_slots` | solo lee | |
| **Evidencia clínica** | `search_clinical_evidence` | lee el corpus (`$$`) | |
| **Lee comunicaciones** | `search_whatsapp_conversation`, `search_emails`, `read_email_thread` | solo lee | |
| **Escribe afuera** ⚠️ | `send_whatsapp_message`, `send_email`, `reply_email` | manda mensajes reales (`$`) | |
| **Escribe adentro** | `create_appointment`, `update_appointment`, `create_owner`, `create_patient`, `create_owner_and_patient`, `update_patient_record` | modifica la BD | |

---

## 2. Modo Fantasma — la consulta grabada

Rutas: [/dashboard/consultas](src/app/dashboard/consultas) y `/dashboard/consultas/[id]`.

| # | Funcionalidad | Rol | Costo/uso | ¿Pago? |
|---|---|---|---|---|
| 2.1 | Grabar la consulta desde el navegador | vet | `—` | |
| 2.2 | Consentimiento del titular (Ley 1581) antes de grabar | vet | `—` | |
| 2.3 | La grabación sobrevive al cambio de pantalla (#82) | vet | `—` | |
| 2.4 | Transcripción con diarización (Deepgram nova-2, español) | vet | `$$` **$0.0043/min** | |
| 2.5 | Nota SOAP redactada por IA a partir de la transcripción | vet | `$$` | |
| 2.6 | Revisión y aprobación de la nota por el vet | vet | `—` | |
| 2.7 | Audio reproducible desde la ficha (URL firmada, bucket privado) | vet | `—` | |
| 2.8 | Borrar la transcripción sin borrar el audio | vet | `—` | |
| 2.9 | Purga automática del audio a los 7 días (cron) | — | `—` | |

**Es el módulo más caro de la app.** Una consulta de 20 minutos son ~$0.09 de transcripción más la
redacción de la nota. Escala con el minuto grabado, no con el número de clínicas.

---

## 3. Pacientes y titulares — la ficha clínica

| # | Funcionalidad | Dónde | Rol | Costo/uso | ¿Pago? |
|---|---|---|---|---|---|
| 3.1 | Listado y búsqueda de pacientes | `/dashboard/patients` | vet | `—` | |
| 3.2 | Alta/edición de paciente | drawer global | vet | `—` | |
| 3.3 | Ficha con historia clínica completa | `/dashboard/patients/[id]` | vet | `—` | |
| 3.4 | Alergias (con severidad y confirmación) | ficha | vet | `—` | |
| 3.5 | Medicación (crónica y por tratamiento) | ficha | vet | `—` | |
| 3.6 | Vacunas (lote, dosis, próxima aplicación) | ficha | vet | `—` | |
| 3.7 | Archivos adjuntos en la ficha | ficha | vet | `—` | |
| 3.8 | Titulares (dueños) con sus pacientes | `/dashboard/owners` | vet | `—` | |
| 3.9 | Importar pacientes desde CSV | `/dashboard/patients/import` | admin | `—` | |
| 3.10 | Marcar fallecido | ficha | vet | `—` | |

> ⚠️ Deuda conocida (ESTADO.md): la distribución maestro-detalle de la ficha se considera confusa y
> hay un rediseño pendiente. No cambia qué se cobra, pero sí cuánto aguanta un plan pago.

---

## 4. Agenda

| # | Funcionalidad | Rol | Costo/uso | ¿Pago? |
|---|---|---|---|---|
| 4.1 | Calendario mes/semana/día con drag & drop | vet | `—` | |
| 4.2 | Crear/editar/cancelar citas | vet | `—` | |
| 4.3 | Horarios de atención de la clínica | admin | `—` | |
| 4.4 | Cupos disponibles calculados (determinístico, sin IA) | vet | `—` | |
| 4.5 | Sincronización con **Google Calendar** (vía Composio) | admin | `—` | |
| 4.6 | Sincronización con **Outlook Calendar** (vía Composio) | admin | `—` | |
| 4.7 | La cita va al calendario del **administrador**, con el vet invitado | admin | `—` | |
| 4.8 | Feed **ICS** de solo lectura (cualquier calendario) | vet | `—` | |

Detalle en [CALENDARIO.md](CALENDARIO.md). Costo marginal cero: Composio no cobra por evento.

---

## 5. Ventas / Facturación — 16 rutas

Es el módulo más grande del repo y el de **costo marginal cero**. Dominio puro con 185 tests.

| # | Funcionalidad | Ruta | Rol | Costo/uso | ¿Pago? |
|---|---|---|---|---|---|
| 5.1 | Emitir factura | `/facturacion/nueva` | vet | `—` | |
| 5.2 | Ver / imprimir factura | `/facturacion/[id]`, `/imprimir` | vet | `—` | |
| 5.3 | Factura pública para el cliente (sin sesión) | `/f/[token]` | público | `—` | |
| 5.4 | Enviar la factura por correo | acción | vet | `$` Resend | |
| 5.5 | Núcleo fiscal **DIAN** (numeración, reglas, sandbox) | `facturacion/fiscal` | admin | `—` | |
| 5.6 | Catálogo de servicios y productos | `/facturacion/catalogo` | admin | `—` | |
| 5.7 | Inventario con stock | `/facturacion/inventario` | admin | `—` | |
| 5.8 | Movimientos de inventario | `/inventario/movimientos` | admin | `—` | |
| 5.9 | Importar inventario desde Excel | `/inventario/importar` | admin | 🔴 **apagado** | |
| 5.10 | Compras y órdenes | `/facturacion/compras` | admin | `—` | |
| 5.11 | Proveedores | `/compras/proveedores` | admin | `—` | |
| 5.12 | Gastos | `facturacion/expenses` | admin | `—` | |
| 5.13 | Pagos y abonos | `facturacion/payments` | admin | `—` | |
| 5.14 | Finanzas / reportes | `/facturacion/finanzas` | admin | `—` | |
| 5.15 | Configuración fiscal de la clínica | `/facturacion/configuracion` | admin | `—` | |
| 5.16 | Carga de recetas por foto o texto (IA) | acción | vet | `$$` | |

### 5b. Cartera — el motor de cobranza (⚠️ vive dentro de Ventas pero **sí cuesta**)

| # | Funcionalidad | Rol | Costo/uso | ¿Pago? |
|---|---|---|---|---|
| 5b.1 | Recordatorios de pago programados | admin | `$` por mensaje | |
| 5b.2 | Envío por **WhatsApp** y por **correo** | admin | `$` | |
| 5b.3 | Límites de la **Ley 2300** (horarios y frecuencia) | — | `—` | |
| 5b.4 | Lee las respuestas del cliente por Composio y clasifica el intent con IA | admin | `$$` | |
| 5b.5 | Detecta comprobantes de pago y escala a una persona | admin | `$` | |
| 5b.6 | Barrido diario (cron en GitHub Actions) | — | `$` | |
| 5b.7 | Antigüedad de cartera (aging) | admin | `—` | |

**Este es el ejemplo exacto del problema del corte por barra lateral:** cartera está bajo "Ventas",
que está bajo "CRM", pero cada ciclo gasta IA y mensajes. Regalarla es regalar consumo variable.

---

## 6. Comunicaciones

| # | Funcionalidad | Rol | Costo/uso | ¿Pago? |
|---|---|---|---|---|
| 6.1 | Bandeja de WhatsApp con historial por titular | vet | `—` | |
| 6.2 | Enviar y recibir WhatsApp | vet | `$` por conversación (Meta) | |
| 6.3 | Realtime en la bandeja | vet | `—` | |
| 6.4 | Recepción de media (audio, imagen, documento) | vet | `—` | |
| 6.5 | **Athos sugiere la respuesta** (el vet aprueba antes de enviar) | vet | `$$` | |
| 6.6 | **Modo automático**: Athos responde solo (opt-in, nunca nada clínico) | admin | `$$` | |
| 6.7 | Tope diario de respuestas automáticas + anti-loop | — | `—` | |
| 6.8 | Bandeja de **correo** leída en vivo (Gmail/Outlook por Composio) | vet | `—` | |
| 6.9 | Responder correo desde la app | vet | `—` | |

---

## 7. Conexiones

| # | Funcionalidad | Rol | Costo/uso | ¿Pago? |
|---|---|---|---|---|
| 7.1 | WhatsApp por **Meta oficial** (Embedded Signup) | admin | `—` | |
| 7.2 | WhatsApp por **Evolution API** (Baileys, sin trámite Meta) | admin | `—` | |
| 7.3 | Correo de Athos: **Gmail** (OAuth por Composio) | vet | `—` | |
| 7.4 | Correo de Athos: **Outlook** (OAuth por Composio) | vet | `—` | |
| 7.5 | Calendario: Google / Outlook | admin | `—` | |
| 7.6 | Aviso cuando el dominio del remitente no puede autenticar | — | `—` | |

Una cuenta de correo por persona (conectar la segunda desconecta la primera). Ver
[CORREOS.md](CORREOS.md) y [WHATSAPP.md](WHATSAPP.md).

---

## 8. Equipo, cuenta y configuración

| # | Funcionalidad | Rol | Costo/uso | ¿Pago? |
|---|---|---|---|---|
| 8.1 | Invitar colegas por link | admin | `—` | |
| 8.2 | Enviar la invitación por correo (Resend) | admin | `$` | |
| 8.3 | Roles: administrador y veterinario | admin | `—` | |
| 8.4 | Quitar miembros | admin | `—` | |
| 8.5 | Pertenecer a **varias clínicas** y cambiar entre ellas | vet | `—` | |
| 8.6 | Datos y logo de la clínica | admin | `—` | |
| 8.7 | Horarios de atención | admin | `—` | |
| 8.8 | Login por contraseña y por magic link | público | `—` | |

**Candidato natural a límite de plan:** el número de miembros por clínica (8.1–8.4). Hoy no hay
ningún tope.

---

## 9. Onboarding y ayuda

| # | Funcionalidad | Rol | Costo/uso | ¿Pago? |
|---|---|---|---|---|
| 9.1 | Wizard de bienvenida (`/bienvenida`) | admin | `—` | |
| 9.2 | Tour guiado con driver.js | vet | `—` | |
| 9.3 | **Riel de configuración** que no se puede cerrar para siempre (#85) | admin | `—` | |
| 9.4 | Datos de ejemplo borrables ("Luna") | admin | `—` | |
| 9.5 | Marcadores de ayuda contextual | vet | `—` | |
| 9.6 | Página de ayuda | vet | `—` | |

El riel mide 6 pasos: logo · horarios · primer paciente · servicios en el catálogo · WhatsApp
conectado · equipo invitado.

---

## 10. Datos y cumplimiento

| # | Funcionalidad | Rol | Costo/uso | ¿Pago? |
|---|---|---|---|---|
| 10.1 | **Exportar todo** en JSON abierto (promesa de no-lock-in) | vet | `—` | |
| 10.2 | Aislamiento multi-clínica por RLS | — | `—` | |
| 10.3 | Consentimiento y purga de audio (Ley 1581) | — | `—` | |
| 10.4 | Registro de auditoría (`audit_logs`) | — | `—` | |
| 10.5 | Verificación del destinatario al responder correo | — | `—` | |

⚠️ 10.1 exporta 10 tablas incluyendo transcripciones y notas clínicas. **Si se pone detrás del plan
pago, deja de ser la promesa de no-lock-in.** Recomendación: gratis siempre.

---

## 11. Panel de plataforma (interno — no se le vende a nadie)

Ruta `/admin`, con gate por `PLATFORM_ADMIN_EMAILS`.

| # | Funcionalidad | Rol |
|---|---|---|
| 11.1 | Resumen de todas las clínicas | plataforma |
| 11.2 | Listado de clínicas | plataforma |
| 11.3 | Uso de IA por clínica | plataforma |
| 11.4 | **Costos estimados por proveedor y por superficie** (#81) | plataforma |
| 11.5 | Usuarios + envío masivo de correo (tope 12 por tanda) | plataforma |

**11.4 es la herramienta con la que se valida el pricing que salga de este documento.** Ya distingue
costo real medido por tokens de estimación por llamada.

---

## 12. Público (sin sesión)

| # | Funcionalidad | Ruta |
|---|---|---|
| 12.1 | Landing | `/` |
| 12.2 | Producto | `/producto` |
| 12.3 | Seguridad | `/seguridad` |
| 12.4 | Demo | `/demo` |
| 12.5 | Términos y privacidad | `/legal/*` (🔴 placeholder) |
| 12.6 | Aceptar invitación | `/invitar/[token]` |
| 12.7 | Ver y pagar factura | `/f/[token]` |

---

## Resumen ejecutivo: dónde está el costo

Esto es lo único que hay que mirar para decidir. Tarifas reales de
[admin/pricing.ts](src/lib/admin/pricing.ts).

### Lo que cuesta plata cada vez que se usa
| Concepto | Tarifa | Qué funcionalidades lo disparan |
|---|---|---|
| Transcripción Deepgram | **$0.0043/min** | 2.4 (Modo Fantasma) |
| Generación LLM | $0.004–$0.024 por llamada | 1.1, 2.5, 5.16, 5b.4, 6.5, 6.6 |
| Cohere embed + rerank | $0.0026 por búsqueda | 1.1, 1.2 |
| WhatsApp (Meta) | por conversación | 6.2, 5b.2 |
| Correo (Resend) | por envío | 5.4, 5b.2, 8.2 |

### Lo que no cuesta nada por uso
**Todo lo demás.** Pacientes, titulares, historia clínica, agenda con sus dos sincronizaciones,
facturación entera con DIAN e inventario, bandejas, conexiones, equipo, onboarding y export. El único
costo es la infra fija: **$25/mes de Supabase** (Railway y Vercel hoy facturan $0).

### La conclusión que sale sola
El corte natural **no es Consultorio vs CRM**. Es:

- **Gratis, sin riesgo:** todo lo que no gasta por uso — que es la mayor parte del producto,
  incluida la facturación completa, que es de lo más caro de construir y de lo más barato de operar.
- **Pago o con tope:** las **6 superficies de IA** (1.1, 2.4+2.5, 5.16, 5b.4, 6.5, 6.6) y los
  **mensajes salientes** (WhatsApp y correo).

Con ese corte, "todo lo de CRM gratis" se cumple casi entero. Las únicas dos piezas que hay que sacar
del CRM y pasar a pago son **cartera automática (5b)** y **la IA de la bandeja (6.5, 6.6)** —
justamente las dos que gastan sin que el vet lo note.

---

## Lo que hoy NO se puede vender 🔴

Antes de poner precio, esto está apagado o incompleto:

1. **Correo transaccional sin credencial.** `RESEND_API_KEY` no está configurada. Hoy no sale ni una
   factura por correo (5.4), ni un recordatorio de cartera (5b.2), ni una invitación (8.2). El código
   está bien; falta la key y verificar el dominio en Resend.
2. **Importar inventario desde Excel (5.9).** Apagado a propósito por la vulnerabilidad de
   `xlsx@0.18.5` (prototype pollution + ReDoS, sin fix). Se levanta reemplazando la librería.
3. **Páginas legales (12.5).** Placeholder. Cobrar sin términos de servicio reales no es viable.
4. **Athos nunca se abstiene.** Documentado en ESTADO.md: responde con la misma soltura tenga o no
   literatura que cubra la pregunta. Es un riesgo de producto en el módulo que más se va a cobrar.
5. **No hay medición de consumo por clínica de cara al cliente.** El panel `/admin` (11.4) mide
   costos para Tuvetia, pero no existe "te quedan N consultas este mes" ni nada que soporte un plan
   con tope. **Si el plan pago tiene límites, esto hay que construirlo.**

---

## Lo que este documento no trae

- **Precios.** No hay ninguna cifra de venta acá, solo costos.
- **Los planes.** La columna «¿Pago?» está vacía a propósito.
- **Cobro.** No existe integración de pagos para las clínicas (Stripe/Wompi/etc.): el módulo de
  facturación factura a los *clientes de la clínica*, no cobra la suscripción de Tuvetia. Eso es
  construcción nueva.
