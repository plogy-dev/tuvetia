-- La puerta de la plataforma: Tuvetia se puede cerrar, y entonces sólo entra quien trae un código.
--
-- Pedido de David en la reunión del 28-ago (26:09): «que la gente se pueda registrar gratis solo
-- con un link», para probar con veterinarios reales antes de abrir el registro a cualquiera. El
-- diseño escrito está en `docs/PLAN-CODIGOS-DE-PRUEBA.md`; esto lo ejecuta, con una diferencia que
-- vale la pena anotar: allá el código sólo REGALABA DÍAS, acá además DECIDE QUIÉN PASA. Son dos
-- cosas distintas y el mismo código hace las dos.
--
-- ── POR QUÉ LA PUERTA VIVE EN LA BASE Y NO EN UNA VARIABLE DE ENTORNO ─────────────────────────
--
-- Una env se cambia en Vercel y obliga a un redeploy: cerrar y abrir el registro pasa a ser una
-- operación de ingeniería y deja de ser un botón. Y lo que se pidió es justamente un botón, en el
-- panel, para el día de la demo. Una fila lo hace instantáneo y auditable (quién y cuándo).
--
-- ── POR QUÉ EL CORTE ES «NO SE APROVISIONA CLÍNICA» Y NO «NO SE CREA EL USUARIO» ──────────────
--
-- El registro por Google no se puede frenar antes de tiempo: `signInWithOAuth` no tiene el
-- `shouldCreateUser: false` que sí tiene el correo, así que para cuando Supabase nos devuelve el
-- control el usuario de `auth.users` YA existe. Se puede borrar, y ésa fue la primera idea —
-- borrar cuentas recién creadas es irreversible y se ejecuta en el peor momento posible, el de un
-- login que salió mal.
--
-- Lo que sí se puede negar es lo único que convierte una cuenta en un cliente: la CLÍNICA. Sin
-- clínica no hay pacientes, ni agenda, ni Athos — la app entera está construida sobre `clinic_id`.
-- El usuario huérfano que queda no es un cliente: es una fila en `auth.users` sin nada colgando, y
-- el día que traiga un código el mismo camino lo aprovisiona.
--
-- Y por eso el corte va ACÁ y no sólo en la pantalla de registro: `ensure_clinic_membership` es el
-- embudo por el que pasan los dos caminos de alta (correo y OAuth), y `create_clinic` es el tercero
-- —el manual, desde `sin-clinica.tsx`—. Un gate que viviera sólo en el formulario lo esquivaría
-- cualquiera llamando `supabase.auth.signInWithOtp` desde la consola del navegador.
--
-- ── LO QUE LA PUERTA NO TOCA ──────────────────────────────────────────────────────────────────
--
--   · Las cuentas que YA existen. El corte es sobre el aprovisionamiento de clínicas nuevas; quien
--     ya tiene la suya entra igual, con la puerta cerrada o abierta. Era el requisito explícito.
--   · Las invitaciones. `ensure_clinic_membership` ya se aparta cuando hay una invitación pendiente
--     —el invitado entra por `accept_invitation` a una clínica que ya existe, no crea ninguna— y
--     ese camino queda intacto: invitar a alguien al equipo ES la autorización.
--   · El cobro. Un código estira `plan_renueva_en` y nada más; el barrido de `suscripcion/barrido`
--     lo baja a `free` cuando vence, igual que a cualquier prueba.
--
-- Aplicar en el principal (`auxlnexhkmtoedrzfsnz`). Reversible: `update platform_gate set
-- modo='abierto'` devuelve el comportamiento anterior sin tocar una línea de código.

-- ── 1 · La puerta ─────────────────────────────────────────────────────────────────────────────
--
-- UNA SOLA FILA, y el `check (id)` sobre un booleano es lo que lo garantiza: la única fila posible
-- es `id = true`. Es el truco estándar para una tabla de ajustes que no debe poder tener dos
-- verdades — con dos filas, «¿está cerrada?» pasaría a depender de cuál lea cada consulta.

create table if not exists public.platform_gate (
  id               boolean primary key default true check (id),
  modo             text not null default 'abierto' check (modo in ('abierto', 'cerrado')),
  actualizado_en   timestamptz not null default now(),
  actualizado_por  uuid references auth.users(id) on delete set null
);

comment on table public.platform_gate is
  'Fila única: si `modo` = cerrado, sólo se aprovisionan clínicas para quien tenga pase. Ver 0100.';

-- NACE ABIERTA. Aplicar la migración no puede cambiar el comportamiento de la plataforma: cerrar es
-- una decisión de producto que se toma desde el panel, no un efecto secundario de un deploy.
insert into public.platform_gate (id, modo) values (true, 'abierto') on conflict (id) do nothing;

