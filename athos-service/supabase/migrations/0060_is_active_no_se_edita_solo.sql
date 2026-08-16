-- El gate de la 0059 era esquivable en UNA llamada HTTP.
--
-- CÓMO SE ENCONTRÓ. Auditoría del 15-ago, corriendo los advisors del principal justo después de
-- aplicar la 0059. El lint 0029 señaló las funciones `SECURITY DEFINER` alcanzables por
-- `authenticated`, y al revisar si el gate las cubría apareció el problema real, que no estaba en
-- las funciones sino en la tabla.
--
-- EL DEFECTO. Tres hechos que por separado se ven inofensivos:
--
--   1. `profiles_update` es `for update using (id = auth.uid())` y **sin `with_check`**: cualquiera
--      puede hacer UPDATE sobre su propia fila, con las columnas que quiera.
--   2. `profiles_guard_sensitive_columns` protege `clinic_id` y `role` — y nada más.
--   3. Desde la 0059, `is_active` decide si ves los datos de tu clínica.
--
-- Juntos: un veterinario al que le desactivaron la cuenta la reactiva con
--
--     PATCH /rest/v1/profiles?id=eq.<su-id>     {"is_active": true}
--
-- El gate entero —y con él la desactivación manual y la automática que el acta pide— valía una
-- llamada de curl. La 0059 no introdujo el agujero (la columna y la policy existían desde antes),
-- pero fue la que le dio VALOR a escribir esa columna: hasta ayer reactivarse no servía de nada
-- porque `is_active` no hacía nada.
--
-- EL ARREGLO. `is_active` entra a la misma guarda que ya cubre a `clinic_id` y `role`. Es el lugar
-- correcto: la guarda es un trigger, así que aplica a TODA escritura —REST, SQL, un cliente que
-- todavía no existe— y no depende de que cada ruta se acuerde de validar.
--
-- POR QUÉ SE DEJA PASAR A `service_role` Y NO SÓLO A `postgres`. La guarda original compara contra
-- `postgres` porque los RPC de plataforma son `SECURITY DEFINER` y corren con ese `current_user`.
-- Pero la desactivación va a vivir en `/admin`, que escribe con `service_role`. Con la comparación
-- original el panel no podría desactivar a nadie.
--
-- Y no debilita nada: `service_role` ya se salta la RLS por completo y sólo es alcanzable desde
-- nuestro servidor con la clave secreta. Lo que esta guarda tiene que impedir es que la SESIÓN DEL
-- USUARIO se auto-promueva, y eso lo sigue impidiendo igual.

create or replace function public.profiles_guard_sensitive_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user not in ('postgres', 'service_role')
     and (new.clinic_id is distinct from old.clinic_id
          or new.role is distinct from old.role
          -- `is_active` entra acá el 15-ago: sin esto, el gate de cuenta desactivada de la 0059 se
          -- esquiva con un PATCH del propio usuario sobre su fila.
          or new.is_active is distinct from old.is_active)
  then
    raise exception
      'clinic_id, role e is_active no se editan desde la sesión del usuario: van por las rutas de plataforma';
  end if;
  return new;
end;
$function$;
