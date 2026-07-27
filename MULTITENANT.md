# Multi-tenant: clínicas (veterinarias)

Cómo TuvetIA aísla los datos de cada clínica y por qué un usuario nunca puede
quedar "suelto" sin una. Aplicado en vivo contra el proyecto principal
(`auxlnexhkmtoedrzfsnz`) por MCP; el código fuente vive en
`athos-service/supabase/migrations/0021` a `0024`.

## El modelo, en una frase

**`clinics`** es el tenant. **`profiles.clinic_id`/`profiles.role`** es la
*clínica activa* del usuario en este momento (lo que lee toda la RLS y casi
todo el front). **`public.memberships`** es la *fuente de verdad* de a qué
clínicas pertenece cada usuario y con qué rol — permite que un usuario
pertenezca a más de una clínica sin tocar ni la RLS ni los ~20 sitios del
front que ya leen `profiles.clinic_id`.

```
auth.users ──(1:1)── profiles ──(clinic_id = clínica ACTIVA)── clinics
                │
                └──(N:M, fuente de verdad)── memberships(clinic_id, user_id, role) ── clinics
```

## Tablas

- **`clinics`**: `id, name, slug, phone, email, address, city, country,
  logo_url, subscription_status, ...`. El `name`/`logo_url` los edita el
  admin de la clínica desde `/bienvenida` (ver §Onboarding) o Configuración.
- **`profiles`**: `id (= auth.users.id), clinic_id, role (user_role: admin|vet),
  full_name, ...`. `clinic_id` es nullable en el esquema, pero en la práctica
  nunca queda `NULL` para un usuario confirmado y sin invitación pendiente —
  lo garantiza un trigger, no una convención de la app (ver §Invariantes).
- **`memberships`**: `clinic_id, user_id, role (user_role)`, `unique(clinic_id, user_id)`.
  Existía en el esquema desde antes pero sin FKs ni policies (0 filas, 0 usos
  en código) — `0022` la conecta de verdad. Se llena automáticamente cada vez
  que alguien crea o acepta una clínica; nunca se escribe a mano desde el
  front.

## Aislamiento (RLS)

Todas las tablas de contexto clínico (`patients`, `owners`, `consultations`,
`clinical_notes`, `appointments`, `consents`, `consultation_audios`,
`transcripts`, `patient_attachments`, `allergies`, `vaccines`, `medications`,
`whatsapp_messages`, `patient_embeddings`, `memberships`, `clinics`) tienen
`clinic_id` como columna directa `NOT NULL` (nunca hay que hacer JOIN para
saber de qué clínica es una fila) y sus policies filtran **exclusivamente**
por clínica, nunca por usuario:

```sql
-- select/update/delete
using (clinic_id = private.my_clinic_id())
-- insert
with_check (clinic_id = private.my_clinic_id())
```

`private.my_clinic_id()`/`private.my_role()` (`SECURITY DEFINER`, en
`000_base_schema.sql`) son los **únicos** dos puntos que leen
`profiles.clinic_id`/`profiles.role` para decidir acceso — por eso cambiar el
modelo de tenencia (agregar `memberships`) no requirió tocar ninguna de las
~40 policies existentes. Columnas como `vet_id`/`created_by`/`uploaded_by`
son solo trazabilidad ("quién lo hizo"), nunca criterio de aislamiento:
cualquier vet de la clínica ve y edita todos los pacientes de esa clínica,
no solo los propios.

## Cómo se asigna la clínica al loguearse

Nada de esto pasa en el código de Next.js — es un trigger de base de datos
sobre `auth.users`, así que cubre por igual magic link, Google OAuth e
invite links (todos flipean `auth.users.email_confirmed_at` desde dentro de
GoTrue, sin pasar por nuestras rutas):

```
auth.users.email_confirmed_at: NULL -> NOT NULL
  → trigger on_auth_user_confirmed
    → private.ensure_clinic_membership(user_id, email, raw_user_meta_data)
      ├─ ya tiene clinic_id → no hace nada
      ├─ tiene invitación pendiente (public.invitations) → no hace nada,
      │   espera a que acepte manualmente (ver más abajo)
      └─ si no → private.provision_new_clinic(): crea la clínica (nombre
          placeholder: metadata.clinic_name o "Clinica de {nombre}"),
          pone profiles.clinic_id + role='admin', inserta en memberships.
```

Antes esto era un `try/catch` "best-effort" en `src/app/auth/callback/route.ts`
y `src/app/auth/confirm/route.ts` (`ensureClinicForUser`, ya eliminado) — si
fallaba, el login igual pasaba y el usuario quedaba huérfano en silencio.
Así se generaron 2 usuarios reales sin clínica (nunca llegaron a
confirmar/reintentar), reasignados a una clínica catch-all **"Clínica sin
asignar"** en el backfill de `0022`.

