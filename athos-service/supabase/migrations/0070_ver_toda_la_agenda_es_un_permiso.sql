-- 0070: ver la agenda de toda la clínica pasa a ser un permiso que se otorga.
--
-- LO QUE SE PIDIÓ, Luciano el 19-ago: que ver toda la agenda sea permiso de administrador — *"que
-- ese permiso se pueda otorgar"*. Las dos mitades importan: que no lo tenga cualquiera, y que un
-- admin pueda dárselo a quien corresponda sin volverlo admin de todo.
--
-- POR ESO ES UNA COLUMNA Y NO UN ROL. Los roles son dos —`admin` y `vet`— y ascender a alguien a
-- admin para que pueda mirar la agenda le daría además invitar miembros, cambiar la clínica y todo
-- lo demás. Un permiso suelto es exactamente lo que se pidió.
--
-- ── LO QUE ESTE PERMISO **NO** ES ───────────────────────────────────────────────────────────────
--
-- No es una frontera de seguridad, y conviene decirlo acá y no descubrirlo después.
--
-- La RLS de `appointments` NO se toca: sigue siendo por clínica. Restringirla a "las mías" rompería
-- algo peor de lo que arregla — `list_available_slots` sin veterinario resta las citas de TODOS a
-- propósito (modo conservador), y con la RLS angosta pasaría a ofrecer cupos que un compañero ya
-- tiene ocupados. Eso es doble reserva, que es justo lo que la 0067 vino a impedir.
--
-- Lo que hace este permiso es gobernar QUÉ SE LE MANDA AL NAVEGADOR desde la pantalla de agenda:
-- sin el permiso, la consulta trae sólo las citas propias y las que no son de nadie. No es que el
-- dato esté prohibido, es que la agenda deja de ser un tablón de todos. Que es lo que se pidió.

-- ── La columna ──────────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists ve_agenda_completa boolean not null default false;

comment on column public.profiles.ve_agenda_completa is
  'Permiso otorgable: ver la agenda de toda la clínica, no sólo la propia. Un admin la ve siempre, sin necesidad de esta bandera.';

-- ── Que nadie se lo otorgue a sí mismo ──────────────────────────────────────────────────────────
--
-- ES LA PARTE QUE FALTABA SI NO SE HACE. La policy `profiles_update` es `using (id = auth.uid())`:
-- cualquiera puede editar su propio perfil desde el cliente. Sin esta guarda, un
-- `supabase.from('profiles').update({ ve_agenda_completa: true })` desde la consola del navegador
-- convertiría al permiso en un casillero de autoservicio.
--
-- La 0021 ya montó exactamente esta guarda para `clinic_id` y `role`, por el mismo motivo. Acá se
-- le suma la columna nueva — no se escribe una segunda, que sería otra que mantener.
--
-- `current_user <> 'postgres'` distingue las llamadas EXTERNAS (PostgREST como `authenticated`) de
-- las funciones SECURITY DEFINER, que son propiedad de postgres y corren como ese rol. O sea que la
-- RPC de abajo sigue pudiendo escribirla; el cliente no.
create or replace function public.profiles_guard_sensitive_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user <> 'postgres'
     and (
       new.clinic_id is distinct from old.clinic_id
       or new.role is distinct from old.role
       or new.ve_agenda_completa is distinct from old.ve_agenda_completa
     )
  then
    raise exception 'clinic_id, role y ve_agenda_completa solo se modifican via las RPC correspondientes';
  end if;
  return new;
end;
$function$;

-- El trigger ya existe desde la 0021 y apunta a esta misma función, así que reemplazarla alcanza.
-- Se recrea igual por si esta migración corre sobre una base donde la 0021 no dejó el trigger.
drop trigger if exists profiles_guard_sensitive_columns on public.profiles;
create trigger profiles_guard_sensitive_columns
  before update on public.profiles
  for each row execute procedure public.profiles_guard_sensitive_columns();

-- ── Otorgarlo y quitarlo ────────────────────────────────────────────────────────────────────────

create or replace function public.otorgar_agenda_completa(p_vet_id uuid, p_puede boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid := private.my_clinic_id();
begin
  if v_clinic_id is null then
    raise exception 'No hay clínica activa.';
  end if;
  if private.my_role() is distinct from 'admin'::public.user_role then
    raise exception 'Sólo un administrador puede otorgar el permiso de ver toda la agenda.';
  end if;

  update public.profiles
     set ve_agenda_completa = coalesce(p_puede, false),
         updated_at = now()
   -- `clinic_id` EXPLÍCITO aunque la función corra con privilegios: es lo único que impide que un
   -- admin de una clínica toque el perfil de alguien de otra. La RLS acá no ayuda — `security
   -- definer` la deja de lado, que es para lo que se usa.
   where id = p_vet_id
     and clinic_id = v_clinic_id;

  if not found then
    raise exception 'Esa persona no es de tu clínica.';
  end if;
end;
$$;

revoke all on function public.otorgar_agenda_completa(uuid, boolean) from public;
grant execute on function public.otorgar_agenda_completa(uuid, boolean) to authenticated;

-- ── Que la pantalla de Equipo pueda mostrar quién lo tiene ──────────────────────────────────────
--
-- `get_clinic_members` devolvía (id, full_name, email, role) y ahora tiene que devolver una columna
-- más. Va con `drop` + `create` y no con `create or replace` porque Postgres no deja cambiarle el
-- tipo de retorno a una función existente: `create or replace` falla con "cannot change return type
-- of existing function".
--
-- Y por eso hay que REPONER LOS GRANTS: `drop function` se lleva los permisos con ella, así que sin
-- las dos últimas líneas la pantalla de Equipo quedaría con un "permission denied for function"
-- para todo el mundo.
drop function if exists public.get_clinic_members();

create or replace function public.get_clinic_members()
returns table (id uuid, full_name text, email text, role public.user_role, ve_agenda_completa boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id, p.full_name, u.email, p.role, p.ve_agenda_completa
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.clinic_id = private.my_clinic_id()
  order by p.full_name;
$function$;

revoke execute on function public.get_clinic_members() from public, anon;
grant execute on function public.get_clinic_members() to authenticated, service_role;
