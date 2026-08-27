-- 0099: los índices que faltan donde duele.
--
-- Auditoría del 27-ago, hallazgo 4. El advisor de rendimiento reporta 73 CLAVES FORÁNEAS SIN
-- ÍNDICE. Acá entran CUATRO.
--
-- ── POR QUÉ NO ENTRAN LOS 73 ────────────────────────────────────────────────────────────────────
--
-- Un índice no es gratis: se paga en CADA insert, cada update de sus columnas y cada delete de la
-- tabla, más el espacio y el vacuum. Setenta y tres índices son setenta y tres impuestos cobrados
-- sobre todas las escrituras del producto, para acelerar consultas que —la mayoría— nadie hizo
-- nunca.
--
-- Y el advisor no sabe qué consulta hace la aplicación. Marca la FORMA (una FK sin índice) y no el
-- USO. Muchas de esas 73 son columnas `created_by` de tablas de facturación que ninguna pantalla
-- filtra: el índice sólo serviría el día que alguien borre un usuario, y para eso ya hay
-- migraciones (la 0045) que cubrieron las que importaban.
--
-- CUÁLES DE LAS OTRAS DUELEN SE DECIDE MIDIENDO, NO ADIVINANDO. Con 81 pacientes, 39 citas y 2
-- vacunas, el planificador tiene razón cuando elige un seq scan, y `pg_stat_user_indexes` no
-- distingue "no se usa" de "todavía no". La herramienta correcta es `pg_stat_statements` con
-- volumen real: la consulta que aparezca arriba por tiempo total pide su índice, y se le da ESE.
-- Ese es el criterio que aplicó la 0066 y el que se aplica acá.
--
-- ── LA REGLA QUE SE SIGUIÓ ──────────────────────────────────────────────────────────────────────
--
-- Cada índice de abajo nombra el archivo y la línea de la consulta concreta que lo necesita. El que
-- no pudo nombrarla, no está.
--
-- ── DOS HIPÓTESIS QUE SE CAYERON AL VERIFICARLAS ────────────────────────────────────────────────
--
-- · `src/lib/citas/barrido.ts:88-100` (recordatorios de cita) parecía descubierto y NO lo está:
--   `appointments_recordatorio_pendiente_idx` es `(clinic_id, starts_at) where recordatorio_enviado_en
--   is null` (0085) y calza exacto con ese filtro. Tampoco falta nada en `calendario`: la ventana
--   `starts_at <= fin` de `src/app/dashboard/calendario/page.tsx:68-73` la sirve
--   `idx_appointments_starts (clinic_id, starts_at)`. Sobre `appointments` no se agrega NADA.
--
-- · `consultations (clinic_id, status)` para "consultas en revisión"
--   (`src/app/dashboard/patients/page.tsx:76` y `src/app/api/tablero/detalle/route.ts:180`) se
--   consideró y se DESCARTÓ. Existe `consultations_clinic_started_idx (clinic_id, started_at desc)`:
--   la consulta ya se resuelve recorriendo sólo las filas de la clínica, no la tabla entera, así que
--   el índice nuevo compraría poco. Y `status` se ACTUALIZA en cada transición de la consulta
--   (draft → review → closed), o sea que ese índice se reescribiría tres veces por consulta. La
--   cuenta no da hoy; si `pg_stat_statements` dice otra cosa con volumen, se agrega entonces.
--
-- ── PREFIJO, NO CONJUNTO: POR ESO ALGUNOS COMPUESTOS YA ALCANZAN ────────────────────────────────
--
-- Un btree sobre `(a, b)` sirve para filtrar por `a` solo, porque `a` es la PRIMERA columna y el
-- árbol está ordenado por ella. Sobre `(b, a)` NO sirve. Media revisión de arriba es exactamente
-- esa distinción: `idx_appointments_starts` empieza por `clinic_id`, por eso cubre el calendario.
--
-- ── SIN `concurrently`, COMO EL RESTO DEL REPO ──────────────────────────────────────────────────
--
-- Ninguna de las 98 migraciones anteriores usa `create index concurrently`, y ésta tampoco: el
-- runner de migraciones envuelve cada archivo en una transacción y `concurrently` no puede correr
-- dentro de una. Usarlo obligaría a partir el archivo y a romper la atomicidad de la migración.
--
-- El costo de no usarlo es que `create index` toma un lock que bloquea las ESCRITURAS de la tabla
-- mientras construye. Con los volúmenes de hoy —2 filas en `vaccines`, 44 en `consents`, 81 en
-- `patients`, 0 en `comm_messages`— eso son milisegundos. El día que una de estas tablas tenga
-- millones de filas, un índice nuevo sí habrá que crearlo `concurrently` y fuera del runner.

