-- ============================================================
-- 0050_email_inbox.sql
-- Bandeja de correo de la clínica: guardar el buzón, no solo las respuestas de facturas.
--
-- Hoy el barrido IMAP (src/lib/email/sync.ts) baja el INBOX entero y DESCARTA todo lo que no sea
-- respuesta a una factura — solo persiste lo que matchea invoice_email_threads. Por eso no hay
-- bandeja en la app ni forma de que Athos lea un correo.
--
-- Estas dos tablas son ese almacenamiento. El transporte no cambia: sigue siendo IMAP/SMTP con App
-- Password (ver 0039 para por qué NO la API de Gmail — sus scopes de lectura son "restringidos" y
-- exigen auditoría CASA anual).
--
-- Espeja whatsapp_messages donde tiene sentido (direction, read_at, sent_by, RLS por clínica) y se
-- aparta donde el correo es distinto: hilado por Message-ID (RFC 5322) en vez de por teléfono, y
-- asunto, que en WhatsApp no existe.
-- ============================================================

-- =========================================================================
-- 1) Cursor del buzón, por clínica.
--
-- El cursor que existe hoy vive por-hilo-de-factura (invoice_email_threads.last_seen_uid) y no
-- sirve para un buzón general: si la clínica no tiene ninguna factura enviada por correo, no hay
-- ningún cursor y el barrido ni siquiera llega a leer.
-- =========================================================================
alter table public.email_integrations
  add column if not exists inbox_last_uid bigint;

comment on column public.email_integrations.inbox_last_uid is
  'Último UID de IMAP ingestado a email_messages. Cursor monótono del buzón, independiente del '
  'cursor por-factura de invoice_email_threads.';

-- =========================================================================
-- 2) email_threads — la conversación.
-- =========================================================================
create table if not exists public.email_threads (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references public.clinics(id) on delete cascade,

  -- Message-ID del primer mensaje del hilo: la raíz contra la que se comparan In-Reply-To y
  -- References de los entrantes (mismo criterio que invoice_email_threads).
  root_message_id   text not null,
  subject           text,

  -- Direcciones que participan del hilo, para buscar por remitente sin recorrer los mensajes.
  participants      text[] not null default '{}',

  -- Titular, cuando alguna dirección del hilo matchea owners.email. Es lo que permite mostrar
  -- "hilo de Ana Restrepo" y que Athos ate un correo a un paciente. Nullable a propósito: el buzón
  -- de la clínica también recibe laboratorios, proveedores y bancos.
  owner_id          uuid references public.owners(id) on delete set null,

  last_message_at   timestamptz not null default now(),
  unread_count      integer not null default 0,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Un hilo por raíz y por clínica: es lo que hace idempotente al ingestar.
  unique (clinic_id, root_message_id)
);

alter table public.email_threads enable row level security;

create policy "email_threads_select" on public.email_threads
  for select using (clinic_id = (select private.my_clinic_id()));
create policy "email_threads_update" on public.email_threads
  for update using (clinic_id = (select private.my_clinic_id()));
-- Sin INSERT/DELETE: la ingesta escribe con service_role desde el barrido.

-- La bandeja lista hilos de la clínica por actividad reciente: ese es el patrón de acceso.
create index if not exists idx_email_threads_clinic_recent
  on public.email_threads (clinic_id, last_message_at desc);
create index if not exists idx_email_threads_owner
  on public.email_threads (owner_id) where owner_id is not null;

-- =========================================================================
-- 3) email_messages — cada correo.
-- =========================================================================
create table if not exists public.email_messages (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references public.clinics(id) on delete cascade,
  thread_id         uuid not null references public.email_threads(id) on delete cascade,

  -- Message-ID (RFC 5322). Análogo de whatsapp_messages.wa_message_id: llave natural única, que es
  -- lo que hace idempotente reprocesar un UID (el barrido puede repetir una ventana tras un fallo).
  message_id        text not null,
  in_reply_to       text,
  references_raw    text,

  direction         text not null check (direction in ('inbound', 'outbound')),
  from_email        text not null,
  to_emails         text[] not null default '{}',
  subject           text,
  body_text         text,
  -- Primeras líneas, para la lista de la bandeja sin traer el cuerpo entero.
  snippet           text,

  -- Metadata de adjuntos, SIN los bytes: se informa que vienen y cuánto pesan. Bajarlos y
  -- guardarlos para todo el buzón es otra decisión (costo y Ley 1581). Cartera sigue guardando los
  -- suyos por su camino (storeReceipt).
  attachments       jsonb not null default '[]',

  imap_uid          bigint,
  read_at           timestamptz,
  -- Quién lo mandó desde Tuvetia (null en los entrantes).
  sent_by           uuid references public.profiles(id) on delete set null,

  created_at        timestamptz not null default now(),

  unique (clinic_id, message_id)
);

alter table public.email_messages enable row level security;

create policy "email_messages_select" on public.email_messages
  for select using (clinic_id = (select private.my_clinic_id()));
create policy "email_messages_update" on public.email_messages
  for update using (clinic_id = (select private.my_clinic_id()));
-- Sin INSERT: todo entra por el barrido o por el envío, ambos con service_role.

create index if not exists idx_email_messages_thread
  on public.email_messages (thread_id, created_at);
create index if not exists idx_email_messages_clinic_recent
  on public.email_messages (clinic_id, created_at desc);

-- =========================================================================
-- 4) Realtime, igual que 0044 hizo con whatsapp_messages: la bandeja se actualiza sola en vez de
--    esperar a que alguien recargue.
--
-- add table falla si ya está publicada; el bloque lo vuelve idempotente.
-- =========================================================================
do $$
begin
  alter publication supabase_realtime add table public.email_messages;
exception
  when duplicate_object then null;
end $$;

-- =========================================================================
-- 5) Contador de no leídos: incremento atómico.
--
-- PostgREST no sabe expresar `unread_count = unread_count + 1`, y hacerlo con leer-y-escribir desde
-- la app pierde incrementos si dos mensajes del mismo hilo entran a la vez. Una función lo resuelve
-- en una sola sentencia.
--
-- `marcar_leido` es el otro lado: al abrir el hilo en la bandeja se marcan sus entrantes y el
-- contador vuelve a cero, en la misma transacción para que no queden desfasados.
-- =========================================================================
create or replace function public.increment_email_thread_unread(p_thread_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.email_threads
  set unread_count = unread_count + 1
  where id = p_thread_id;
$function$;

revoke execute on function public.increment_email_thread_unread(uuid) from public, anon, authenticated;
grant execute on function public.increment_email_thread_unread(uuid) to service_role;

create or replace function public.mark_email_thread_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clinic_id uuid := private.my_clinic_id();
begin
  if v_clinic_id is null then
    raise exception 'No clinic assigned to current user';
  end if;

  update public.email_messages
    set read_at = now()
    where thread_id = p_thread_id
      and clinic_id = v_clinic_id
      and direction = 'inbound'
      and read_at is null;

  update public.email_threads
    set unread_count = 0
    where id = p_thread_id and clinic_id = v_clinic_id;
end;
$function$;

revoke execute on function public.mark_email_thread_read(uuid) from public, anon;
grant execute on function public.mark_email_thread_read(uuid) to authenticated, service_role;
