# Política de Tratamiento de la Información — Tuvetia

**Ley 1581 de 2012 · Decreto 1074 de 2015**

> ## ⚠️ Antes de publicar
>
> **1. Falta el responsable del tratamiento.** La Ley 1581 exige nombrar una **persona jurídica
> concreta**, con NIT y dirección. Está marcado como `[[ ... ]]` en el texto y **no se puede publicar
> sin resolverlo** — es una decisión comercial, no técnica.
>
> **2. Esto lo revisa un abogado.** Está redactado sobre el inventario **real** de datos —medido
> contra la base el 2026-08-17, no copiado de una plantilla— pero la redacción legal y la suficiencia
> frente a la SIC no las puedo certificar.
>
> **3. Hay una decisión de producto pendiente** que cambia el texto: la ingestión de WhatsApp. Ver la
> sección 4.

---

## 1. Responsable del tratamiento

| | |
|---|---|
| Razón social | `[[ POR DEFINIR ]]` |
| NIT | `[[ POR DEFINIR ]]` |
| Domicilio | `[[ POR DEFINIR ]]` |
| Correo para ejercer derechos | `[[ POR DEFINIR ]]` |
| Teléfono | `[[ POR DEFINIR ]]` |

**La clínica veterinaria** que usa Tuvetia es **Responsable** de los datos de sus titulares.
**Tuvetia** actúa como **Encargado**, tratándolos por cuenta de la clínica y siguiendo sus
instrucciones.

---

## 2. Qué datos se tratan

Inventario levantado consultando la base de producción. **No es una lista genérica: es lo que el
sistema guarda hoy.**

### 2.1 De los titulares (dueños de las mascotas)

| Dato | Dónde |
|---|---|
| Nombre completo | `owners.full_name` |
| **Documento de identidad** | `owners.document_id` |
| Dirección, teléfono, correo | `owners.address`, `.phone`, `.email` |
| Notas que la clínica registre | `owners.notes` |

### 2.2 Comunicaciones

| Dato | Dónde |
|---|---|
| **Contenido de los mensajes de WhatsApp** y los números | `whatsapp_messages.body`, `.wa_phone_from`, `.wa_phone_to` |
| Archivos enviados por WhatsApp (fotos, audios) | Almacenamiento privado |
| **Contenido de correos** y direcciones | `email_messages` |

### 2.3 Voz — el dato más sensible del sistema

| Dato | Tratamiento |
|---|---|
| **Grabación de la consulta**, que incluye la voz del titular | Se conserva **4 días** y se borra |
| **Transcripción** de esa grabación | Se conserva como parte de la historia clínica |

**El consentimiento es previo y bloqueante**: sin él la aplicación no habilita el micrófono, y la
base de datos lo impide con un disparador. Se registra **qué texto exacto** aceptó el titular
(`consents.text_version`), de modo que siempre se puede probar a qué consintió.

### 2.4 Del personal de la clínica

Nombre, teléfono, correo y rol (`profiles`). Y la **dirección IP** en el registro de auditoría
(`audit_logs.ip_address`).

### 2.5 Facturación

Datos del adquiriente —nombre, documento, dirección, teléfono, correo— y de proveedores, incluido
NIT. Exigidos por la normativa tributaria.

### 2.6 Lo que NO son datos personales

**La historia clínica es de un ANIMAL.** Un animal no es titular de datos personales, así que su
ficha clínica —especie, peso, diagnósticos, tratamientos— **no constituye dato sensible de salud**
en los términos de la Ley 1581.

Lo sensible es lo humano que la rodea: la **voz** del titular y su **documento de identidad**.

---

## 3. Para qué se tratan

1. **Prestar el servicio veterinario**: historia clínica, agenda, seguimiento.
2. **Comunicarse con el titular**: recordatorios de cita, resultados, respuestas a sus mensajes.
3. **Facturar y cobrar**, conforme a la normativa tributaria.
4. **Asistir al veterinario con inteligencia artificial**: redactar la nota clínica a partir de la
   consulta y sugerir respuestas. **Toda propuesta requiere aprobación del veterinario** — el sistema
   no actúa solo.
5. **Seguridad y trazabilidad**: registrar quién hizo qué, para poder responderlo después.

