-- 0097: la tabla de respaldo también con RLS.
--
-- ── QUÉ SE ENCONTRÓ ─────────────────────────────────────────────────────────────────────────────
--
-- Auditoría del 27-ago, hallazgo 3. `public.appointments_importadas_respaldo` guarda 19.649 filas
-- REALES de dos clínicas, con las columnas completas de una cita: paciente, titular, veterinario,
-- motivo, notas, horarios. Es el respaldo de una importación.
--
-- Medido contra el principal:
--   · RLS: DESACTIVADA. Cero policies.
--   · `has_table_privilege('anon', ...)`          → false
--   · `has_table_privilege('authenticated', ...)` → false
--
-- O SEA QUE HOY NO ESTÁ EXPUESTA, y esto no arregla ninguna filtración. Lo que arregla es una
-- ASIMETRÍA: todas las demás tablas de clínica tienen DOS defensas —el grant y la RLS— y ésta tiene
-- una sola. Un `grant select on all tables in schema public to authenticated`, que es la clase de
-- comando que alguien corre para desatascar algo un viernes, la convierte en una fuga entre
-- clínicas al instante y sin que nada más falle. Con RLS activa, ese mismo comando no alcanza.
--
-- ── SIN POLICY, Y ES A PROPÓSITO ────────────────────────────────────────────────────────────────
--
-- RLS activa y cero policies = nadie puede leerla salvo `service_role`, que se salta la RLS por
-- definición. Eso es EXACTAMENTE el estado efectivo de hoy, así que no cambia el comportamiento de
-- ninguna pantalla: ninguna la consulta.
--
-- Una policy por `clinic_id` la dejaría legible por los miembros de esa clínica, y eso sería
-- ampliar el acceso, no asegurarlo. Es un respaldo de migración, no un dato de producto: si algún
-- día una pantalla tiene que mostrarlo, ese día se escribe la policy con el caso de uso a la vista.
--
-- Es el mismo trato que ya tienen `suscripcion_eventos` y `athos_agent_usage`, que aparecen en el
-- advisor de Supabase como «RLS enabled, no policy» y están bien así.

alter table public.appointments_importadas_respaldo enable row level security;

comment on table public.appointments_importadas_respaldo is
  'Respaldo de la importación de citas. RLS activa SIN policies a propósito: sólo service_role la '
  'lee, que es el estado que ya tenía de hecho. No la consulta ninguna pantalla.';

-- ── LA CLAVE FORÁNEA QUE LE FALTABA ─────────────────────────────────────────────────────────────
--
-- Era la ÚNICA tabla con `clinic_id` sin FK a `clinics`. Dos consecuencias que se pagaban juntas:
-- no aparecía en ningún recuento por clínica, y no se iba al dar de baja a un cliente — quedaban
-- 19.649 citas de una clínica que ya no existe.
--
-- Se puede agregar sin riesgo: verificado contra el principal el 27-ago, CERO filas apuntan a una
-- clínica inexistente. `on delete cascade` para que el respaldo siga la suerte de lo que respalda.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'appointments_importadas_respaldo_clinic_id_fkey'
  ) then
    alter table public.appointments_importadas_respaldo
      add constraint appointments_importadas_respaldo_clinic_id_fkey
      foreign key (clinic_id) references public.clinics(id) on delete cascade;
  end if;
end
$$;

-- El índice que la FK necesita. Sin él, borrar una clínica obliga a recorrer las 19.649 filas para
-- comprobar la restricción — es justo el caso de las 73 claves foráneas sin índice que reportó el
-- advisor, y acá se paga en el borrado.
create index if not exists appointments_importadas_respaldo_clinic_idx
  on public.appointments_importadas_respaldo (clinic_id);
