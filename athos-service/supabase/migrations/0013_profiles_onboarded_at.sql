-- ============================================================
-- 0013_profiles_onboarded_at.sql
-- Onboarding guiado: marca cuándo el usuario completó (o saltó) el tour de bienvenida, para
-- mostrarlo una sola vez. RPC mark_onboarded() lo setea para el usuario actual (evita depender
-- de la policy de update de profiles).
-- ============================================================

alter table public.profiles add column if not exists onboarded_at timestamptz;

create or replace function public.mark_onboarded()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.profiles set onboarded_at = now()
   where id = (select auth.uid()) and onboarded_at is null;
end;
$function$;
