-- Shim de Supabase para el Postgres "pelado" del CI (services: en ci.yml).
--
-- El esquema del repo (bootstrap + migraciones) nació en Supabase y asume tres cosas que un
-- Postgres vanilla no trae: el esquema `auth` con su tabla `users` y la función `auth.uid()`,
-- y los roles `anon`/`authenticated`/`service_role` a los que las políticas RLS hacen GRANT.
-- Este archivo crea el mínimo indispensable para que ese SQL aplique tal cual — NO reimplementa
-- Supabase: `auth.uid()` devuelve el claim si alguien lo setea (los tests usan service-role-style
-- conexiones directas y pasan clinic_id explícito, igual que producción).
--
-- Se aplica ANTES de `athos-service/supabase/bootstrap/000_base_schema.sql`. Solo CI: ningún
-- entorno real debe ver este archivo.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;