### Lo que NO se hace

- **No se venden ni ceden datos a terceros** con fines comerciales.
- **No se usan los datos de una clínica para entrenar modelos**, ni para beneficiar a otra clínica.
- **Ninguna clínica ve los datos de otra.** Está impuesto por seguridad a nivel de fila en la base,
  no por una regla de la aplicación.

---

## 4. Encargados y transferencias

Para operar, el sistema usa proveedores que pueden procesar datos:

| Proveedor | Qué procesa |
|---|---|
| **Supabase** | Almacenamiento de toda la base |
| **DeepSeek, Anthropic, Google** | Texto de la consulta para redactar la nota o la respuesta |
| **Deepgram** | Audio de la consulta para transcribirlo |
| **Cohere** | Búsqueda semántica en la literatura veterinaria |
| **Evolution API** | Mensajería de WhatsApp — servidor propio |
| **Composio** | Correo y calendario del veterinario |
| **Resend** | Envío de facturas y recordatorios |

Varios operan **fuera de Colombia**, lo que constituye transferencia internacional bajo el artículo
26 de la Ley 1581.

> ### 🔴 Decisión de producto pendiente, y cambia este texto
>
> Al conectar un número de WhatsApp, el sistema ingiere **todas** las conversaciones de ese número,
> no sólo las de clientes de la clínica. Medido en producción: **el 98,7 % de los mensajes
> almacenados no corresponde a ningún titular registrado**.
>
> Antes de publicar hay que decidir si eso se limita —guardar sólo lo de titulares conocidos— o si se
> declara explícitamente. **No se puede documentar un tratamiento que no queremos hacer.**
>
> Recomendación operativa mientras tanto: que cada clínica conecte un número que use **sólo** para la
> clínica.

---

## 5. Derechos del titular

Todo titular puede, en cualquier momento:

- **Conocer** qué datos suyos existen y cómo se tratan
- **Actualizar y rectificar** los que estén incompletos o desactualizados
- **Solicitar prueba** de la autorización que otorgó
- **Revocar la autorización** y **solicitar la supresión** cuando no exista deber legal de conservar
- **Presentar quejas** ante la Superintendencia de Industria y Comercio
- **Acceder gratuitamente** a sus datos

### Cómo ejercerlos

Escribiendo a `[[ CORREO POR DEFINIR ]]`, indicando nombre, documento y qué solicita.

**Plazos legales:** consultas, **10 días hábiles**; reclamos, **15 días hábiles** — prorrogables
según la ley.

> **Nota operativa sobre la supresión.** El registro de auditoría guarda el valor anterior de los
> campos modificados, así que una supresión debe barrer también `audit_logs`. Hay una consulta
> preparada para eso; no es automática.

---

## 6. Conservación

| Dato | Cuánto |
|---|---|
| **Audio de consultas** | **4 días**, y se borra automáticamente |
| Transcripción y nota clínica | Mientras dure la relación, y después según la ley aplicable a la historia clínica |
| Datos de facturación | Lo que exija la normativa tributaria |
| Mensajes de WhatsApp y correo | Mientras la clínica los conserve |
| Registro de auditoría | Mientras exista la clínica |

---

## 7. Seguridad

Medidas efectivamente implementadas, no declarativas:

- **Aislamiento por clínica** impuesto en la base de datos (RLS), no en la aplicación. Verificado el
  2026-08-17: **todas las tablas legibles por la aplicación tienen RLS activa**
- **Cifrado de credenciales de terceros** con AES-256-GCM
- **Consentimiento de grabación bloqueante**, exigido por disparador de base de datos
- **Nota clínica inmutable** una vez aprobada por el veterinario
- **Registro de auditoría** de creaciones, modificaciones y eliminaciones
- **Borrado automático del audio** a los 4 días
- **Control de acceso por rol** y allowlist para el panel de administración

---

## 8. Vigencia

Rige desde `[[ FECHA DE PUBLICACIÓN ]]`. Los cambios sustanciales se comunicarán por la aplicación o
por correo antes de entrar en vigor.

---

### Registro Nacional de Bases de Datos

Según el tamaño del responsable, puede corresponder inscribir las bases ante la SIC. **Queda por
evaluar** una vez definido quién es el responsable.
