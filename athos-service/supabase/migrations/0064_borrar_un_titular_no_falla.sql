-- Borrar un titular deja de poder fallar con un error de llave foránea.
--
-- QUÉ ARREGLA. `consultations.owner_id` apuntaba a `owners` **sin acción de borrado**, o sea NO
-- ACTION. El caso lo encontró la auditoría del 2026-08-16 mirando la limpieza de los datos de
-- ejemplo, que borra al titular demo y confía en que los FK en cascada se lleven paciente, consulta,
-- transcript y nota.
--
-- HOY FUNCIONA POR CASUALIDAD, y conviene entender por qué antes de tocarlo. PostgreSQL comprueba
-- NO ACTION al FINAL de la sentencia (a diferencia de RESTRICT, que es inmediato), así que la cadena
-- `owners → patients → consultations` alcanza a borrar la consulta por la vía del PACIENTE antes de
-- que el chequeo corra, y no hay violación. Es correcto, pero depende de un detalle de orden interno
-- del motor y de que el paciente de la consulta sea siempre del mismo titular.
--
-- DÓNDE SE ROMPE. En una consulta cuyo `owner_id` sea el titular que se borra pero cuyo `patient_id`
-- pertenezca a OTRO titular. Ahí nada la arrastra por la vía del paciente, el chequeo encuentra la
-- referencia viva y el DELETE falla entero. Medido contra el principal: **0 filas en ese estado
-- hoy** — nada lo impide, simplemente no ha pasado.
--
-- POR QUÉ SET NULL Y NO CASCADE. Cascade borraría esa consulta, y una consulta es historia clínica
-- de un paciente que NO es el del titular borrado: se llevaría por delante el registro de otra
-- persona para resolver un problema que no es suyo. SET NULL la conserva y sólo suelta la referencia
-- al titular. La columna ya es nullable, así que no hace falta tocar el esquema para permitirlo.
--
-- En el caso normal esto no cambia NADA: la consulta se sigue borrando por la cascada del paciente,
-- igual que hoy. Sólo cambia el caso anómalo, que pasa de "falla el borrado entero" a "la consulta
-- sobrevive sin titular".

alter table public.consultations
  drop constraint consultations_owner_id_fkey;

alter table public.consultations
  add constraint consultations_owner_id_fkey
  foreign key (owner_id) references public.owners(id) on delete set null;
