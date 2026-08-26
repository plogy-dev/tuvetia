-- 0096: que «sin hora definida» de verdad ocupe el día.
--
-- ── EL DEFECTO ──────────────────────────────────────────────────────────────────────────────────
--
-- La 0093 agregó `sin_hora` y su nota dice, textual, que la cita «se guarda cubriendo el día en
-- horario de Bogotá y se MARCA». La marca se guardaba; el rango no. El drawer mandaba `p_sin_hora`
-- y dejaba el `starts_at`/`ends_at` de treinta minutos que traía el formulario, así que marcar la
-- casilla no reservaba nada: el vet creía haber bloqueado el día y el antisolape de la 0067 seguía
-- dejando agendar encima a las 9:30.
--
-- ── POR QUÉ UN TRIGGER Y NO REDECLARAR LAS RPC ──────────────────────────────────────────────────
--
-- Se podría meter el ajuste arriba de `create_appointment` y `update_appointment`. Eso obliga a
-- copiar las dos funciones ENTERAS —unas 180 líneas que ya venían copiadas de la 0048 a la 0093— y
-- deja la regla en dos lugares que hay que acordarse de mantener iguales.
--
-- Y sobre todo: no cubre a nadie más. Hoy el único que manda `sin_hora` es el drawer, pero la
-- columna es de la TABLA. El agente de Athos, el ejecutor de acciones o un backfill escriben por
-- otros caminos, y con la regla dentro de las RPC cualquiera de ellos guardaría una cita marcada
-- como de día completo con un rango de media hora — el mismo defecto, otra vez, sin que nada falle.
--
-- Un trigger `before` es la regla donde vive el dato: no hay forma de escribir en esta tabla
-- salteándolo.
--
-- ── LA ZONA ES FIJA, Y ESO ES DEUDA CONOCIDA ────────────────────────────────────────────────────
--
-- 'America/Bogota' va escrito acá porque es donde opera la plataforma hoy, igual que el resto de la
-- app (`bogotaTodayISO`, el barrido de recordatorios, el cálculo de huecos). El día que haya una
-- clínica en otro huso, esto sale de acá y pasa a leerse de la clínica — y va a haber que revisar
-- los otros tres lugares en la misma tanda, no sólo éste.

create or replace function public.normalizar_cita_de_dia_completo()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_dia date;
begin
  if coalesce(new.sin_hora, false) then
    -- El DÍA de Bogotá al que pertenece el inicio que vino, y de ahí medianoche a medianoche. Se
    -- toma del inicio y no de `now()`: editar a las 23:00 una cita de mañana no puede moverla a hoy.
    v_dia := (new.starts_at at time zone 'America/Bogota')::date;
    new.starts_at := (v_dia::timestamp) at time zone 'America/Bogota';
    new.ends_at := ((v_dia + 1)::timestamp) at time zone 'America/Bogota';
  end if;
  return new;
end;
$function$;

comment on function public.normalizar_cita_de_dia_completo() is
  'Una cita marcada `sin_hora` cubre su día completo en horario de Bogotá. Vive como trigger y no '
  'dentro de las RPC para que valga para TODO el que escriba en appointments, no sólo para el drawer.';

-- ── QUE NO QUEDE COLGADA DE LA API ──────────────────────────────────────────────────────────────
--
-- Postgres le concede EXECUTE a PUBLIC sobre toda función nueva, y PUBLIC incluye a `anon` y
-- `authenticated`: sin esto, la función queda publicada en `/rest/v1/rpc/` para cualquiera. No es
-- explotable —Postgres rechaza invocar directamente una función que devuelve `trigger`, y ésta ni
-- siquiera es `security definer`— pero la deja apareciendo en el linter de seguridad y con más
-- superficie de la que necesita.
--
-- VA CONTRA `public` Y NO CONTRA LOS ROLES. Medido el 26-ago: revocarle a `anon` y `authenticated`
-- por nombre NO alcanza — el permiso que manda es el de PUBLIC (`=X/postgres` en el ACL) y ellos lo
-- heredan. Hay que quitárselo a PUBLIC.
--
-- No afecta al trigger: Postgres comprueba el permiso de ejecución al CREARLO, no cada vez que se
-- dispara.
revoke execute on function public.normalizar_cita_de_dia_completo() from public;

-- `before` y no `after`: hay que corregir la fila ANTES de que se guarde y antes de que el
-- antisolape de la 0067 la mire. Un `after` vería el rango de media hora y dejaría agendar encima.
drop trigger if exists appointments_dia_completo on public.appointments;
create trigger appointments_dia_completo
  before insert or update on public.appointments
  for each row execute function public.normalizar_cita_de_dia_completo();

-- ── LAS QUE YA SE GUARDARON MAL ─────────────────────────────────────────────────────────────────
--
-- Las citas creadas entre la 0093 y esta migración quedaron marcadas y con media hora. Se
-- reescriben una vez; el trigger hace la cuenta, así que el `update` sólo tiene que tocarlas.
update public.appointments set sin_hora = sin_hora where sin_hora is true;
