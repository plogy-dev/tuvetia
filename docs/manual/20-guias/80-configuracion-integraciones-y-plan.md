---
titulo: Configuración, Integraciones y Plan
seccion: guias
orden: 80
resumen: Las tres pantallas de administración: datos de la clínica y equipo, conectores externos, y la suscripción.
---

# Configuración, Integraciones y Plan

## Configuración — `/dashboard/settings`

### Clínica

Nombre y rol (solo lectura) y la **dirección**, editable sólo por un administrador.

La dirección no es un dato de adorno: **se adjunta a cada cita que se crea en el calendario**, para
que al titular le llegue en la invitación y pueda abrirla en el mapa. Sin ella, la invitación dice a
qué hora pero no dónde.

Quién puede editarla no lo decide el componente: la policy `clinics_update` ya exige rol `admin`.

### Equipo

Los miembros de la clínica, las invitaciones pendientes y —para un admin— tres acciones:

- **Invitar** por correo (con token y vencimiento).
- **Quitar** a alguien de la clínica.
- **Otorgar el permiso de ver toda la agenda**, sin volverlo admin.

Ese último va por RPC y no por un `update` directo, y no es preferencia de estilo: un trigger en
`profiles` bloquea que esa columna se escriba desde el cliente. La policy de `profiles` deja que cada
uno edite su propio perfil, así que sin esa guarda cualquiera se lo daría a sí mismo desde la consola
del navegador.

### Horarios de atención

Dos pestañas: **Clínica** y **El mío**. Ver [La agenda](20-la-agenda.md#horarios).

Los usa Athos para proponer citas con cupos reales y para responder *"¿a qué hora abren?"* por
WhatsApp. **Sin horarios, no propone ni responde eso.**

### Tu perfil

Nombre y cierre de sesión.

### Tus datos

El export completo en JSON abierto. Ver [Pacientes y titulares](30-pacientes-y-titulares.md#exportar-todo).

---

## Integraciones — `/dashboard/conexiones`

Todo lo que conecta Tuvetia con el mundo de afuera.

### WhatsApp

El estado del número y el conector. El QR se escanea acá mismo y en Comunicaciones.

### Facturas y cobranza

**No hay nada que conectar**, y la pantalla lo dice. Las facturas salen por el correo de Tuvetia a
nombre de la clínica. Es una nota deliberada: antes había un formulario que pedía una contraseña de
aplicación de Gmail para un SMTP que ya no se usaba.

### Correo de Athos

**Tu** cuenta, no la de la clínica. Cada miembro conecta la suya —Gmail u Outlook— y Athos usa la de
quien le está pidiendo algo. Tuvetia no ve la contraseña: la autorización la maneja el proveedor.

### Calendario

Lo conectan **los dos roles**. Cada cita se crea en el calendario del veterinario asignado e invita
al titular, a todos los administradores y a quien la agendó.

Advertencia que la pantalla da a tiempo: **con Microsoft, calendario y correo son la misma cuenta**.
Desconectar uno desconecta el otro.

---

## Plan — `/dashboard/plan`

La comparación entre `free` y `pro`, y la contratación.

- **Sólo un administrador** puede contratar o cancelar.
- El pago se hace acá y sólo acá: el formulario de tarjeta no vive dentro de las ventanas de
  invitación a Pro. Pedirle una tarjeta a alguien que estaba en medio de una consulta es lo que esa
  separación evita.
- El número de tarjeta **va del navegador a Wompi directo**, sin pasar por nuestro servidor.
- Hay una **prueba gratuita de 3 días**.

Si las llaves de Wompi no están configuradas, la pantalla muestra la comparación pero avisa que los
pagos no están habilitados. Nada más se rompe.

### La ventana de invitación a Pro

Cuando alguien en plan gratis intenta usar una capacidad de pago, aparece una ventana que **nombra lo
que acaba de intentar** —"Athos es parte del plan Pro"— y lleva a `/dashboard/plan`. Una ventana
genérica se lee como publicidad; una que nombra lo que intentaste se lee como una respuesta.

---

## Ayuda — `/dashboard/ayuda`

Cubre las nueve secciones del producto y termina con un contacto real por WhatsApp. (Antes cubría
cuatro de nueve y decía "escribinos" sin un solo enlace de contacto en todo el dashboard.)

---

## Panel de plataforma — `/admin`

**No es parte del producto.** Es el panel interno de Tuvetia y se entra por la allowlist
`PLATFORM_ADMIN_EMAILS`, no por el rol de ninguna clínica.

| Ruta | Qué muestra |
|---|---|
| `/admin` | Métricas de la plataforma |
| `/admin/clinicas` | Todas las clínicas |
| `/admin/usuarios` | Todos los usuarios, con **todas** sus clínicas (`memberships`) |
| `/admin/uso` | Uso |
| `/admin/costos` | Costos |
| `/admin/docs` | **Esta documentación** |

Corre con `service_role`: ve todas las clínicas. Por eso el gate es una allowlist explícita y sin la
variable **no entra nadie**.
