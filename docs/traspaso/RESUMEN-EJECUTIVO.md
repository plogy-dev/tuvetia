# Tuvetia — qué estás recibiendo

> Cuatro páginas, sin tecnicismos. Es el documento para entender **qué tienes, qué cuesta y de quién
> depende**. El detalle técnico está en los otros archivos de esta carpeta, para tu desarrollador.

---

## Qué es Tuvetia, en una frase

Un programa de gestión para clínicas veterinarias con un asistente de inteligencia artificial
—**Athos**— que escucha la consulta, redacta la nota clínica, responde WhatsApp y gestiona el cobro.
**Siempre con aprobación de un veterinario**: Athos propone, la persona decide.

## Las cinco cosas que hace

1. **Historia clínica.** Pacientes, dueños, consultas, vacunas y medicación.
2. **Nota clínica automática.** Graba la consulta, la transcribe en vivo, y redacta la nota citando
   literatura veterinaria verificable. El veterinario la revisa y la firma; **hasta que no la firma,
   no entra a la historia**.
3. **WhatsApp y correo.** Conversaciones con los dueños, con respuestas que Athos propone.
4. **Facturación y cobranza.** Facturas, catálogo de servicios, y recordatorios de pago automáticos.
5. **Agenda.** Citas, con Athos capaz de agendar cuando el veterinario aprueba.

## Las dos reglas que protegen a la clínica

Están en el código, no en un manual — no dependen de que alguien se acuerde:

- **Ninguna nota entra a la historia clínica sin que un veterinario la firme.** Y una vez firmada, no
  se puede editar.
- **Athos no da diagnósticos cerrados ni dosis si le faltan datos** (especie, peso, edad). Y si no
  encuentra evidencia suficiente en la literatura, **lo dice en vez de inventar**.

---

## De qué depende para funcionar

Tuvetia no es un programa que corra en un computador de la clínica: son **quince servicios de
internet** trabajando juntos. Si uno se cae, se cae la parte que depende de él — no todo.

| Lo que sostiene | Qué pasa si se cae |
|---|---|
| **Supabase** — la base de datos | Es lo único irremplazable: ahí viven las historias clínicas |
| **Vercel** — la aplicación web | Nadie puede entrar |
| **Railway** — el asistente Athos | La aplicación funciona; Athos no responde |
| **Railway** — el servidor de WhatsApp | No entran ni salen mensajes |
| **Cinco proveedores de IA** | Athos deja de responder. Están encadenados: si uno falla, entra el siguiente |
| **Composio** — correo de Athos | Athos no puede mandar correos |
| **Resend** — correo del sistema | Las facturas no salen por correo |

El detalle completo, con quién es dueño de cada cuenta, está en `INVENTARIO.md`.

### Costos mensuales

| Servicio | Costo/mes | A qué medio de pago |
|---|---|---|
| *(pendiente de completar)* | | |

**Dos cosas que conviene decidir pronto:**

- **Vercel está en el plan gratuito (Hobby).** Funciona, pero limita a dos tareas automáticas diarias
  —ya usadas— y guarda los registros de error muy poco tiempo. Pasar a plan pago destraba las dos
  cosas.
- **El almacenamiento de archivos de WhatsApp crece sin límite.** Hoy se guardan todas las fotos y
  audios que llegan por WhatsApp, y nada los borra. Lo medido son **258 MB en nueve días de un solo
  número**; a ese ritmo serían unos 860 MB al mes por clínica, aunque el ritmo real de una clínica
  puede ser otro. Con varias clínicas se vuelve un costo que sube todos los meses. Tiene arreglo y es
  acotado.

---

## Lo que falta antes de abrir a clínicas de verdad

Dicho sin adornos, porque es lo que más importa de este documento.

### 🔴 La política de tratamiento de datos no existe

Las páginas de *Política de privacidad* y *Términos de servicio* están publicadas pero dicen
**"Documento en preparación"**. Mientras tanto el sistema ya guarda cédulas, direcciones, teléfonos,
conversaciones completas de WhatsApp y **grabaciones de voz con su transcripción**.

La Ley 1581 de 2012 obliga a tener esa política y a nombrar un **responsable del tratamiento** — una
empresa concreta, con NIT. **Eso todavía no está decidido, y sin decidirlo no se puede lanzar.**

Lo que sí está bien hecho: antes de grabar una consulta, el sistema **exige** el consentimiento del
dueño, guarda qué texto exacto aceptó, y la base de datos lo bloquea si falta. La pieza difícil está
resuelta; falta el documento que la enmarca.

### 🔴 WhatsApp guarda conversaciones que no son de la clínica

Al conectar un número de WhatsApp, el sistema guarda **todas** sus conversaciones — no sólo las de
clientes. Medido en las cuentas de prueba: de 6.666 mensajes guardados, **el 98,7 % no corresponde a
ningún cliente**, y **83 de 85 personas** no tenían nada que ver con la clínica.

Es un problema de diseño con arreglo, y hay que decidirlo antes de escribir la política de datos —
porque no se puede documentar algo que no queremos hacer. Mientras tanto: **que las clínicas conecten
un número que usen sólo para la clínica.**

### 🟡 Nadie se entera si algo se rompe

No hay un servicio contratado que avise cuando falla algo. Los fallos quedan escritos, pero hay que ir
a mirarlos. **Se decidió aplazarlo a propósito:** mientras los usuarios son el equipo, el que ve el
problema es el mismo que puede revisarlo. Al abrir a clínicas de verdad esto cambia, porque un
veterinario con la pantalla rota muchas veces no llama — simplemente deja de usarlo.

---

## En qué estado está el producto

Se auditó completo el **16 de agosto de 2026**: nueve hallazgos, los nueve cerrados. El informe con la
evidencia está en `docs/AUDITORIA-COMPLETA-2026-08-16.md`.

Dos ejemplos de lo que esa auditoría encontró y arregló, para dar una idea del nivel de revisión:

- **Ninguna clínica podía facturar.** Ninguna de las 15 cuentas de prueba tenía un solo servicio en su
  catálogo, y sin eso el sistema no emite facturas. La causa: el asistente de configuración inicial no
  lo pedía. Ya lo pide.
- **WhatsApp llevaba cinco días caído y nadie se enteró.** Ahora el sistema lo avisa en pantalla, con
  cuántos días lleva.

**El producto tiene 998 pruebas automáticas** que corren en cada cambio. No es una garantía de que no
haya errores; es una garantía de que los errores conocidos no vuelven.

---

## A quién llamar

| Para qué | Quién | Contacto |
|---|---|---|
| Desarrollo y mantenimiento | *(pendiente)* | |
| Pagos y suscripciones (Wompi) | Santiago | |
| Base de conocimiento clínico | Jesús | |
| Soporte a las clínicas | *(pendiente de definir)* | |

Hoy la aplicación tiene una página de **Ayuda** con un enlace de WhatsApp para que las clínicas
escriban. **Ese número tiene que apuntar a alguien que responda** — conviene revisarlo antes de abrir.

---

## Los documentos de esta carpeta

| Archivo | Para quién |
|---|---|
| **`RESUMEN-EJECUTIVO.md`** | Este. Para vos |
| `INVENTARIO.md` | Las quince cuentas, quién es dueño y cómo se traspasa cada una |
| `RUNBOOK.md` | Tu desarrollador: cómo desplegar, migrar la base, rotar claves |
| `INCIDENTES.md` | Tu desarrollador: qué fallos son normales y cuáles no |