-- ---------------------------------------------------------------------------
-- 1. `vaccines` por clínica: la única verificada como problema real
-- ---------------------------------------------------------------------------

-- `vaccines` tenía DOS índices y ninguno por clínica: `vaccines_pkey (id)` y
-- `vaccines_patient_idx (patient_id)` (0020). Sirven para abrir la ficha de un paciente, que es
-- para lo que se pensaron, y no sirven para nada que filtre por clínica.
--
-- MEDIDO CONTRA EL PRINCIPAL el 2026-08-27:
--
--   explain analyze select patient_id, vaccine_name, next_dose_at from vaccines
--     where clinic_id = ... and next_dose_at is not null and next_dose_at >= '2025-08-27';
--   -> Seq Scan on vaccines  (actual rows=2)
--        Filter: ((next_dose_at IS NOT NULL) AND (next_dose_at >= ...) AND (clinic_id = ...))
--
-- No hay línea `Rows Removed by Filter` y eso NO es una buena noticia: significa que el recorrido
-- leyó la tabla entera y no descartó nada, porque hoy las únicas dos vacunas que existen son de la
-- misma clínica. Ese es exactamente el escenario que empeora — la segunda clínica que cargue
-- vacunas empieza a pagar el recorrido de las ajenas, y no hay por dónde entrar salvo leyendo
-- todo. Tarda 0,11 ms con dos filas; el plan es un recorrido secuencial garantizado y crece lineal
-- con las vacunas de TODAS las clínicas juntas.
--
-- DOS consultas lo piden, y las dos están en camino caliente:
--
--   · `src/lib/avisos/audiencia.ts:155-161` — el segmento «vacuna vencida». Filtra
--     `clinic_id` + `next_dose_at >= hace un año`, con `limit 5000`. Se trae a propósito TODAS las
--     próximas dosis del último año (vencidas y por venir) porque para saber si una vencida quedó
--     relevada hay que ver también la que la relevó. O sea: es la consulta que MÁS filas pide de
--     esta tabla, y hoy las busca escaneándola entera.
--
--   · `src/app/dashboard/tablero/page.tsx:224-227` — la pastilla «vacunas por vencer». Filtra
--     `next_dose_at <= hoy+30` (el `clinic_id` lo pone la RLS) y corre EN CADA CARGA DEL TABLERO,
--     que es la pantalla de entrada del producto. Ésta pesa más que la del segmento: el aviso se
--     manda a mano y de vez en cuando, el tablero se abre todo el día.
--
-- `(clinic_id, next_dose_at)` y no `(next_dose_at, clinic_id)`: las dos consultas fijan la clínica
-- con una igualdad y recorren un RANGO de fechas. La columna de igualdad va primero — así el rango
-- se resuelve leyendo un tramo contiguo del índice. Al revés habría que recorrer todas las fechas
-- de todas las clínicas filtrando por la de uno.
create index if not exists vaccines_clinic_proxima_dosis_idx
  on public.vaccines (clinic_id, next_dose_at);

-- ---------------------------------------------------------------------------
-- 2. `comm_messages` ENTRANTE: el hueco que dejó su gemelo parcial
-- ---------------------------------------------------------------------------

