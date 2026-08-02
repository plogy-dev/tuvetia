-- ============================================================
-- 0051_email_por_usuario.sql
-- El correo pasa a tener DOS dueños posibles: la clínica o un miembro.
--
--   user_id IS NULL  -> la cuenta institucional de la clínica. Es la que manda FACTURAS y los
--                       recordatorios de COBRANZA, y la que lee sus respuestas. Una factura no sale
--                       "de Ana": sale de la clínica. No cambia nada de su comportamiento actual.
--   user_id = X      -> la cuenta personal de ese miembro. Es su bandeja en Comunicaciones y la que
--                       usa Athos para escribirle a un titular.
--
-- Se generaliza la tabla que ya existe en vez de crear una paralela: así se reusan el cifrado
-- (credential_enc), la verificación SMTP/IMAP y el manejo de errores, que ya están resueltos y
-- probados. Duplicarlos habría significado dos lugares donde arreglar el mismo bug.
--
-- Las tablas de la bandeja (0050) también pasan a ser por usuario: dos miembros son dos buzones
-- distintos, y mezclarlos haría que cada uno viera el correo del otro.
-- ============================================================

-- =========================================================================
-- 1) email_integrations: dueño opcional.
-- =========================================================================
alter table public.email_integrations
  add column if not exists user_id uuid references public.profiles(id) on delete cascade;

comment on column public.email_integrations.user_id is
  'NULL = cuenta institucional de la clínica (facturas y cobranza). Con valor = cuenta personal de '
  'ese miembro (su bandeja y lo que envía Athos).';

-- El `unique (clinic_id)` de 0039 impedía que una clínica tuviera más de una cuenta — que es
-- justo lo que ahora hace falta. Se reemplaza por dos índices parciales:
--   - una sola cuenta institucional por clínica
--   - una sola cuenta personal por miembro
-- (Un `unique (clinic_id, user_id)` a secas NO sirve: Postgres considera distintos dos NULL, así
-- que dejaría crear varias cuentas institucionales para la misma clínica.)
alter table public.email_integrations drop constraint if exists email_integrations_clinic_id_key;

create unique index if not exists email_integrations_clinica_uidx
  on public.email_integrations (clinic_id) where user_id is null;
create unique index if not exists email_integrations_usuario_uidx
  on public.email_integrations (user_id) where user_id is not null;

-- La credencial sigue revocada a PostgREST (0039); esto solo ajusta QUÉ filas ve cada quien:
-- la institucional la ve toda la clínica (para saber si las facturas pueden salir), la personal
-- solo su dueño.
drop policy if exists "email_integrations_select" on public.email_integrations;
create policy "email_integrations_select" on public.email_integrations
  for select using (
    clinic_id = (select private.my_clinic_id())
    and (user_id is null or user_id = (select auth.uid()))
  );

-- =========================================================================
-- 2) La bandeja es de cada usuario.
--
-- 0050 las creó por clínica porque entonces había una sola cuenta. Se agrega el dueño y se
-- reemplazan las llaves únicas: la deduplicación por Message-ID tiene que ser POR BUZÓN — el mismo
-- correo puede llegarle a dos miembros, y son dos mensajes distintos, cada uno en su bandeja.
--
-- Sin datos que migrar: nadie tenía correo conectado todavía (email_integrations en 0 filas).
-- =========================================================================
alter table public.email_threads
  add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.email_messages
  add column if not exists user_id uuid references public.profiles(id) on delete cascade;

alter table public.email_threads drop constraint if exists email_threads_clinic_id_root_message_id_key;
alter table public.email_messages drop constraint if exists email_messages_clinic_id_message_id_key;

create unique index if not exists email_threads_usuario_raiz_uidx
  on public.email_threads (user_id, root_message_id);
create unique index if not exists email_messages_usuario_msgid_uidx
  on public.email_messages (user_id, message_id);

-- Cada quien ve SU buzón. El correo de trabajo de un miembro no es del equipo.
drop policy if exists "email_threads_select" on public.email_threads;
create policy "email_threads_select" on public.email_threads
  for select using (
    clinic_id = (select private.my_clinic_id()) and user_id = (select auth.uid())
  );
drop policy if exists "email_threads_update" on public.email_threads;
create policy "email_threads_update" on public.email_threads
  for update using (
    clinic_id = (select private.my_clinic_id()) and user_id = (select auth.uid())
  );

drop policy if exists "email_messages_select" on public.email_messages;
create policy "email_messages_select" on public.email_messages
  for select using (
    clinic_id = (select private.my_clinic_id()) and user_id = (select auth.uid())
  );
drop policy if exists "email_messages_update" on public.email_messages;
create policy "email_messages_update" on public.email_messages
  for update using (
    clinic_id = (select private.my_clinic_id()) and user_id = (select auth.uid())
  );

create index if not exists idx_email_threads_usuario_recent
  on public.email_threads (user_id, last_message_at desc);

-- `mark_email_thread_read` acotaba por clínica; ahora, por usuario — si no, un miembro podría
-- marcar como leído el hilo de otro.
create or replace function public.mark_email_thread_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.email_messages
    set read_at = now()
    where thread_id = p_thread_id
      and user_id = auth.uid()
      and direction = 'inbound'
      and read_at is null;

  update public.email_threads
    set unread_count = 0
    where id = p_thread_id and user_id = auth.uid();
end;
$function$;