### Invitar a un colega (múltiples clínicas)

`accept_invitation(token)` es **aditivo**: hace `upsert` en `memberships`
(no borra las anteriores) y solo cambia cuál es la clínica *activa*
(`profiles.clinic_id`/`role`). Un usuario puede así terminar con membership
en varias clínicas.

### Cambiar de clínica activa

`switch_active_clinic(target_clinic_id)` (RPC, `SECURITY DEFINER`): valida
que exista una fila en `memberships` para `(auth.uid(), target_clinic_id)` y
si es así actualiza `profiles.clinic_id`/`role`. Existe a nivel de base de
datos y funciona hoy vía RPC — **todavía no hay un selector en el front**
(el sidebar solo muestra la clínica activa, no permite cambiarla).

## Invariantes reforzados en la BD (no solo por convención de la app)

1. **Un usuario confirmado siempre está ligado a una clínica** — trigger
   `profiles_clinic_invariant` (`before insert or update of clinic_id on
   profiles`): rechaza dejar `clinic_id = NULL` salvo los dos estados
   transitorios legítimos (usuario aún no confirma su email, o está
   invitado esperando aceptar). No es un `NOT NULL` literal porque ese
   segundo estado es real y esperado.
2. **Nadie puede auto-asignarse a otra clínica** — trigger
   `profiles_guard_sensitive_columns` (`before update on profiles`):
   bloquea que un cliente autenticado cambie `clinic_id`/`role` con un
   `UPDATE` directo desde el navegador. Solo las funciones `SECURITY
   DEFINER` (`create_clinic`, `accept_invitation`, `switch_active_clinic`,
   los triggers de provisioning), que corren como `postgres`, pueden
   tocarlas. Corrige un hueco real: antes de `0021`, la policy
   `profiles_update` no tenía `WITH CHECK`, así que cualquier usuario podía
   auto-asignarse admin de cualquier clínica.

## Storage por clínica

Buckets con archivos de paciente (`patient-attachments`, privado) usan la
ruta `<clinic_id>/<patient_id>/<archivo>` y policies `(storage.foldername(name))[1]
= private.my_clinic_id()::text`. El bucket `clinic-logos` (público, para que
el logo se pueda usar directo como `<img src>` sin signed URLs) usa
`<clinic_id>/logo.<ext>` y solo el admin de esa clínica puede escribir.

> **Trampa ya pisada dos veces** (`patient-photos` y luego `clinic-logos`):
> el servicio de Storage hace `INSERT ... RETURNING` al subir un archivo —
> sin una policy de `SELECT`, ese `RETURNING` se rechaza por RLS **aunque el
> bucket sea público**. Cualquier bucket nuevo necesita sus 4 policies
> (select/insert/update/delete), no solo las 3 "obvias".

## Onboarding

1. Signup (`src/components/signup-form.tsx`) ya **no** pide nombre de
   clínica — solo nombre, email/Google y teléfono.
2. Al confirmar, la BD ya le creó una clínica con nombre placeholder (ver
   arriba). Si es un usuario nuevo sin `setup_completed_at`,
   `dashboard/layout.tsx` lo manda a `/bienvenida`.
3. `/bienvenida` (`src/components/onboarding/workspace-setup.tsx`): una sola
   pantalla, logo + nombre real de la clínica. Actualiza `clinics`, marca
   `profiles.setup_completed_at` (RPC `mark_setup_completed`) y entra al
   dashboard. Reemplazó a un wizard de 5 pasos.

## Migraciones relevantes

| Archivo | Qué hace |
|---|---|
| `0021_profiles_update_guard.sql` | Bloquea auto-escalada de `clinic_id`/`role` en `profiles`. |
| `0022_multi_clinic_memberships.sql` | FKs + RLS de `memberships`, helpers `provision_new_clinic`/`ensure_clinic_membership`, trigger `on_auth_user_confirmed`, RPC `switch_active_clinic`, backfill de huérfanos y de `memberships`, invariante `profiles_clinic_invariant`. |
| `0023_clinic_logos_storage.sql` | Bucket `clinic-logos` (público) + policies insert/update/delete por clínica. |
| `0024_clinic_logos_select_policy.sql` | Fix: falta la policy de `SELECT` (ver trampa de Storage arriba). |

## Qué falta / no está resuelto

- No hay selector de clínica en el front (existe `switch_active_clinic` a
  nivel de BD, sin UI).
- La clínica catch-all "Clínica sin asignar" (2 usuarios legacy) sigue
  existiendo — se puede renombrar o migrar esos usuarios a mano cuando haga
  falta.
- El wizard viejo creaba un paciente de ejemplo con un botón dedicado; ese
  botón desapareció junto con el wizard (el endpoint `/api/onboarding/demo-data`
  sigue vivo pero sin dónde llamarse desde la UI).
