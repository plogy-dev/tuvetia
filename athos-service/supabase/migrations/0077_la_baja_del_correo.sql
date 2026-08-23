-- 0077 — La baja del correo: que un titular pueda dejar de recibir los avisos de su clínica.
--
-- QUÉ HABILITA. El envío masivo de una clínica a sus clientes (`docs/PLAN-CORREO-A-CLIENTES.md`).
-- La baja va PRIMERO y sola, antes que el envío, porque es lo único de esa función que no se puede
-- arreglar al día siguiente: una baja que no se respeta se arregla pidiéndole perdón a un cliente.
--
-- ── LA BAJA ES DE LOS AVISOS, NO DE LO QUE LA CLÍNICA DEBE COMUNICARLE ────────────────────────
--
-- Es la distinción que sostiene todo lo demás. Darse de baja de "les cuento que a Nala le toca la
-- vacuna" NO puede dar de baja de "tenés una factura vencida" ni del envío de una factura: eso
-- último es la relación contractual, y la cartera tiene su propio régimen (Ley 2300) con su propio
-- gate. Un titular que se da de baja para dejar de recibir recordatorios de pago sería un agujero,
-- no una función.
--
-- Por eso esta tabla NO se llama `owner_optout` a secas y por eso el filtro vive en el camino del
-- masivo y no dentro de `sendTransactionalEmail`.
--
-- ── POR QUÉ EL CORREO ESTÁ EN LA CLAVE ────────────────────────────────────────────────────────
--
-- La baja es de una DIRECCIÓN, no de una persona. Si la ficha del titular cambia de correo, la baja
-- del anterior no debe migrar sola al nuevo: es otra dirección, y detrás puede haber otra persona
-- —el correo de un familiar, un correo de trabajo que se dejó de usar—. Al revés también importa:
-- volver a poner el correo viejo debe seguir dado de baja.
--
-- ── EL TOKEN VIVE EN `owners` Y NO ACÁ ────────────────────────────────────────────────────────
--
-- Porque el enlace tiene que funcionar para quien TODAVÍA NO se dio de baja, y acá no hay fila
-- suya. Es un uuid (122 bits, no se adivina), mismo criterio que `invoices.share_token` y la página
-- `/f/[token]`.

alter table public.owners
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

-- Es la credencial de una página pública: dos titulares con el mismo token dejarían que uno diera
-- de baja al otro.
create unique index if not exists owners_unsubscribe_token_key
  on public.owners (unsubscribe_token);

create table if not exists public.owner_email_optout (
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  owner_id   uuid not null references public.owners(id) on delete cascade,
  -- Normalizado (minúsculas, sin espacios) por quien escribe: `Ana@X.com` y `ana@x.com` son la
  -- misma casilla, y si entraran como dos filas el filtro dejaría pasar una de las dos.
  email      text not null,
  motivo     text,
  created_at timestamptz not null default now(),
  primary key (clinic_id, owner_id, email)
);

comment on table public.owner_email_optout is
  'Bajas de los AVISOS por correo de una clínica a sus titulares. NO cubre lo transaccional '
  '(facturas, cartera): eso es la relación contractual y tiene su propio régimen.';

alter table public.owner_email_optout enable row level security;

-- LECTURA: cualquiera de la clínica. La lista de bajas es lo que le permite a un administrador
-- entender por qué su audiencia encogió; esconderla invita a "mandar igual, por las dudas".
create policy owner_email_optout_select on public.owner_email_optout
  for select using (clinic_id = private.my_clinic_id());

-- ESCRITURA: NADIE desde el cliente.
--
-- La baja la escribe la página pública `/baja/[token]`, que corre con `service_role` porque el
-- visitante es anónimo — no tiene sesión ni cuenta. Y el ALTA no existe a propósito: "volver a
-- suscribir" a alguien que se dio de baja no puede ser un botón del panel de la clínica. Si el
-- titular quiere volver, lo pide y se borra la fila a mano, con constancia.
--
-- No se declaran policies de insert/update/delete: sin policy, la RLS niega. `service_role` se las
-- saltea, que es exactamente quién tiene que poder.