alter table public.platform_gate enable row level security;
-- SIN POLICIES, a propósito: ni `anon` ni `authenticated` la leen. El estado de la puerta lo
-- consultan las funciones `security definer` de abajo y el servidor de Next con `service_role`.

-- ── 2 · Los códigos ───────────────────────────────────────────────────────────────────────────

create table if not exists public.access_codes (
  codigo      text primary key,
  -- Los días de prueba que el código otorga. David, 30-ago: «con el enlace 7 días, sin él los 3 de
  -- siempre». REEMPLAZAN la prueba, no se suman — ver `now() + dias` más abajo, no `plan_renueva_en
  -- + dias`.
  dias        int  not null default 7 check (dias between 1 and 60),
  max_usos    int  not null default 100 check (max_usos > 0),
  usos        int  not null default 0 check (usos >= 0),
  expira_en   timestamptz,                 -- null = no vence
  activo      boolean not null default true,
  nota        text,                        -- «para la demo de Bogotá», «los 5 de David»
  creado_por  uuid references auth.users(id) on delete set null,
  creado_en   timestamptz not null default now(),
  -- EN MAYÚSCULAS SIEMPRE. El código viaja en un enlace que la gente teclea, y `vets2026` y
  -- `VETS2026` tienen que ser el mismo. Normalizar al escribir y al leer, en un solo formato, evita
  -- el bug clásico de dos filas que se ven iguales.
  constraint access_codes_forma check (codigo = upper(codigo) and codigo ~ '^[A-Z0-9-]{4,32}$')
);

comment on table public.access_codes is
  'Códigos que abren el registro con la puerta cerrada y fijan los días de prueba. Ver 0100.';

alter table public.access_codes enable row level security;
-- SIN POLICIES: nadie enumera los códigos desde el navegador. Sólo service_role.

-- ── 3 · Los pases ─────────────────────────────────────────────────────────────────────────────
--
-- LA CLAVE ES EL CORREO Y NO EL `user_id`, porque el pase se otorga ANTES de que la cuenta exista:
-- ése es todo el punto. Es también lo que hace que el pase sobreviva al camino de Google, donde el
-- correo recién se conoce al volver del proveedor.
--
-- PK sobre el correo = un pase por persona. Un segundo código sobre el mismo correo no hace nada,
-- que es exactamente lo que se quiere: los días no se acumulan repitiendo el enlace.

create table if not exists public.access_grants (
  email        text primary key,
  -- `restrict` y no `cascade`: borrar un código no puede dejar sin pase a quien ya entró con él. En
  -- el panel un código se DESACTIVA (deja de admitir gente nueva) y nunca se borra.
  codigo       text not null references public.access_codes(codigo) on delete restrict,
  otorgado_en  timestamptz not null default now(),
  -- Cuándo se convirtió en una clínica de verdad. `null` = el pase se dio y la persona nunca
  -- terminó de registrarse — que es la métrica que dice si el enlace está funcionando.
  usado_en     timestamptz,
  constraint access_grants_email_normalizado check (email = lower(email))
);

comment on table public.access_grants is
  'Quién puede registrarse con la puerta cerrada, por correo. Se otorga antes de que exista la cuenta. Ver 0100.';

create index if not exists access_grants_codigo_idx on public.access_grants (codigo);

alter table public.access_grants enable row level security;
-- SIN POLICIES: un `select` desde el navegador enumeraría los correos de todos los invitados.

-- ── 4 · Las dos preguntas, en un solo lugar ───────────────────────────────────────────────────

create or replace function private.la_puerta_esta_cerrada()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- `coalesce(..., false)`: si la fila no existe, la puerta está ABIERTA. Fallar hacia el
  -- comportamiento de siempre — una tabla vacía no puede dejar a la plataforma sin registro.
  select coalesce((select modo = 'cerrado' from public.platform_gate where id), false);
$$;

comment on function private.la_puerta_esta_cerrada() is
  'true si la plataforma está en modo cerrado. Ante la duda, false (abierta). Ver 0100.';

/**
 * Los días de prueba que le corresponden a un correo por su pase, o null si no tiene ninguno.
 *
 * Devuelve las dos respuestas de una sola vez —«¿puede pasar?» es `not null`, «¿cuántos días?» es
 * el valor— porque quien pregunta necesita siempre las dos y separarlas serían dos consultas que
 * pueden desincronizarse entre sí.
 */
