---
titulo: La agenda
seccion: guias
orden: 20
resumen: Citas, horarios por persona, huecos del día, quién ve qué, y cómo se sincroniza con Google u Outlook.
---

# La agenda

`/dashboard/calendario`

## Qué hay en la pantalla

1. **"Hoy"** — el día como lista, con las citas y los **huecos** intercalados por hora. Un hueco dice
   *"40 minutos libres"* y ofrece llenarlo con Athos.
2. **La grilla** — react-big-calendar, vistas Semana y Agenda, con arrastrar y redimensionar.

La lista existe además de la grilla porque aporta dos cosas que la grilla no da: el día de un vistazo
sin contar cuadraditos, y **el hueco como fila accionable** — en la grilla el vacío es ausencia de
bloques: no se ve, no se cuenta y no se puede tocar.

## Quién ve qué agenda

Hay **una sola agenda** (`appointments`), aislada por clínica. Una cita "es de" alguien porque tiene
`vet_id`. Lo que cambia entre personas es **qué citas le manda la consulta**:

| Quién mira | Qué citas se traen |
|---|---|
| **Admin** | Todas las de la clínica |
| **Vet con `ve_agenda_completa`** | Todas las de la clínica |
| **Vet sin el permiso** | Sólo las suyas **+ las sin asignar** |

Dos detalles que sorprenden:

- **El interruptor arranca siempre en "Mi agenda"**, incluso para el admin, con un `+N` diciendo
  cuántas está escondiendo. La pantalla cargaba todas mezcladas y con cuatro veterinarios cada uno
  veía tres agendas ajenas encima de la suya.
- **Las citas sin veterinario las ve todo el mundo**, en las dos vistas, con un contador
  *"N sin asignar"*. Entre que aparezca de más y que no aparezca para nadie, la segunda es la que
  termina en un paciente que no fue.

El permiso **se aplica en la consulta, no en el navegador**: sin él, las citas ajenas nunca llegan al
cliente. Ver [Roles y permisos](../30-referencia/50-roles-y-permisos.md).

## Crear y mover citas

Al crear, son **obligatorios**: paciente, titular, veterinario y motivo. Y el paciente **debe
pertenecer al titular indicado** — el formulario lo bloquea en vivo y la RPC lo rechaza igual.

Elegir un paciente autocompleta el titular.

### El antisolape

Un veterinario **no puede quedar con dos citas vivas encima** (`scheduled`, `confirmed`,
`in_progress`), salvo que se marque explícitamente `permite_solape`.

Tres decisiones detrás:

- **Es un trigger, no un chequeo en las RPC.** Arrastrar una cita en el calendario hace un `update`
  directo que se salta las funciones: una guarda ahí dejaría abierta justo la vía por la que más
  fácil se produce el solape.
- **No es una restricción de exclusión**, que lo haría imposible. Una clínica sí necesita solapar a
  veces —entra una urgencia—: prohibirlo del todo no elimina el caso, lo empuja a un papel.
- **La válvula es una columna de la cita**, no un parámetro, para que la decisión quede escrita y se
  pueda responder después *"¿esta cita se agendó encima de otra a propósito?"*.

El mensaje de error dice **con cuál** choca y a qué hora, en horario de Bogotá.

## Horarios

Desde Configuración → Horarios de atención, con dos pestañas:

- **Clínica** — el horario de la puerta. Lo edita cualquier miembro.
- **El mío** — el horario propio, que **reemplaza al de la clínica día por día**.

Que el reemplazo sea por día y no en bloque es la decisión que importa: si definir un día personal
apagara la semana entera, cargar *"los martes entro a las 2"* dejaría a esa persona sin horario de
miércoles a lunes, y nadie lo leería antes de que un titular se quede sin cupo.

El horario personal lo edita su dueño o un admin. El de un compañero **se lee** —hace falta para
agendar con él— pero no se escribe.

Esto salió de que los correos salían con la hora equivocada: *"lo manda desde su correo… el horario
es el suyo y no es el mío"*. El sistema conocía un solo horario y se lo aplicaba a todos, así que un
vet que entra a las 2 aparecía disponible a las 8.

## Sincronización con Google u Outlook

Es de **una sola vía**: Tuvetia escribe, nunca lee. No existe *pull*, y no es un filtro mejor: el
canal no existe.

- El evento se crea en el calendario del **veterinario asignado**, con el del **administrador de
  respaldo** si esa persona no conectó el suyo.
- Van **invitados**: el titular, **todos los administradores** y quien agendó la cita.
- Se adjunta la **dirección de la clínica**, que el teléfono del titular convierte en un enlace a
  mapas.
- Cada persona conecta su calendario desde **Integraciones**, y la agenda se lo pide con una ventana
  a quien entra sin conectarlo.

Que los administradores vayan invitados es lo que hace que un admin siga teniendo la clínica entera
en su calendario mientras cada vet tiene la suya.

### El enlace ICS

Alternativa de solo lectura, sin OAuth: genera una URL secreta que se pega en cualquier calendario.
**El token es la credencial.** Limitación: los proveedores refrescan los ICS externos lento (horas).

## Athos y la agenda

- En el chat, `list_available_slots` calcula cupos **de una persona**, con su horario propio. Sin
  especificar veterinario resta las citas de todos, que es más restrictivo de lo real.
- Por WhatsApp, un titular ve el horario **de la clínica** (no elige vet) y su pedido queda
  **pendiente de confirmación**: Athos nunca agenda solo.
