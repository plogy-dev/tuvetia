-- 0069: el horario deja de ser sólo de la clínica y pasa a poder ser de cada persona.
--
-- POR QUÉ. La 0030 modeló `clinic_hours` como un horario único por clínica, y con un veterinario
-- eso alcanza. Con tres no: en la reunión del 17-ago salió que los correos salen con el horario
-- equivocado —"lo manda desde su correo… el horario es el suyo y no es el mío"— y la causa es ésta:
-- el sistema sólo conoce UN horario y lo aplica a todos. Un vet que atiende de 14 a 20 aparece
-- disponible a las 8 porque la clínica abre a las 8.
--
-- CÓMO QUEDA. `vet_id` nulo = el horario DE LA CLÍNICA, que es lo que hay hoy y sigue siendo el
-- default. `vet_id` con valor = el horario de esa persona, que reemplaza al de la clínica **para
-- ella y sólo en los días que definió**.
--
-- QUE EL REEMPLAZO SEA POR DÍA Y NO EN BLOQUE ES LA DECISIÓN QUE IMPORTA. Si definir un día
-- personal apagara la semana entera, cargar "los martes entro a las 2" dejaría a esa persona sin
-- horario el resto de la semana — y nadie leería eso en la UI antes de que un titular se quede sin
-- cupo. Día por día, lo que no definís lo sigue cubriendo la clínica.
--
-- MIGRACIÓN DE DATOS: NINGUNA. Todas las filas existentes quedan con `vet_id` nulo, o sea horario
-- de clínica, o sea exactamente lo que significaban antes. Esta migración no cambia el
-- comportamiento de nadie por sí sola: lo habilita.

-- ── La columna ──────────────────────────────────────────────────────────────────────────────────

alter table public.clinic_hours
  add column if not exists vet_id uuid references public.profiles(id) on delete cascade;

comment on column public.clinic_hours.vet_id is
  'Nulo = horario de la clínica (default). Con valor = horario propio de esa persona, que reemplaza al de la clínica en los días que definió.';

-- ── La unicidad, que ahora son dos reglas y no una ──────────────────────────────────────────────
--
-- La 0030 tenía `unique (clinic_id, weekday, opens_at)`. Agregarle `vet_id` NO alcanza: en
-- Postgres los NULL son distintos entre sí dentro de un índice único, así que dos filas de clínica
-- idénticas pasarían — se perdería justo la garantía que había.
--
-- `UNIQUE NULLS NOT DISTINCT` lo resolvería en una línea, pero es de PG 15 y esto se aplica a mano
-- contra un proyecto cuya versión no controlamos. Dos índices parciales dicen lo mismo y corren en
-- cualquier versión: uno para las filas de la clínica, otro para las de cada persona.

alter table public.clinic_hours drop constraint if exists clinic_hours_clinic_id_weekday_opens_at_key;

create unique index if not exists clinic_hours_unico_de_la_clinica
  on public.clinic_hours (clinic_id, weekday, opens_at)
  where vet_id is null;

create unique index if not exists clinic_hours_unico_de_la_persona
  on public.clinic_hours (clinic_id, vet_id, weekday, opens_at)
  where vet_id is not null;

-- ── El índice de lectura ────────────────────────────────────────────────────────────────────────
--
-- Toda consulta de horarios pasó a preguntar por los tres campos a la vez: la clínica, el día, y
-- si la fila es de la clínica o de una persona. El índice de la 0030 se quedaba en los dos
-- primeros y obligaba a filtrar el resto en memoria.

drop index if exists public.idx_clinic_hours_clinic;

create index if not exists idx_clinic_hours_busqueda
  on public.clinic_hours (clinic_id, weekday, vet_id);

-- ── Que el horario personal sea de alguien del mismo equipo ─────────────────────────────────────
--
-- La FK garantiza que `vet_id` sea un perfil que existe, no que sea un perfil DE ESTA CLÍNICA. Un
-- CHECK no puede consultar otra tabla, así que va como trigger — el mismo camino que tomó la 0067
-- para el solapamiento de citas.
--
-- No es paranoia de RLS: es que una fila así queda invisible para las dos clínicas (la dueña no
-- reconoce el vet, la del vet no ve la fila) y ocupa un cupo de unicidad que nadie puede depurar.

create or replace function private.horario_es_del_mismo_equipo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.vet_id is not null and not exists (
    select 1 from public.profiles p where p.id = new.vet_id and p.clinic_id = new.clinic_id
  ) then
    raise exception 'El horario personal tiene que ser de alguien de la misma clínica.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists clinic_hours_del_mismo_equipo on public.clinic_hours;

create trigger clinic_hours_del_mismo_equipo
  before insert or update on public.clinic_hours
  for each row execute function private.horario_es_del_mismo_equipo();

-- ── Quién puede tocar el horario de quién ───────────────────────────────────────────────────────
--
-- LO QUE **NO** CAMBIA: el horario de la clínica lo sigue pudiendo editar cualquier miembro, igual
-- que hoy. Restringirlo a admin sería un cambio de permisos que nadie pidió y rompería el asistente
-- de bienvenida para quien no lo es.
--
-- LO QUE SE AGREGA: el horario personal es tuyo o de un admin. Que un vet pueda reescribir la
-- agenda de otro es exactamente lo que el 19-ago quedó como permiso a otorgar, no como default.
--
-- `ALTER POLICY` y no `drop` + `create`, por lo mismo que explicó la 0059: son dos sentencias, y
-- `psql -f` sin `-1` las corre en autocommit — entre una y otra queda una ventana, corta pero real,
-- con RLS habilitada y sin policy.

alter policy "clinic_hours_insert" on public.clinic_hours
  with check (
    clinic_id = (select private.my_clinic_id())
    and (vet_id is null or vet_id = (select auth.uid()) or (select private.my_role()) = 'admin')
  );

alter policy "clinic_hours_update" on public.clinic_hours
  using (
    clinic_id = (select private.my_clinic_id())
    and (vet_id is null or vet_id = (select auth.uid()) or (select private.my_role()) = 'admin')
  )
  with check (
    clinic_id = (select private.my_clinic_id())
    and (vet_id is null or vet_id = (select auth.uid()) or (select private.my_role()) = 'admin')
  );

alter policy "clinic_hours_delete" on public.clinic_hours
  using (
    clinic_id = (select private.my_clinic_id())
    and (vet_id is null or vet_id = (select auth.uid()) or (select private.my_role()) = 'admin')
  );

-- La de SELECT queda como está: el horario de un compañero se LEE (hace falta para agendar con él),
-- lo que no se hace es escribirlo.
