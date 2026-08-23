-- La prueba de tres días: toda clínica nueva nace con Pro, y se le cae sola.
--
-- Decidido en la reunión del 22-ago: «se establece un periodo de prueba gratuito de 3 días para el
-- uso de las funciones de inteligencia artificial». En el código no existía nada — ni columna, ni
-- ventana, ni lógica: una clínica sin suscripción simplemente no tenía Athos desde el primer
-- minuto, así que nadie llegaba a ver para qué sirve lo que se le está cobrando.
--
-- ── POR QUÉ NO HAY COLUMNA NUEVA ──────────────────────────────────────────────────────────────
--
-- La tentación es un `trial_ends_at`. Sería una segunda columna que dice CUÁNDO VOLVER A MIRAR a
-- esta clínica, y ya existe una que significa exactamente eso: `plan_renueva_en`. El barrido
-- (`lib/suscripcion/barrido.ts`) está construido sobre esa única columna a propósito —su comentario
-- lo dice: «eso deja la consulta en una línea y hace que no exista ninguna clínica que el barrido
-- pueda no ver»—. Con `trial_ends_at` habría DOS relojes, un barrido que mira uno y otro que mira
-- el otro, y clínicas que se cuelan entre los dos.
--
-- Una prueba, entonces, no es un estado nuevo: es exactamente lo que ya se sabe expresar.
--
--     plan                = 'pro'        → qué puede hacer AHORA (lo único que lee el gate)
--     subscription_status = 'trial'      → en qué punto está su relación de cobro
--     plan_renueva_en     = ahora + 3d   → cuándo hay que volver a mirarla
--
-- Y de paso `'trial'` deja de ser lo que la 0065 anotó como «el default histórico, nadie lo escribe,
-- queda por compatibilidad»: ahora significa algo.
--
-- ── POR QUÉ UN TRIGGER Y NO UN DEFAULT ────────────────────────────────────────────────────────
--
-- `plan` no puede tener default `'pro'`: un default no caduca, así que regalaría el producto para
-- siempre a cualquier fila que naciera sin decir nada. Y las tres columnas tienen que moverse
-- JUNTAS o la fila queda incoherente — Pro sin fecha de vencimiento es Pro para siempre.
--
-- Tampoco alcanza con tocar la función que crea la clínica, porque no hay UNA: `insert into
-- public.clinics` aparece en `private.ensure_clinic_membership` (0022), en la de 0048 y otra vez en
-- 0055. Un trigger `before insert` cubre todos los caminos, incluidos los que se escriban después,
-- que es justo el error que se quiere evitar: un camino nuevo que no dé la prueba y nadie lo note
-- hasta que un cliente pregunte por qué a él no le tocó.
--
-- ── SIN BACKFILL, Y NO ES UN OLVIDO ───────────────────────────────────────────────────────────
--
-- Medido en el principal antes de escribir esto: 14 clínicas en `cortesia` (Pro sin cobrar, las
-- anteriores a los planes), 1 en `active`, y UNA sola en `free` — creada el 17-ago, con
-- `plan_renueva_en` en null. Darle una prueba a las de cortesía sería bajarles el plan cuando venza;
-- dársela a la de `free` es un regalo de tres días a una clínica de prueba que ya lleva seis sin
-- pedirlo. La prueba empieza a valer para las que nazcan de acá en adelante.
--
-- Esa clínica en `free` tiene `subscription_status = 'trial'` por el default histórico, y NO se la
-- lleva por delante ni el gate ni el barrido: el gate lee `plan`, que dice `free`, y el barrido
-- filtra por `plan_renueva_en <= now()`, que en null no matchea nada.
--
-- Aplicar en el principal (`auxlnexhkmtoedrzfsnz`). Reversible: basta con borrar el trigger.

-- ── El reloj de la prueba, en un solo lugar ────────────────────────────────────────────────────
--
-- Como constante SQL no existe: va acá y en `lib/planes/index.ts` (DIAS_DE_PRUEBA). Son los dos
-- lados del mismo número —la base lo escribe, la interfaz cuenta cuántos quedan— y hay un test que
-- fija el de TypeScript. Si algún día se cambia, se cambian los dos.

create or replace function private.arrancar_la_prueba()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- SÓLO SI NADIE DECIDIÓ OTRA COSA. Una fila que ya viene con plan o con fecha de renovación es
  -- alguien creando una clínica a propósito —una migración, un traspaso, el panel de admin— y
  -- pisarla convertiría un alta deliberada de Pro en una prueba de tres días.
  if new.plan is distinct from 'free' or new.plan_renueva_en is not null then
    return new;
  end if;

  new.plan := 'pro';
  new.subscription_status := 'trial';
  new.plan_renueva_en := now() + interval '3 days';
  return new;
end;
$$;

comment on function private.arrancar_la_prueba() is
  'Estampa la prueba de 3 días en toda clínica nueva: pro + trial + plan_renueva_en. Ver 0078.';

drop trigger if exists clinics_arrancar_la_prueba on public.clinics;

create trigger clinics_arrancar_la_prueba
  before insert on public.clinics
  for each row
  execute function private.arrancar_la_prueba();
