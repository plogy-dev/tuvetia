-- 0026: Hardening señalado por los advisors de Supabase (2026-07-28).
--
-- 1) corpus_chunks estaba expuesta por PostgREST sin RLS (ERROR del linter). Athos la lee por
--    psycopg con credenciales privilegiadas, así que cerrarla no afecta nada funcional.
-- 2) Las funciones SECURITY DEFINER eran ejecutables por `anon` (y PUBLIC, el default de Postgres).
--    Todas las llamadas legítimas del front corren con sesión (`authenticated`); se revoca PUBLIC y
--    anon y se otorga explícito a authenticated + service_role. Defensa en profundidad: las
--    funciones ya validan private.my_clinic_id()/auth.uid() por dentro.
-- 3) Las funciones de trigger no se llaman por RPC: se revoca TODO (los triggers las ejecutan
--    internamente como owner, no necesitan EXECUTE del rol llamador).
-- 4) El bucket público clinic-logos permitía LISTAR todos los archivos; el acceso por URL directa
--    a objetos de un bucket público no necesita policy de SELECT.
-- 5) Extensión `vector` en schema public: riesgo aceptado y documentado (moverla rompe los índices
--    HNSW existentes; revisar en una ventana de mantenimiento).
--
-- Nota: la protección de contraseñas filtradas (HaveIBeenPwned) se habilita en el dashboard de
-- Auth, no por SQL.
--
-- ORDEN: esta migración DEPENDE de 0021_profiles_update_guard (crea
-- enforce_profile_clinic_invariant), 0022_multi_clinic_memberships (crea switch_active_clinic) y
-- 0023/0024_clinic_logos_* (crea la policy que el punto 4 elimina). Por eso vive en 0026 y no
-- antes: los `revoke ... on function` de abajo fallan si esas funciones todavía no existen.

-- 1) corpus_chunks: cerrar PostgREST. RLS sin policies = default-deny para roles no privilegiados.
alter table if exists public.corpus_chunks enable row level security;
revoke all on table public.corpus_chunks from anon, authenticated;

-- 2) RPCs SECURITY DEFINER: solo authenticated (+ service_role).
do $$
declare
  fn text;
  fns text[] := array[
    'public.accept_invitation(invite_token text)',
    'public.create_appointment(p_title text, p_starts_at timestamptz, p_ends_at timestamptz, p_patient_id uuid, p_owner_id uuid, p_vet_id uuid, p_reason text, p_status public.appointment_status, p_notes text)',
    'public.create_clinic(clinic_name text)',
    'public.create_invitation(p_email text, p_role public.user_role)',
    'public.create_owner(p_full_name text, p_phone text, p_email text, p_document_id text, p_address text, p_notes text)',
    'public.create_patient(p_owner_id uuid, p_name text, p_species text, p_sex public.patient_sex, p_breed text, p_birth_date date, p_weight_kg numeric)',
    'public.delete_transcript(p_id uuid)',
    'public.ensure_calendar_feed()',
    'public.has_owner_consent(p_owner_id uuid)',
    'public.has_pending_invitation()',
    'public.mark_onboarded()',
    'public.mark_setup_completed()',
    'public.revoke_owner_consent(p_owner_id uuid)',
    'public.switch_active_clinic(target_clinic_id uuid)',
    'public.update_appointment(p_id uuid, p_title text, p_starts_at timestamptz, p_ends_at timestamptz, p_patient_id uuid, p_owner_id uuid, p_vet_id uuid, p_reason text, p_status public.appointment_status, p_notes text)'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

-- 3) Funciones de trigger: nadie las llama por RPC.
do $$
declare
  fn text;
  fns text[] := array[
    'public.enforce_profile_clinic_invariant()',
    'public.handle_new_user()',
    'public.handle_user_confirmed()'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
  end loop;
end $$;

-- Hacia adelante: las funciones nuevas no nacen ejecutables por anon/PUBLIC.
alter default privileges in schema public revoke execute on functions from public;

-- 4) clinic-logos: sin listado global (la URL pública de cada objeto sigue funcionando).
drop policy if exists clinic_logos_storage_select on storage.objects;