-- `src/lib/cartera/scheduler.ts:272-281` pregunta si el deudor RESPONDIÓ esta semana: filtra
-- `owner_id` + `direction = 'ENTRANTE'` + `created_at >= hace 7 días`, ordena descendente y toma 1.
-- Es la regla §5 de la Ley 2300 —tras una respuesta directa no se cambia de canal en la misma
-- semana—, así que no es una consulta opcional: decide si el recordatorio sale y por dónde.
--
-- POR QUÉ NO LA CUBRE EL ÍNDICE QUE PARECE CUBRIRLA. `comm_messages_owner_day_idx` (0034) es
-- `(owner_id, sent_at) WHERE direction = 'SALIENTE'`. Es PARCIAL, y su predicado excluye
-- justamente las filas que esta consulta busca: un índice parcial sólo se puede usar cuando el
-- planificador demuestra que la consulta cae dentro de su predicado, y `ENTRANTE` cae fuera. El
-- índice existe, se llama casi igual, y para esta consulta es como si no estuviera.
--
-- Y ESTO CORRE EN UN BUCLE. El barrido de cartera procesa hasta 200 recordatorios pendientes por
-- clínica (`scheduler.ts:203-209`) y hace esta pregunta UNA VEZ POR CADA UNO. Un seq scan sobre
-- una tabla que crece con cada mensaje de cada clínica, multiplicado por 200 y por clínica, en un
-- cron que ya tiene que terminar dentro del límite de Vercel.
--
-- Se copia la forma del gemelo —parcial por `direction`, sin `clinic_id`— a propósito y no por
-- pereza: `owner_id` es una FK a un titular que pertenece a UNA clínica, así que el `clinic_id`
-- de la consulta ya queda resuelto al llegar a la fila. Meterlo en el índice engordaría cada
-- entrada sin descartar ni una.
--
-- `created_at desc` porque la consulta pide `order by created_at desc limit 1`: con ese orden en el
-- índice, la respuesta es la primera entrada del tramo y no hay que ordenar nada.
create index if not exists comm_messages_owner_entrante_idx
  on public.comm_messages (owner_id, created_at desc)
  where direction = 'ENTRANTE';

-- ---------------------------------------------------------------------------
-- 3. `consents`: la tabla que sólo tenía su clave primaria
-- ---------------------------------------------------------------------------

-- `src/app/dashboard/owners/page.tsx:52-56` marca qué titulares tienen consentimiento de grabación
-- vigente: filtra `owner_scope = true` + `revoked_at is null` (el `clinic_id` lo pone la RLS) y NO
-- lleva `limit`. Corre en cada carga del listado de titulares.
--
-- MEDIDO CONTRA EL PRINCIPAL el 2026-08-27:
--
--   explain analyze select owner_scope, revoked_at, patient_id from consents
--     where clinic_id = ... and owner_scope = true and revoked_at is null;
--   -> Seq Scan on consents  (actual rows=2)
--        Filter: (owner_scope AND (revoked_at IS NULL) AND (clinic_id = ...))
--        Rows Removed by Filter: 42
--
-- Lee las 44 filas de la tabla para devolver 2 (se midió contra la clínica más cargada, la que
-- tiene 14 consentimientos). De paso, el `Filter` de arriba dice `owner_scope` a secas y no
-- `owner_scope = true`: el planificador normaliza la igualdad booleana, y por eso el predicado
-- parcial de abajo —escrito `where owner_scope and ...`— sí matchea la consulta que hace la app.
--
-- `consents` es como estaba `owners` antes de la 0066: SÓLO `consents_pkey (id)`. Ningún índice por
-- clínica, ninguno por paciente, ninguno por consulta.
--
-- PARCIAL, Y ACÁ EL PARCIAL SE GANA SOLO. De 44 filas, 14 son consentimientos vigentes: el resto
-- son revocados o de alcance por-consulta, y esta consulta nunca los mira. Un índice parcial guarda
-- únicamente las filas que se buscan —hoy menos de un tercio de la tabla, y la proporción empeora
-- con el tiempo porque los revocados se acumulan y los vigentes no—. Además un consentimiento se
-- escribe una vez y se revoca como mucho una vez: el impuesto de escritura acá es de los más
-- baratos del esquema.
--
-- Los otros índices que `consents` no tiene (por `patient_id`, por `consultation_id`) NO se agregan:
-- no encontré la consulta que los pida. Cuando aparezca, se agregan con su cita, como éste.
create index if not exists consents_clinic_vigente_idx
  on public.consents (clinic_id)
  where owner_scope and revoked_at is null;

