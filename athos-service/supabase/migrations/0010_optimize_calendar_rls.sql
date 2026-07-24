-- ============================================================
-- 0010_optimize_calendar_rls.sql
-- Perf: evita re-evaluar auth.uid()/my_clinic_id() por fila en las policies de calendar_integrations
-- (advisor auth_rls_initplan). Se envuelven en (select ...) para que Postgres las evalúe una sola vez.
-- ============================================================

drop policy if exists "calendar_integrations_select" on public.calendar_integrations;
drop policy if exists "calendar_integrations_insert" on public.calendar_integrations;
drop policy if exists "calendar_integrations_update" on public.calendar_integrations;
drop policy if exists "calendar_integrations_delete" on public.calendar_integrations;

create policy "calendar_integrations_select" on public.calendar_integrations
  for select using (
    clinic_id = (select private.my_clinic_id()) and user_id = (select auth.uid())
  );
create policy "calendar_integrations_insert" on public.calendar_integrations
  for insert with check (
    clinic_id = (select private.my_clinic_id()) and user_id = (select auth.uid())
  );
create policy "calendar_integrations_update" on public.calendar_integrations
  for update using (
    clinic_id = (select private.my_clinic_id()) and user_id = (select auth.uid())
  );
create policy "calendar_integrations_delete" on public.calendar_integrations
  for delete using (
    clinic_id = (select private.my_clinic_id()) and user_id = (select auth.uid())
  );
