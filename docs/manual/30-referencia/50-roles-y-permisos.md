---
titulo: Roles y permisos
seccion: referencia
orden: 50
resumen: Los dos roles que existen, qué puede cada uno, y las tres cosas que parecen roles y no lo son.
---

# Roles y permisos

## Hay exactamente dos roles

```sql
create type public.user_role as enum ('admin', 'vet');
```

Es el mismo enum para `profiles.role`, `invitations.role` y `memberships.role`. El default es `vet`.

No hay "recepcionista", ni "auxiliar", ni "sólo lectura". Cuando hizo falta un permiso más fino, se
agregó **una columna**, no un rol — ver más abajo.

## Qué puede el admin que no puede el vet

| Acción | Dónde se aplica |
|---|---|
| Invitar miembros | RPC `create_invitation` |
| Quitar miembros y cambiar roles | RPC `remove_clinic_member` |
| Otorgar el permiso de ver toda la agenda | RPC `otorgar_agenda_completa` |
| Contratar y cancelar la suscripción | `/api/suscripcion/*` |
| Editar los datos de la clínica (incluida la dirección) | policy `clinics_update` |
| Ver la agenda completa sin bandera | `puedeVerLaAgendaCompleta()` |
| Editar el horario personal de otra persona | policies de `clinic_hours` |
| Guardar el tablero con el que entra la clínica | `tablero_default_clinica` |
| Recibir las citas de todo el equipo en su calendario | va invitado a todas |

Todo lo demás —pacientes, titulares, consultas, historia clínica, WhatsApp, Athos, facturación— es
**igual para los dos**.

> **El chequeo real vive en la base**, no en la interfaz. Las RPC son `security definer` y verifican
> `private.my_role() <> 'admin'` antes de hacer nada. Esconder un botón es cosmética; la RPC es la
> que rechaza.

## Las tres cosas que parecen roles y no lo son

### 1. `ve_agenda_completa` — un permiso otorgable

Una columna booleana en `profiles`. Deja que un vet vea la agenda de toda la clínica **sin volverlo
admin de todo**.

Se creó exactamente por eso: ascender a alguien a admin para que pudiera mirar la agenda le habría
dado además invitar gente, cambiar la clínica y tocar la suscripción.

- Un **admin la tiene siempre**, sin necesidad de la bandera. Si hubiera que otorgársela también a
  él, la primera persona de una clínica nueva se quedaría sin ver la agenda de nadie y sin nadie que
  pudiera dárselo.
- **No se puede escribir desde el cliente**: un trigger en `profiles` lo bloquea. Se cambia con la
  RPC `otorgar_agenda_completa`, que además exige que la persona sea de tu clínica.
- **No es una frontera de seguridad.** La RLS de `appointments` sigue siendo por clínica; lo que el
  permiso gobierna es **qué se le manda al navegador**. Restringir la RLS rompería el cálculo de
  cupos —que resta las citas de todos a propósito— y produciría dobles reservas.

### 2. Admin de plataforma — la allowlist de `/admin`

El panel interno de Tuvetia. **No usa `user_role`**: es una lista de correos en
`PLATFORM_ADMIN_EMAILS`, separados por coma. Sin esa variable no entra nadie (seguro por defecto).

Es ajeno al producto: un admin de plataforma no es admin de ninguna clínica, y un admin de clínica no
tiene acceso al panel.

### 3. `is_active` — un estado, no un rol

Desactiva una cuenta. Deja de poder entrar, pero su historia y sus registros siguen.

## El plan, que es otro eje distinto

Cortar por rol y cortar por plan son cosas separadas. El plan (`free` / `pro`) decide **qué
capacidades de IA** están disponibles para toda la clínica, sin importar quién sea la persona.

La lista vive en `src/lib/planes/index.ts` y es **el único lugar donde se decide**. El criterio no es
"¿es una función avanzada?" sino **¿gasta plata cada vez que se usa?**

| Capacidad | Qué es |
|---|---|
| `athos` | El chat clínico con literatura citada, y el widget flotante |
| `modo-fantasma` | Grabar la consulta, transcribirla y redactar la nota. **El más caro** |
| `sugerencia-whatsapp` | "Athos sugiere la respuesta" en la bandeja |
| `whatsapp-automatico` | El modo automático: contesta solo las preguntas operativas |
| `cartera-ia` | Cobranza leyendo las respuestas del cliente y clasificando la intención |
| `receta-por-foto` | Cargar una receta por foto y convertirla en ítems de factura |
| `briefing` | El resumen diario redactado |

Hoy **las siete piden `pro`**, y la tabla `PLAN_MINIMO` parece redundante. No lo es: es el lugar
donde se movería una capacidad el día que se decida regalar alguna, y ese cambio tiene que ser una
línea, no una cacería por el repositorio.

### Por qué la lista es de capacidades y no de pantallas

Porque hay IA corriendo **dentro** de secciones que son gratis: la sugerencia de la bandeja, el modo
automático de WhatsApp, la clasificación de cartera, la lectura de recetas, el briefing. Si el corte
fuera por pantalla, una clínica gratis seguiría quemando IA en el modo automático y en el barrido
diario de cartera — que son justamente las dos que gastan **sin que nadie las mire**.

### El plan se comprueba en las dos mitades

`src/lib/planes/index.ts` **no tiene `server-only`** a propósito: lo consumen la interfaz (para
mostrar la invitación a Pro) y el servidor (para cortar). Si cada mitad tuviera su lista, el día que
se moviera una capacidad una quedaría atrás — y el modo de fallo es el peor: la interfaz deja pasar,
el servidor corta, y el vet ve un error críptico en vez de una invitación a pagar.

Además, `comoPlan()` cae a `free` ante cualquier valor desconocido. Esa dirección importa: un plan
ilegible tiene que **negar**, no conceder. Al revés, un typo en la columna regalaría el producto.
