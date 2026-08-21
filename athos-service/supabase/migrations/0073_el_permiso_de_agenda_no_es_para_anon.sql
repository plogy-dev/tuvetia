-- 0073: `otorgar_agenda_completa` deja de estar concedida a `anon`.
--
-- Encontrado auditando el principal el 21-ago, con el linter de Supabase. De las 20 funciones
-- `SECURITY DEFINER` expuestas por PostgREST, ésta es **la única** ejecutable por `anon`:
--
--   otorgar_agenda_completa  ->  postgres | anon | authenticated | service_role
--   create_appointment       ->  postgres |      | authenticated | service_role
--   remove_clinic_member     ->  postgres |      | authenticated | service_role
--   switch_active_clinic     ->  postgres |      | authenticated | service_role
--
-- ── QUÉ PASÓ ────────────────────────────────────────────────────────────────────────────────────
--
-- No es que alguien la concediera: es que nadie la revocó. Postgres le da `EXECUTE` a `PUBLIC` al
-- crear una función, y en Supabase `anon` hereda de `PUBLIC`. La 0070 hizo
--
--     grant execute on function public.otorgar_agenda_completa(uuid, boolean) to authenticated;
--
-- que es correcto pero no alcanza: sumar a `authenticated` no le quita nada a `PUBLIC`. La 0065 sí
-- trae el `revoke ... from anon` que hace falta; la 0070 se lo saltó.
--
-- ── QUÉ TAN GRAVE ES: NO ES UNA PUERTA ABIERTA, ES UNA PUERTA SIN LLAVE ─────────────────────────
--
-- Conviene decirlo con precisión en vez de exagerarlo. **Hoy no es explotable.** El cuerpo se
-- defiende solo: lo primero que hace es `private.my_clinic_id()`, que es
--
--     select clinic_id from public.profiles where id = auth.uid() and is_active
--
-- Sin sesión `auth.uid()` es null, no hay fila, y la función corta con «No hay clínica activa.»
-- antes de tocar nada. Después vuelve a cortar si el rol no es `admin`.
--
-- Se arregla igual, y por dos razones concretas:
--
--   1. LA DEFENSA ESTÁ EN EL CUERPO, NO EN EL PERMISO. Alcanza con que alguien mueva el chequeo de
--      rol, agregue un camino temprano o refactorice `my_clinic_id` para que la puerta que hoy está
--      sin llave quede abierta. El permiso es la capa que no depende de que el cuerpo siga siendo
--      correcto — y esta función escribe un permiso, que es lo último que conviene dejar en una
--      sola capa.
--   2. ES LA EXCEPCIÓN DE LA CASA. Sus veinte pares no tienen `anon`. Una excepción sin motivo es
--      ruido permanente en el linter, y el ruido es lo que hace que el hallazgo de verdad, el día
--      que aparezca, no se vea.
--
-- No se toca el cuerpo de la función ni la RLS: sólo el permiso.

revoke execute on function public.otorgar_agenda_completa(uuid, boolean) from public;
revoke execute on function public.otorgar_agenda_completa(uuid, boolean) from anon;

-- Se reafirma lo que la 0070 sí quería, para que la migración quede completa por sí sola: un
-- `revoke ... from public` también le saca el privilegio heredado a quien lo tenía sólo por ahí.
grant execute on function public.otorgar_agenda_completa(uuid, boolean) to authenticated;
grant execute on function public.otorgar_agenda_completa(uuid, boolean) to service_role;