-- ---------------------------------------------------------------------------
-- 4. `patients` alfabético: la simetría que le faltaba a `owners`
-- ---------------------------------------------------------------------------

-- La 0066 le dio a `owners` el índice `(clinic_id, full_name)` con este argumento: "Titulares de
-- una clínica, alfabético: es como los pide la pantalla de titulares". `patients` se pide igual y
-- se quedó sin él.
--
--   · `src/app/dashboard/calendario/page.tsx:76` — `order by name limit 1000`, sin más filtro que
--     la RLS. Es el selector de paciente del calendario, y se carga con la pantalla.
--   · `src/app/dashboard/asistente/page.tsx:116-120` — `clinic_id` + `order by name limit 500`,
--     el contexto que arma el buscador del Copiloto.
--
-- POR QUÉ EL `limit` NO SALVA NADA. Con `order by name`, la base no puede parar a las 1000 filas
-- hasta haber ORDENADO todas las de la clínica: para saber cuáles son las mil primeras
-- alfabéticamente hay que mirarlas todas. Los índices que hay —`idx_patients_clinic (clinic_id)` y
-- `patients_clinic_created_idx (clinic_id, created_at desc)`— traen las filas pero ninguno las trae
-- EN ORDEN DE NOMBRE, así que el sort es un paso aparte sobre el padrón entero, dos veces por
-- pantalla. Con el índice, las mil primeras se leen del tramo inicial y se corta ahí.
--
-- `patients` es de las tablas que MENOS se escriben del esquema —un paciente se da de alta una vez
-- y casi no se edita—, así que el impuesto es mínimo justo donde el ahorro de lectura es diario.
--
-- NOTA PARA LA PRÓXIMA LIMPIEZA: este índice deja a `idx_patients_clinic (clinic_id)` estrictamente
-- redundante —`(clinic_id, name)` lo cubre entero por la regla del prefijo de arriba—. No se borra
-- acá: la 0066 fijó la política de no tocar índices existentes sin medir, y borrar uno es una
-- operación con lock que no tiene por qué viajar en la misma migración que lo agrega. Queda
-- anotado como el candidato limpio a eliminar cuando se revise la lista con volumen real.
create index if not exists patients_clinic_nombre_idx
  on public.patients (clinic_id, name);

comment on index public.vaccines_clinic_proxima_dosis_idx is
  'Vacunas por vencer de una clínica. Lo piden avisos/audiencia.ts (segmento «vacuna vencida») y la pastilla del tablero. Antes de esto, vaccines no tenía NINGÚN índice por clínica.';
comment on index public.comm_messages_owner_entrante_idx is
  'Si el deudor respondió esta semana (Ley 2300 §5), en cartera/scheduler.ts. El gemelo comm_messages_owner_day_idx es parcial WHERE direction = SALIENTE y por eso no sirve para las entrantes.';
comment on index public.consents_clinic_vigente_idx is
  'Consentimientos de grabación vigentes de una clínica, para el listado de titulares. Parcial porque los revocados se acumulan y esa consulta nunca los mira.';
comment on index public.patients_clinic_nombre_idx is
  'Pacientes de una clínica en orden alfabético: el selector del calendario y el contexto del Copiloto. Es el gemelo de owners_clinic_nombre_idx (0066), que faltaba.';
