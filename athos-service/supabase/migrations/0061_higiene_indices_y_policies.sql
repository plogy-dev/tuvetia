-- Higiene medida con los advisors del principal (2026-08-16). Dos cosas sin relación entre sí, en
-- una sola migración porque las dos son de mantenimiento y ninguna cambia comportamiento visible.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. CINCO ÍNDICES DUPLICADOS
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- El advisor reportaba cuatro; consultando `pg_index` aparecieron CINCO. El que faltaba es el de
-- `invitations`, y es el más fácil de pasar por alto porque su gemelo no es otro índice suelto sino
-- el que Postgres crea solo para una constraint UNIQUE.
--
-- NO SON RENOMBRADOS, que es lo que parecía. Cada par tiene un origen concreto:
--
--   · clinical_notes, consultations, transcripts → el índice existía en el ESQUEMA BASE
--     (`bootstrap/000_base_schema.sql`, con el prefijo `idx_`) y nuestra migración
--     `0014_hot_path_indexes.sql` lo volvió a crear con el sufijo `_idx`. Se va el nuestro: el del
--     base schema se recrea solo si alguien levanta un proyecto de dev nuevo, así que borrar ése
--     dejaría los dos entornos distintos.
--
--   · memberships → `idx_memberships_user` es nuestro (migración 0022). `memberships_user_idx`
--     **no está en el repo**: se creó directo contra el principal. Se va el que nadie puede
--     reproducir desde el código.
--
--   · invitations → `invitations.token` ya es `unique` (línea 66 del base schema), y Postgres crea
--     `invitations_token_key` para sostener esa constraint. La línea 674 del MISMO archivo agrega
--     además `idx_invitations_token`, que no aporta nada. Se va el suelto — el de la constraint no
--     se puede borrar sin borrar la constraint.
--
-- Cada índice de más se mantiene en CADA insert, update y delete de su tabla. Son 16 kB hoy, así
-- que esto no es por espacio: es por el trabajo de escritura que nadie está pidiendo.

drop index if exists public.clinical_notes_consultation_idx;  -- dup de idx_clinical_notes_cons
drop index if exists public.consultations_patient_idx;        -- dup de idx_consultations_patient
drop index if exists public.transcripts_consultation_idx;     -- dup de idx_transcripts_cons
drop index if exists public.memberships_user_idx;             -- dup de idx_memberships_user
drop index if exists public.idx_invitations_token;            -- dup de invitations_token_key

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. `auth.uid()` REEVALUADO FILA POR FILA
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- `auth.uid()` es STABLE, no IMMUTABLE, así que dentro de una policy Postgres la trata como algo
-- que puede cambiar por fila y la llama una vez POR FILA EVALUADA. Envuelta en un subselect ―
-- `(select auth.uid())` ― pasa a ser un InitPlan: se calcula UNA vez por consulta y el resultado se
-- reusa. Es la recomendación del linter `auth_rls_initplan` de Supabase.
--
-- Con 17 perfiles no se nota. En `memberships` y `profiles` leídas dentro de un JOIN sobre miles de
-- filas, sí.
--
-- `profiles_select` LA ESCRIBÍ YO en la migración 0059 y la escribí mal — sale acá con el resto.
-- Las otras dos ya venían así.
--
-- NO CAMBIA A QUIÉN DEJA PASAR: `(select auth.uid())` devuelve exactamente lo mismo que
-- `auth.uid()`. Es la misma condición, evaluada una vez en vez de N.

alter policy "profiles_select" on public.profiles
  using ((id = (select auth.uid())) or (clinic_id = private.my_clinic_id()));

-- Sigue SIN `with_check` explícito, igual que antes: para un UPDATE, Postgres reusa el `using` como
-- `with_check` cuando no se declara. Lo que impide que alguien se auto-promueva no es esta policy
-- sino el trigger `profiles_guard_sensitive_columns` (migraciones 0057 y 0060), que sigue intacto.
alter policy "profiles_update" on public.profiles
  using (id = (select auth.uid()));

alter policy "memberships_select_own" on public.memberships
  using (user_id = (select auth.uid()));
