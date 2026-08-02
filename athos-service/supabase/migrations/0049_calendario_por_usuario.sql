-- ============================================================
-- 0049_calendario_por_usuario.sql
-- Calendario v3: conexión EXPLÍCITA por usuario, y sincronización de una sola vía.
--
-- Los dos diseños anteriores fallaron por lo mismo: la conexión era automática (el login guardaba
-- el token sin que nadie lo pidiera) y el sync traía eventos de vuelta. De ahí salieron las 11.695
-- filas "Comer"/"Trabajo"/"Dormir" del calendario personal de un vet metidas en la agenda de la
-- clínica, y después un token de Microsoft guardado en la fila de Google (invalid_grant días
-- después, sin señalar la causa).
--
-- v3: nadie se conecta solo — cada usuario elige Google u Outlook en Conexiones — y Tuvetia solo
-- EMPUJA sus citas. No se lee nada del calendario, así que no hay forma de que entre basura.
--
-- Lo que NO cambia: las RPCs create_appointment/update_appointment de 0048 (paciente, titular,
-- veterinario y motivo obligatorios + el paciente debe ser del titular). El agendamiento se
-- conserva entero; lo que se rehace es la sincronización.
-- ============================================================

-- =========================================================================
-- 1) appointments.calendar_owner_id — en el calendario de QUIÉN vive el evento.
--
-- El evento se crea en el calendario del veterinario asignado. Si al editar la cita se cambia el
-- veterinario, el evento tiene que borrarse del calendario del anterior y crearse en el del nuevo:
-- sin registrar de quién era, el evento viejo queda de fantasma en la agenda de alguien que ya no
-- atiende esa cita, y no hay forma de encontrarlo para borrarlo.
-- =========================================================================
alter table public.appointments
  add column if not exists calendar_owner_id uuid references public.profiles(id) on delete set null;

comment on column public.appointments.calendar_owner_id is
  'Usuario en cuyo calendario externo vive el evento (google_event_id / microsoft_event_id). '
  'Permite mover el evento cuando cambia el veterinario asignado.';

-- Backfill: los eventos que existen hoy se empujaron con la cuenta del admin de la clínica
-- (diseño de 0048), no con la del vet. Se marca así para que el primer push posterior sepa de
-- dónde borrarlos antes de recrearlos en el calendario correcto.
update public.appointments a
set calendar_owner_id = c.owner_id
from public.clinics c
where a.clinic_id = c.id
  and a.calendar_owner_id is null
  and (a.google_event_id is not null or a.microsoft_event_id is not null);

-- =========================================================================
-- 2) RLS de calendar_integrations: vuelve a ser POR USUARIO.
--
-- 0048 lo había abierto a toda la clínica para que cualquier vet viera si el admin había conectado
-- el calendario compartido. Sin calendario de clínica eso ya no aplica: cada quien ve el suyo, que
-- además es el mínimo necesario para renderizar Conexiones.
-- =========================================================================
drop policy if exists "calendar_integrations_select" on public.calendar_integrations;
create policy "calendar_integrations_select" on public.calendar_integrations
  for select using (
    clinic_id = (select private.my_clinic_id()) and user_id = (select auth.uid())
  );

-- El DELETE ya estaba restringido a la fila propia (0007/0010), que es justo lo que necesita el
-- botón "Desconectar" nuevo. No hace falta tocarlo.

-- =========================================================================
-- 3) Limpieza puntual: la fila con el token del proveedor equivocado.
--
-- El defecto de v2 (guardar `session.provider_refresh_token` sin verificar de qué proveedor era)
-- dejó UNA fila con un token de Microsoft en la integración de Google. Se detecta por el formato:
-- los refresh token de Google empiezan con "1//" y los de Microsoft con "M.".
--
-- Esa fila no sirve para nada — Google la rechaza con invalid_grant — y además es la que deja a un
-- usuario con dos proveedores, que el modelo nuevo no admite. Las demás integraciones son válidas
-- y NO se tocan: desconectarlas obligaría a reconectar sin motivo.
-- =========================================================================
delete from public.calendar_integrations
where provider = 'google'
  and refresh_token is not null
  and refresh_token not like '1//%';
