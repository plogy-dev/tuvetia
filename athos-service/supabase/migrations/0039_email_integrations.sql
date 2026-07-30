-- 0039: correo por clínica (SMTP para enviar, IMAP para leer respuestas).
--
-- POR QUÉ SMTP/IMAP Y NO LA API DE GMAIL
-- Leer el buzón con la API de Gmail exige el scope `gmail.readonly`/`gmail.modify`, que Google
-- clasifica como RESTRINGIDO: para una app External eso implica verificación + una evaluación de
-- seguridad de terceros (CASA), meses y con costo. La excepción documentada de Google son las
-- App Passwords: "You will no longer use a password for access (with the exception of app
-- passwords)" — siguen funcionando para SMTP e IMAP después de la transición de marzo 2025.
--
-- Con una App Password tenemos ENVIAR y LEER sin ninguna revisión, y además IMAP es un estándar:
-- la misma implementación de lectura sirve para Outlook (que sí exige OAuth, pero el protocolo es
-- el mismo). La API de Gmail solo serviría para Gmail y obligaría a una segunda implementación
-- con Microsoft Graph.
--
-- Alternativa en backlog: Workspace con app OAuth "Internal" (sin revisión de Google tampoco, pero
-- la app tiene que vivir en el proyecto de Cloud del cliente y no generaliza a multi-tenant).
-- Queda como plan B si un admin bloquea las App Passwords a nivel organización.

-- ─── email_integrations ──────────────────────────────────────────────────────
-- Una por clínica. La credencial va CIFRADA (AES-256-GCM, ver src/lib/crypto.ts) y la columna
-- queda revocada para clientes PostgREST — mismo patrón que whatsapp_integrations.access_token_enc.

create table if not exists public.email_integrations (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null unique references public.clinics(id) on delete cascade,

  -- 'smtp' hoy. Los otros dos quedan declarados para no migrar el CHECK cuando entre OAuth:
  -- Outlook lo va a necesitar (Microsoft deshabilitó basic auth y no se puede reactivar).
  provider          text not null default 'smtp'
                      check (provider in ('smtp', 'gmail_oauth', 'outlook_oauth')),

  -- Identidad del remitente. from_email es también la cuenta con la que se autentica en SMTP/IMAP.
  from_email        text not null,
  from_name         text,

  -- Transporte. Defaults de Gmail para que conectar sea pegar la App Password y nada más.
  smtp_host         text not null default 'smtp.gmail.com',
  smtp_port         integer not null default 465,
  smtp_secure       boolean not null default true,   -- true = TLS implícito (465); false = STARTTLS (587)
  imap_host         text not null default 'imap.gmail.com',
  imap_port         integer not null default 993,
  imap_mailbox      text not null default 'INBOX',

  -- App Password (o refresh token cuando entre OAuth), cifrada. NUNCA se expone al cliente.
  credential_enc    text,

  status            text not null default 'pending'
                      check (status in ('pending', 'connected', 'error', 'disconnected')),
  -- Motivo del último fallo, para que el vet vea algo accionable en Configuración en vez de un
  -- "no se pudo enviar" mudo.
  last_error        text,
  verified_at       timestamptz,   -- último handshake OK contra SMTP e IMAP
  connected_at      timestamptz,

  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.email_integrations enable row level security;

-- Los miembros de la clínica VEN el estado de su integración (para renderizar Configuración).
-- INSERT/UPDATE: sin policy — solo service_role desde las rutas de Next, que ya validaron sesión.
create policy "email_integrations_select" on public.email_integrations
  for select using (clinic_id = (select private.my_clinic_id()));

-- Defensa en profundidad: aunque la policy permita el SELECT, la credencial no es legible por
-- PostgREST. Se listan las columnas permitidas de forma explícita.
revoke select on public.email_integrations from anon, authenticated;
grant select (
  id, clinic_id, provider, from_email, from_name,
  smtp_host, smtp_port, smtp_secure, imap_host, imap_port, imap_mailbox,
  status, last_error, verified_at, connected_at, created_at, updated_at
) on public.email_integrations to authenticated;

-- ─── invoice_email_threads ───────────────────────────────────────────────────
-- Cursor de lectura por factura. Sin esto, cada corrida del cron reprocesaría el hilo completo.
--
-- El hilado va por Message-ID (RFC 5322), no por el threadId de Gmail: es estándar, así que
-- funciona igual en Outlook y en cualquier otro proveedor. Las respuestas se encuentran buscando
-- mensajes cuyo In-Reply-To/References contenga root_message_id.

create table if not exists public.invoice_email_threads (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references public.clinics(id) on delete cascade,
  invoice_id        uuid not null references public.invoices(id) on delete cascade,

  -- Message-ID del correo que NOSOTROS enviamos: la raíz del hilo.
  root_message_id   text not null,
  subject           text,
  to_email          text not null,

  -- UID de IMAP del último mensaje ENTRANTE ya procesado. IMAP garantiza UIDs crecientes por
  -- mailbox, así que sirve de cursor monótono. null = todavía no se leyó nada del hilo.
  last_seen_uid     bigint,
  last_inbound_at   timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Una factura tiene UN hilo: si se reenvía, se responde en el mismo (In-Reply-To) en vez de
  -- abrir uno nuevo, que es lo que hace que el cliente pierda el contexto.
  unique (clinic_id, invoice_id)
);

alter table public.invoice_email_threads enable row level security;

create policy "invoice_email_threads_select" on public.invoice_email_threads
  for select using (clinic_id = (select private.my_clinic_id()));

-- El cron busca "hilos de esta clínica con facturas cobrables": ese es el patrón del barrido.
create index if not exists idx_invoice_email_threads_clinic
  on public.invoice_email_threads (clinic_id, updated_at desc);
-- Resolver un Message-ID entrante a su hilo, sin escanear la tabla.
create index if not exists idx_invoice_email_threads_root
  on public.invoice_email_threads (root_message_id);
