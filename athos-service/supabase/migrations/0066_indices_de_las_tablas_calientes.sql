-- Los índices que faltan en las tablas que se leen en cada pantalla.
--
-- QUÉ ROMPE HOY. `owners` tiene **sólo su clave primaria**: ningún índice por `clinic_id`. Y
-- `clinical_notes` tampoco. Son dos de las tablas más consultadas del producto, y las dos se filtran
-- SIEMPRE por clínica — tanto desde las pantallas como desde la RLS.
--
-- MEDIDO CON EXPLAIN el 2026-08-17, no deducido del linter:
--
--   explain analyze select id from clinical_notes where clinic_id = ... and status = 'draft';
--   -> Seq Scan on clinical_notes  (rows=5)
--        Rows Removed by Filter: 42
--
-- Escanea la tabla entera y descarta 42 de 42 para devolver 0. Hoy tarda 0,17 ms porque hay 42
-- filas. Esa consulta es la señal "notas sin aprobar", y corre **en cada carga del dashboard** y
-- **una vez por clínica en el briefing diario**. Con 50 clínicas × 500 notas son 25.000 filas
-- escaneadas cada vez, multiplicado por cada superficie que la pide.
--
-- `owners` es peor todavía: se consulta al listar titulares, al buscar por teléfono desde WhatsApp,
-- al crear una cita y en cada comprobación de RLS de las tablas que cuelgan de ella.
--
-- POR QUÉ NO APARECIÓ ANTES. Con 18 titulares y 42 notas, un seq scan es más rápido que un índice —
-- el planificador tiene razón hoy. El problema no se ve hasta que hay datos, y para entonces afecta
-- a todas las pantallas a la vez. Es exactamente la clase de deuda que hay que pagar ANTES de
-- escalar, no después.
--
-- ── LOS COMPUESTOS NO SON ADORNO ────────────────────────────────────────────────────────────────
--
-- Van `(clinic_id, algo)` y no `(clinic_id)` a secas porque las consultas reales filtran por clínica
-- Y ordenan o filtran por lo segundo. Un índice compuesto sirve para las dos cosas; uno simple
-- obliga a ordenar después. El de `patients` ya sigue este patrón (`patients_clinic_created_idx`),
-- así que esto lo extiende, no lo inventa.
--
-- NO SE TOCAN los 47 índices que el linter marca como "sin usar": con 15 clínicas de prueba, "sin
-- usar" significa "todavía no", no "sobra". Borrarlos ahora sería tomar una decisión de escala con
-- datos de juguete.

-- ---------------------------------------------------------------------------
-- 1. Las dos que no tienen NADA por clínica
-- ---------------------------------------------------------------------------

-- Titulares de una clínica, alfabético: es como los pide la pantalla de titulares.
create index if not exists owners_clinic_nombre_idx
  on public.owners (clinic_id, full_name);

-- Notas por clínica y estado: es la señal "notas sin aprobar", la consulta del EXPLAIN de arriba.
-- `status` va adentro para que el filtro se resuelva en el índice y no visitando la tabla.
create index if not exists clinical_notes_clinic_status_idx
  on public.clinical_notes (clinic_id, status);

-- ---------------------------------------------------------------------------
-- 2. Llaves foráneas sin índice en las tablas que crecen por evento
-- ---------------------------------------------------------------------------

-- Sin índice en una FK, borrar la fila PADRE obliga a escanear la hija entera para comprobar la
-- referencia. Con `whatsapp_messages` creciendo a cientos de filas por día y por clínica, borrar un
-- titular pasaría a escanear todos los mensajes de todas las clínicas.
create index if not exists whatsapp_messages_owner_idx
  on public.whatsapp_messages (owner_id);

-- La consulta de un titular: la usa la ficha del titular y el contexto que Athos arma.
create index if not exists consultations_owner_idx
  on public.consultations (owner_id);

-- "Qué atendió este veterinario", que es como se arma la agenda de una persona.
create index if not exists consultations_vet_idx
  on public.consultations (vet_id);

-- Quién aprobó cada nota: es la pregunta de auditoría clínica, y hoy es un escaneo.
create index if not exists clinical_notes_approved_by_idx
  on public.clinical_notes (approved_by);
