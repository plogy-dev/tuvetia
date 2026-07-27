-- Bloquea que un cliente autenticado reasigne su propia clinic_id/role via UPDATE directo.
-- Antes, la policy profiles_update solo tenia USING (id = auth.uid()) sin WITH CHECK, asi
-- que cualquier usuario podia hacer supabase.from('profiles').update({ clinic_id, role })
-- y auto-asignarse admin de cualquier clinica (toda la RLS del sistema confia en
-- private.my_clinic_id()/my_role(), que solo leen estas dos columnas de profiles).
--
-- current_user <> 'postgres' identifica llamadas externas (PostgREST como authenticated/anon);
-- las funciones SECURITY DEFINER (create_clinic, accept_invitation, switch_active_clinic, etc.)
-- son owned by postgres y corren como ese rol, asi que siguen funcionando sin restriccion.
create or replace function public.profiles_guard_sensitive_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user <> 'postgres'
     and (new.clinic_id is distinct from old.clinic_id or new.role is distinct from old.role)
  then
    raise exception 'clinic_id y role solo se modifican via create_clinic/accept_invitation/switch_active_clinic';
  end if;
  return new;
end;
$function$;

drop trigger if exists profiles_guard_sensitive_columns on public.profiles;
create trigger profiles_guard_sensitive_columns
  before update on public.profiles
  for each row execute procedure public.profiles_guard_sensitive_columns();
