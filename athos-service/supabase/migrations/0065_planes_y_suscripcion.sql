-- Los dos planes: gratis de por vida, y Pro.
--
-- QUÉ SE COBRA. El acta del sync del 12-ago cerró el modelo: el CRM es gratis, se cobra lo que
-- consume IA. Este cambio le da cuerpo a eso en la base:
--
--   · **Gratis** — Pacientes, Agenda, Ventas, Comunicaciones, Dashboard, Integraciones y
--     Configuración. Todo el CRM, sin tope y sin caducidad. Ninguna de esas superficies llama a un
--     modelo, así que regalarlas no cuesta un peso de consumo variable.
--   · **Pro** — las SEIS superficies de IA. No sólo las dos pantallas (Athos y Modo Fantasma):
--     también la sugerencia de respuesta de la bandeja, el modo automático de WhatsApp, la
--     clasificación de intents de cartera y la lectura de recetas por foto. El corte es por GASTO,
--     no por pantalla; si fuera por pantalla, una clínica gratis seguiría quemando IA por el modo
--     automático de WhatsApp y por el barrido de cartera —las dos que gastan sin que el vet lo
--     note— y ése es exactamente el agujero que `FUNCIONALIDADES.md` venía señalando.
--
-- ── 1. Por qué `plan` es una columna nueva y no `subscription_status` ───────────────────────────
--
-- `clinics.subscription_status` ya existe (`text not null default 'trial'`) y hoy las 15 clínicas
-- del principal están en `'trial'`. Se lee en UN solo lugar de todo el repo —`lib/admin/metrics.ts`,
-- y sólo para mostrarlo en el panel interno—; nada lo escribe y nada lo usa como puerta.
--
-- Podría reutilizarse para las dos cosas, y sería un error. Son preguntas distintas:
--
--     plan                → «¿qué puede hacer esta clínica AHORA MISMO?»   free | pro
--     subscription_status → «¿en qué estado está su relación de cobro?»    inactive | active | …
--
-- Mezclarlas obliga a que cada gate del código conozca la tabla completa de estados y decida cuáles
-- dan acceso. Con `plan` aparte, **el gate lee una sola columna con dos valores** y el estado de
-- cobro queda como problema del motor de renovación, que es el único que necesita entenderlo. Una
-- clínica en `past_due` dentro de su período de gracia sigue con `plan = 'pro'`: es el motor el que
-- decide cuándo bajarla, no cada `if` desperdigado.
--
-- ── 2. NADIE SE QUEDA SIN NADA EL DÍA DEL DESPLIEGUE ────────────────────────────────────────────
--
-- El default de `plan` es `'free'`, pero **las clínicas que ya existen se marcan `'pro'`** con
-- `subscription_status = 'cortesia'`. Es deliberado y es la parte más importante de esta migración.
--
-- Sin eso, el minuto en que esto se aplique 15 clínicas reales pierden Athos y el Modo Fantasma en
-- medio de una consulta, sin aviso y sin haber hecho nada. Cortarle el acceso a alguien que ya
-- estaba trabajando no es «aplicar el plan»: es romperle el día. A quién se le cobra y desde cuándo
-- es una decisión comercial con una conversación previa, no un efecto colateral de un `alter table`.
--
-- Es el mismo criterio con el que se desplegó el gate de `is_active` en la 0059: «el gate queda
-- armado y sin nadie adentro, que es exactamente como se quiere desplegar algo que corta accesos».
-- Pasar una clínica de cortesía a `'free'` es un `update` de una línea cuando se decida.
--
-- ── 3. Por qué el prefijo es `suscripcion_` y no `billing_` ────────────────────────────────────
--
-- `billing_payers` y `billing_settings` YA EXISTEN y son de otra cosa: el módulo con el que la
-- clínica le factura a SUS clientes. Meter acá `billing_cobros` dejaría dos significados de
-- "billing" en el mismo esquema — el dinero que entra a la clínica y el que sale hacia Tuvetia —
-- y esa confusión se paga cara el día que alguien consulte la tabla equivocada.
--
-- ── 4. El trigger de `consultations` no es opcional ────────────────────────────────────────────
--
-- «Iniciar consulta» hace un `insert` DIRECTO desde el navegador (`new-consultation-drawer.tsx`),
-- con la sesión del vet. No pasa por ninguna ruta de API. Un gate sólo en React lo esquiva
-- cualquiera con la consola abierta, y el Modo Fantasma es el módulo MÁS CARO del producto
-- (transcripción por minuto + redacción de la nota).
--
-- Por eso el corte vive en un trigger `before insert`. La interfaz muestra la ventana de invitación
-- a Pro; el trigger es lo que hace que esa ventana no sea decorativa.

-- ── El plan de cada clínica ─────────────────────────────────────────────────────────────────────

