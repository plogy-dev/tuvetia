---
titulo: Multi-inquilino y RLS
seccion: explicacion
orden: 10
resumen: Cómo se aíslan las clínicas, por qué el aislamiento vive en la base y no en el código, y dónde están las excepciones.
---

# Multi-inquilino y RLS

## El modelo

Una sola instalación, muchas clínicas, y ninguna ve los datos de otra. Casi toda tabla tiene
`clinic_id`, y la pregunta importante es **quién garantiza que nadie lea el `clinic_id` ajeno**.

La respuesta: **Postgres**, no la aplicación.

## Por qué en la base y no en el código

Un filtro en el código es una promesa que cada consulta tiene que recordar cumplir. Basta una que se
olvide —una pantalla nueva, un `select` de depuración que quedó, una ruta escrita con prisa— para
filtrar datos de otra clínica. Y no falla: devuelve de más, calladamente.

Row Level Security invierte eso: la regla vive **junto al dato**, y una consulta que se olvide del
filtro simplemente no ve nada.

```sql
create policy "clinics_select" on public.clinics
  for select using (id = private.my_clinic_id());
```

`private.my_clinic_id()` resuelve la clínica del `auth.uid()` actual. Aparece en casi todas las
policies del sistema.

## La asimetría lectura/escritura

Un patrón que se repite: **leer es más ancho que escribir**.

| Tabla | Leer | Escribir |
|---|---|---|
| `clinic_hours` | Cualquier miembro, incluso el horario de un compañero | El propio, o cualquiera si sos admin |
| `tablero_default_clinica` | Todos los de la clínica | Sólo admin |
| `clinics` | Todos los de la clínica | Sólo admin |
| `invitations` | Sólo admin | Sólo admin |

La de `clinic_hours` ilustra el criterio: el horario de un compañero **se lee** —hace falta para
agendar con él— y lo que no se hace es escribirlo.

## Las tres grietas, y cómo se tapan

La RLS protege lo que pasa por una sesión. Hay tres caminos que no tienen sesión:

### 1. `service_role` — se salta la RLS entera

Se usa donde no hay más remedio: webhooks (llegan de Meta o Wompi, sin usuario), crons, y el empuje
de una cita al calendario de otra persona.

**Cada uno de esos lugares revalida a mano.** Ejemplo real: `/api/calendario/push` lee la cita
**con la sesión del llamador** antes de llamar a `service_role`. Si la RLS la esconde, la cita "no
existe" y la ruta corta. Sin ese chequeo, cualquiera podría meterle un evento en el calendario a
alguien de otra clínica.

Otro: el modo automático de WhatsApp corre con `service_role` y verifica a mano que la mascota sea
del titular que escribe — **acá no hay RLS que lo impida**.

### 2. Las funciones `security definer`

Corren con los privilegios de su dueño, o sea que ignoran la RLS. Dos reglas que este repositorio
cumple sin excepción:

- **`set search_path` fijo.** Sin eso se las puede secuestrar creando un objeto homónimo en un
  esquema que el llamador controle.
- **El `clinic_id` va explícito en el `where`.** Es lo único que impide que un admin de una clínica
  toque el perfil de alguien de otra: la RLS ahí no ayuda, porque `security definer` la deja de lado,
  que es justamente para lo que se usa.

### 3. Los enlaces con token

El informe al titular (`/f/[token]`), la baja de correo (`/baja/[token]`) y el feed ICS
(`/api/calendar/ics/[token]`) no tienen sesión: **el token es la credencial**. Quien lo tenga, entra.

## Lo que la RLS no hace

**No sustituye a las reglas de negocio.** Varias garantías del sistema no se pueden expresar como
policy y viven en **triggers**:

| Trigger | Qué garantiza |
|---|---|
| `impedir_solape_de_citas()` | Un vet no queda con dos citas encima |
| `enforce_consent_before_audio()` | No se graba sin consentimiento |
| `informe_solo_de_nota_aprobada()` | No sale informe de una nota en borrador |
| `la_nota_credito_cabe_en_la_factura()` | No se acredita de más |
| `horario_es_del_mismo_equipo()` | Un horario personal es de alguien de la clínica |
| guarda de `profiles` | `clinic_id`, `role` y `ve_agenda_completa` no se escriben desde el cliente |

**Por qué triggers y no chequeos en las RPC:** porque los RPC no son el único camino de escritura. El
calendario actualiza horarios con un `update` directo al arrastrar una cita — una guarda que viviera
sólo en `update_appointment` dejaría abierta justo la vía por la que más fácil se produce un solape.

Un trigger cubre las vías que existen hoy **y la que alguien escriba mañana sin leer esto**.

## Un filtro que NO es una frontera

`ve_agenda_completa` (ver [Roles y permisos](../30-referencia/50-roles-y-permisos.md)) gobierna qué
citas se le mandan al navegador, **no** a qué tiene acceso. La RLS de `appointments` sigue siendo por
clínica.

Se dejó así a propósito, y está escrito en la migración: angostar esa RLS rompería el cálculo de
cupos —que resta las citas de todos cuando no se especifica veterinario— y pasaría a ofrecer horarios
que un compañero ya tiene ocupados. Eso es doble reserva, que es justo lo que el antisolape vino a
impedir.

Es un ejemplo de una decisión que hay que **decir en voz alta** en vez de descubrir después: un
permiso que parece de seguridad y no lo es.

## Multi-clínica

`memberships` es la fuente de verdad de a qué clínicas pertenece alguien. `profiles.clinic_id` es sólo
la **activa**. El panel de plataforma usa `memberships` justamente por eso.