create or replace function private.dias_del_pase(p_email text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select ac.dias
  from public.access_grants ag
  join public.access_codes  ac on ac.codigo = ag.codigo
  where ag.email = lower(p_email);
$$;

comment on function private.dias_del_pase(text) is
  'Días de prueba del pase de ese correo, o null si no tiene pase. Ver 0100.';

-- ── 5 · El embudo del alta automática ─────────────────────────────────────────────────────────
--
-- Se reescribe entera (de 0022/0041) para agregar el gate y los días. Lo anterior queda idéntico:
-- la salida temprana por clínica existente y la de invitación pendiente son las mismas líneas.

create or replace function private.ensure_clinic_membership(p_user_id uuid, p_email text, p_raw_meta jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clinic_id  uuid;
  v_has_invite boolean;
  v_name       text;
  v_dias       int;
  v_nueva      uuid;
begin
  select clinic_id into v_clinic_id from public.profiles where id = p_user_id;
  if v_clinic_id is not null then
    return; -- ya activo en una clinica
  end if;

  select exists (
    select 1 from public.invitations
    where lower(email) = lower(p_email) and accepted_at is null and expires_at > now()
  ) into v_has_invite;
  if v_has_invite then
    return; -- invitado pendiente: accept_invitation() lo resuelve
  end if;

  -- ── LA PUERTA ───────────────────────────────────────────────────────────────────────────────
  --
  -- Se lee el pase SIEMPRE, no sólo con la puerta cerrada: los días del código valen igual con la
  -- puerta abierta. Quien llega por el enlace de David tiene su semana aunque el registro esté
  -- abierto para todo el mundo, que es lo que el enlace promete.
  v_dias := private.dias_del_pase(p_email);

  if v_dias is null and private.la_puerta_esta_cerrada() then
    -- SIN CLÍNICA Y SIN ERROR. Un `raise` acá abortaría la transacción del trigger de `auth.users`
    -- y con ella la confirmación del correo: el usuario vería un fallo de autenticación críptico
    -- en vez de la pantalla que le pide el código. Salir en silencio deja la cuenta creada y sin
    -- clínica, que es el estado que `/auth/callback` detecta para mandarlo a `/signup`.
    return;
  end if;

  v_name := coalesce(
    nullif(p_raw_meta->>'clinic_name', ''),
    'Clinica de ' || coalesce(p_raw_meta->>'full_name', p_raw_meta->>'name', split_part(p_email, '@', 1))
  );
  v_nueva := private.provision_new_clinic(p_user_id, v_name);

  if v_dias is not null then
    -- LOS DÍAS REEMPLAZAN LA PRUEBA, NO SE SUMAN: `now() + dias`, no `plan_renueva_en + dias`. El
    -- trigger de la 0078 ya estampó pro+trial+3d hace un instante; esto sólo corre la fecha. `plan`
    -- y `subscription_status` no se tocan — la guarda de la 0078 sigue significando lo mismo.
    update public.clinics
       set plan_renueva_en = now() + make_interval(days => v_dias)
     where id = v_nueva;

    update public.access_grants
       set usado_en = coalesce(usado_en, now())
     where email = lower(p_email);
  end if;
end;
$function$;

-- ── 6 · El alta manual ────────────────────────────────────────────────────────────────────────
--
-- El tercer camino: `sin-clinica.tsx` cuando alguien quedó con cuenta y sin clínica. Con la puerta
-- cerrada tiene que pedir lo mismo que los otros dos, o sería el agujero por el que se cuela
-- exactamente el usuario que la puerta acaba de dejar sin clínica.

create or replace function public.create_clinic(clinic_name text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text;
  v_dias  int;
  v_nueva uuid;
begin
  select email into v_email from auth.users where id = auth.uid();
  v_dias := private.dias_del_pase(v_email);

  if v_dias is null and private.la_puerta_esta_cerrada() then
    -- ACÁ SÍ SE LEVANTA EL ERROR, al revés que en el embudo automático: esto lo llama una persona
    -- que apretó un botón y está mirando la pantalla. Un `return null` silencioso le dejaría el
    -- formulario girando sin decirle nunca que le falta un código.
    raise exception 'Tuvetia está en modo cerrado: hace falta un código de acceso para crear una clínica.'
      using errcode = '42501';
  end if;

  v_nueva := private.provision_new_clinic(auth.uid(), clinic_name);

  if v_dias is not null then
    update public.clinics
       set plan_renueva_en = now() + make_interval(days => v_dias)
     where id = v_nueva;

    update public.access_grants
       set usado_en = coalesce(usado_en, now())
     where email = lower(v_email);
  end if;

  return v_nueva;
end;
$function$;

-- ── 7 · El canje, atómico ─────────────────────────────────────────────────────────────────────
--
-- POR QUÉ ES UNA FUNCIÓN Y NO TRES CONSULTAS DESDE NEXT. El canje toca dos tablas y tiene que ser
-- todo o nada: leer el cupo, insertar el pase e incrementar `usos` desde el servidor de Next son
-- tres viajes, y entre el primero y el tercero cabe otro registro. Con `max_usos = 5` y una demo
-- donde cinco personas abren el enlace a la vez, eso son seis clínicas con siete días.
--
-- El `for update` de la primera línea es lo que lo resuelve: bloquea la fila del código, así que el
-- segundo canje simultáneo espera y lee el `usos` ya incrementado en vez del viejo.
--
-- Devuelve los días (int) si el canje valió, o `null` si el código no sirve. Quién teclea mal un
-- código es el caso común, no una excepción — por eso `null` y no `raise`.

create or replace function public.canjear_codigo(p_codigo text, p_email text)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo text := upper(trim(p_codigo));
  v_email  text := lower(trim(p_email));
  v_fila   public.access_codes%rowtype;
  v_dias   int;
begin
  -- UN PASE POR CORREO, y se responde ANTES de tocar el contador: quien vuelve a abrir el enlace
  -- —porque cerró la pestaña, porque lo abrió en el teléfono y en el computador— no puede gastar un
  -- cupo por cada vez. Se le devuelve el pase que ya tiene.
  select ac.dias into v_dias
    from public.access_grants ag
    join public.access_codes  ac on ac.codigo = ag.codigo
   where ag.email = v_email;
  if v_dias is not null then
    return v_dias;
  end if;

  select * into v_fila from public.access_codes where codigo = v_codigo for update;
  if not found then return null; end if;
  if not v_fila.activo then return null; end if;
  if v_fila.expira_en is not null and v_fila.expira_en <= now() then return null; end if;
  if v_fila.usos >= v_fila.max_usos then return null; end if;

  insert into public.access_grants (email, codigo) values (v_email, v_codigo);
  update public.access_codes set usos = usos + 1 where codigo = v_codigo;

  return v_fila.dias;
end;
$function$;

comment on function public.canjear_codigo(text, text) is
  'Canjea un código para un correo y devuelve los días de prueba, o null si no sirve. Ver 0100.';

-- VIVE EN `public` PORQUE PostgREST SÓLO EXPONE ESE ESQUEMA —el servidor de Next la llama por RPC
-- con service_role— PERO NO LA PUEDE LLAMAR NADIE MÁS. Sin este revoke, cualquiera con la clave
-- anónima podría regalarse un pase a la dirección que quisiera, o probar códigos a ciegas sin
-- límite desde la consola del navegador. `security definer` sin revoke es el footgun clásico.
revoke all on function public.canjear_codigo(text, text) from public;
revoke all on function public.canjear_codigo(text, text) from anon, authenticated;

-- ── 8 · Reintentar el alta, para el camino de Google ──────────────────────────────────────────
--
-- EL PROBLEMA QUE RESUELVE, QUE ES DE ORDEN. Por correo el pase se otorga ANTES de mandar el enlace
-- —se sabe la dirección: la escribió el vet en el formulario— así que cuando el trigger de
-- confirmación corre, el pase ya está y la clínica se aprovisiona en el mismo movimiento.
--
-- Por Google no: la dirección recién se conoce al VOLVER del proveedor, y para entonces el trigger
-- ya corrió y ya decidió que no había pase. La clínica no se creó, y el trigger no vuelve a
-- dispararse nunca (es `when old.email_confirmed_at is null`, una sola vez en la vida de la cuenta).
--
-- Entonces `/auth/callback` canjea el código y llama a esto, que vuelve a pasar por el MISMO embudo
-- —no una copia— con el pase ya puesto. Es idempotente por construcción: la primera línea de
-- `ensure_clinic_membership` se va si la cuenta ya tiene clínica.

create or replace function public.aprovisionar_alta(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u auth.users%rowtype;
begin
  select * into u from auth.users where id = p_user_id;
  if not found then return; end if;
  perform private.ensure_clinic_membership(u.id, u.email, u.raw_user_meta_data);
end;
$function$;

comment on function public.aprovisionar_alta(uuid) is
  'Vuelve a pasar una cuenta por el embudo de alta. Para el registro por OAuth, donde el pase llega después del trigger. Ver 0100.';

-- Mismo revoke que `canjear_codigo`, y por el mismo motivo: sin esto, cualquiera con la clave
-- anónima aprovisionaría clínicas para cuentas ajenas.
revoke all on function public.aprovisionar_alta(uuid) from public;
revoke all on function public.aprovisionar_alta(uuid) from anon, authenticated;

-- ── Comprobación, para correr después de aplicarla ────────────────────────────────────────────
--
--   select modo from public.platform_gate;                        -- 'abierto'
--   select private.la_puerta_esta_cerrada();                       -- false
--   select private.dias_del_pase('nadie@ejemplo.com');              -- null
--
-- Y que las tres tablas quedaron sin una sola policy (o sea, invisibles para anon/authenticated):
--
--   select tablename, count(*) from pg_policies
--    where tablename in ('platform_gate','access_codes','access_grants') group by 1;   -- 0 filas