alter table public.clinics
  add column if not exists plan text not null default 'free',
  -- Cuándo termina el período YA PAGADO. `null` en free. El motor de renovación cobra cuando esta
  -- fecha queda en el pasado, así que es también el reloj del período de gracia.
  add column if not exists plan_renueva_en timestamptz,
  -- La cancelación NO es inmediata: se marca acá y el plan cae a free cuando vence `plan_renueva_en`.
  -- Quien pagó el mes se lo usa entero; cortarle el día que cancela sería quedarse con plata por un
  -- servicio no prestado.
  add column if not exists plan_cancelado_en timestamptz,
  -- La fuente de pago de Wompi: la tarjeta tokenizada con la que se cobra cada mes. Es un id
  -- numérico de Wompi, no una tarjeta — acá NUNCA se guarda un número de tarjeta.
  add column if not exists wompi_payment_source_id bigint,
  -- El correo con el que se creó la fuente de pago. Wompi exige mandar el MISMO en cada cobro.
  add column if not exists wompi_customer_email text,
  -- Sólo para que la pantalla de Plan pueda decir "Visa ···· 4242". Son los dos únicos datos de la
  -- tarjeta que Wompi devuelve y que es legítimo guardar.
  add column if not exists tarjeta_marca text,
  add column if not exists tarjeta_ultimos4 text;

-- Dos valores y nada más. Un `plan` con un typo —'Pro', 'PRO', 'premium'— no daría acceso a nada y
-- el síntoma sería "a esta clínica no le funciona Athos", que nadie relaciona con un CHECK ausente.
alter table public.clinics drop constraint if exists clinics_plan_check;
alter table public.clinics
  add constraint clinics_plan_check check (plan in ('free', 'pro'));

-- `subscription_status` pasa a tener un vocabulario cerrado. Incluye `'trial'` porque es el valor
-- que tienen HOY las 15 filas del principal: dejarlo afuera haría fallar el `alter` contra la base
-- real, que es la peor forma de enterarse.
--
--   trial      → el default histórico. Nadie lo escribe; queda por compatibilidad.
--   cortesia   → Pro sin cobrar. Las clínicas anteriores a los planes, y las del equipo.
--   inactive   → nunca pagó, o canceló y ya venció. Es el estado natural de una clínica free.
--   active     → pagando, al día.
--   past_due   → el último cobro falló. Sigue en Pro hasta que se agoten los reintentos.
--   canceled   → pidió cancelar. Sigue en Pro hasta `plan_renueva_en`.
alter table public.clinics drop constraint if exists clinics_subscription_status_check;
alter table public.clinics
  add constraint clinics_subscription_status_check
  check (subscription_status in ('trial', 'cortesia', 'inactive', 'active', 'past_due', 'canceled'));

-- Las que ya existen entran en cortesía. Ver el bloque 2 de arriba: esto es lo que evita que el
-- despliegue le corte Athos a quien ya estaba trabajando.
--
-- `where plan = 'free'` y no `where true`: si esta migración se corre dos veces —o si alguien ya
-- movió una clínica a mano— no pisa nada de lo que se haya decidido después.
update public.clinics
   set plan = 'pro',
       subscription_status = 'cortesia'
 where plan = 'free'
   and subscription_status = 'trial';

comment on column public.clinics.plan is
  'Qué puede hacer la clínica AHORA: free (todo el CRM) | pro (además, las 6 superficies de IA). '
  'Es la única columna que leen los gates. El estado de cobro va en subscription_status.';

-- `wompi_subscription_id` queda como estaba y SIN USO. No se borra —tirar una columna de una base
-- compartida es más riesgoso que dejarla— pero que quede escrito: Wompi no tiene suscripciones. No
-- hay planes ni ciclos del lado del proveedor; el motor de renovación es nuestro y la única llave
-- que Wompi nos da es `wompi_payment_source_id`.
comment on column public.clinics.wompi_subscription_id is
  'MUERTA. Wompi no tiene producto de suscripciones: se cobra con wompi_payment_source_id. '
  'No la uses; el ciclo de facturación lo lleva suscripcion_cobros.';

-- ── El libro de cobros ──────────────────────────────────────────────────────────────────────────
--
-- Una fila por INTENTO de cobro, no por mes. Un mes que se reintenta tres veces son tres filas, y
-- eso es lo que se quiere: "¿por qué esta clínica quedó en past_due?" se contesta leyendo la tabla.

