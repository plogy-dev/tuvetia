-- ============================================================
-- 0041_oauth_metadata_fallback.sql
-- Login con Microsoft/Outlook (provider "azure"): a diferencia de Google, Supabase no siempre
-- puebla raw_user_meta_data->>'full_name'/'avatar_url' para este provider (usa 'name'/'picture').
-- private.ensure_clinic_membership ya tenía el fallback a 'name' (0022) para el nombre placeholder
-- de la clínica; acá se agrega el mismo fallback al perfil en sí, para cualquier provider futuro
-- que tampoco use las claves de Google.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do nothing;

  -- Edge case: usuario ya creado con email confirmado en el INSERT (p.ej. desde Studio
  -- con auto-confirm). El caso normal (confirma despues) lo cubre el trigger de UPDATE.
  if new.email_confirmed_at is not null then
    perform private.ensure_clinic_membership(new.id, new.email, new.raw_user_meta_data);
  end if;
  return new;
end;
$function$;