create table if not exists public.suscripcion_cobros (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,

  -- LA CLAVE DE IDEMPOTENCIA. Es lo que se le manda a Wompi como `reference`, y Wompi rechaza dos
  -- transacciones con la misma. O sea que el `unique` de acá y el de allá dicen lo mismo: un
  -- reintento del cron —o dos lambdas corriendo a la vez— no puede cobrar dos veces el mismo mes.
  -- Formato: `tuvetia-<clinic_id>-<periodo>-<intento>`.
  referencia text not null unique,

  monto_centavos bigint not null check (monto_centavos > 0),
  moneda text not null default 'COP',

  -- PENDIENTE es el estado con el que nace: la fila se escribe ANTES de llamar a Wompi, para que
  -- un timeout no deje un cobro hecho del que no tenemos registro.
  estado text not null default 'PENDIENTE'
    check (estado in ('PENDIENTE', 'APROBADO', 'RECHAZADO', 'ERROR', 'ANULADO')),

  -- Por qué se cobró. Sirve para el historial de la pantalla de Plan y para diagnosticar.
  motivo text not null check (motivo in ('alta', 'renovacion', 'reintento')),
  intento int not null default 1 check (intento >= 1),

  -- El período que este cobro paga. Con esto la pantalla puede decir "1 sep – 1 oct".
  periodo_inicio date,
  periodo_fin date,

  wompi_transaction_id text,
  -- El estado crudo que devolvió Wompi (APPROVED/DECLINED/VOIDED/ERROR) y el motivo del rechazo,
  -- sin interpretar. Cuando el mapeo de arriba se quede corto, acá está lo que dijo el proveedor.
  wompi_estado text,
  wompi_mensaje text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists suscripcion_cobros_clinic_idx
  on public.suscripcion_cobros (clinic_id, created_at desc);
create index if not exists suscripcion_cobros_transaction_idx
  on public.suscripcion_cobros (wompi_transaction_id)
  where wompi_transaction_id is not null;

-- ── El registro crudo de lo que manda Wompi ─────────────────────────────────────────────────────
--
-- Todo evento entrante se guarda ANTES de interpretarlo, incluidos los que traen un checksum
-- inválido. Un webhook que llega con firma mala es justamente el que hay que poder mirar después.

create table if not exists public.suscripcion_eventos (
  id uuid primary key default gen_random_uuid(),
  evento text,
  wompi_transaction_id text,
  -- false = la firma no validó. Se guarda igual, pero NO se actúa sobre él.
  firma_valida boolean not null default false,
  payload jsonb not null,
  -- `null` mientras no se haya aplicado. Distingue "llegó" de "surtió efecto".
  procesado_en timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists suscripcion_eventos_transaction_idx
  on public.suscripcion_eventos (wompi_transaction_id, created_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────────────────────────

alter table public.suscripcion_cobros enable row level security;
alter table public.suscripcion_eventos enable row level security;

-- Los miembros de la clínica LEEN sus propios cobros — es su historial de pagos y tienen derecho a
-- verlo. Nadie escribe desde la sesión: el único que inserta y actualiza es el servidor con la
-- llave de servicio, que no pasa por RLS. Sin policy de INSERT/UPDATE, PostgREST las deniega todas.
drop policy if exists suscripcion_cobros_select on public.suscripcion_cobros;
create policy suscripcion_cobros_select on public.suscripcion_cobros
  for select using (clinic_id = private.my_clinic_id());

-- Los eventos crudos NO se exponen a nadie: traen el payload completo del proveedor. Sin una sola
-- policy, la tabla queda cerrada salvo para la llave de servicio.

-- ── El corte del Modo Fantasma, donde no se puede esquivar ──────────────────────────────────────

create or replace function public.consulta_requiere_plan_pro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
begin
  select plan into v_plan from public.clinics where id = new.clinic_id;

  -- FALLA ABIERTA si la clínica no aparece. Es el mismo criterio que el resto del repo (el juez de
  -- evidencia, el presupuesto de IA): dejar a un veterinario sin poder abrir la consulta por una
  -- lectura que no resolvió es peor que dejar pasar una consulta de más. El caso real es un
  -- `clinic_id` nuevo dentro de una transacción que todavía no confirmó.
  if v_plan is null then
    return new;
  end if;

  if v_plan <> 'pro' then
    -- El texto viaja tal cual al navegador vía PostgREST, así que está escrito para que lo lea un
    -- veterinario y no un desarrollador. La interfaz igual muestra su propia ventana antes de
    -- llegar acá; esto es la red de abajo.
    raise exception 'El Modo Fantasma es parte del plan Pro. Subí de plan para grabar consultas.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists consultations_requiere_pro on public.consultations;
create trigger consultations_requiere_pro
  before insert on public.consultations
  for each row execute function public.consulta_requiere_plan_pro();

comment on function public.consulta_requiere_plan_pro() is
  'Corta "iniciar consulta" cuando la clínica no es Pro. Vive en un trigger y no en la app porque '
  'el insert se hace DIRECTO desde el navegador, sin pasar por ninguna ruta de API.';

-- Y NO SE PUBLICA COMO RPC.
--
-- Lo detectó el linter de seguridad de Supabase al aplicar esto: al ser `security definer` y vivir
-- en `public`, PostgREST la expone en `/rest/v1/rpc/consulta_requiere_plan_pro` y la puede invocar
-- hasta el rol `anon`, sin sesión.
--
-- No es explotable hoy —una función que devuelve `trigger` falla sola si se la llama fuera de un
-- trigger— pero es superficie regalada, y el día que alguien la edite y le cambie el tipo de
-- retorno el agujero nace hecho, sin que nadie lo relacione con este descuido.
--
-- Los triggers NO pasan por estos permisos: corren con los del dueño de la tabla. Revocar EXECUTE
-- no toca en nada el corte del Modo Fantasma (verificado contra el principal después de aplicarlo).
revoke execute on function public.consulta_requiere_plan_pro() from public;
revoke execute on function public.consulta_requiere_plan_pro() from anon;
revoke execute on function public.consulta_requiere_plan_pro() from authenticated;
