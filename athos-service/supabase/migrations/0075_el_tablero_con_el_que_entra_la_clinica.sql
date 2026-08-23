-- 0075: el administrador define el tablero con el que entra la clínica.
--
-- LO QUE SE PIDIÓ, y las dos frases son de Luciano en la MISMA llamada del 21-ago:
--
--   29:03  Felipe:  "¿qué tal si el administrador es el único que lo puede modificar?"
--          Luciano: "exactamente, exactamente"
--   44:44  Luciano: "mi cuenta y mi dashboard es mío, mi agenda es mía"
--
-- Se contradicen, y las dos tienen razón sobre algo distinto: el admin quiere poder poner algo
-- delante de todos, y cada quien quiere su vista. Elegir una sola habría dejado la otra sin
-- resolver.
--
-- ── LA FORMA QUE SATISFACE A LAS DOS ────────────────────────────────────────────────────────────
--
-- El tablero SIGUE SIENDO POR PERSONA (0072, que no se toca). Esto agrega el punto de partida: el
-- admin guarda una disposición para la clínica, y quien todavía no armó el suyo entra con ésa. En
-- cuanto alguien acomoda el propio, el suyo manda.
--
-- NO ES UNA IMPOSICIÓN Y NO SE MEZCLA. Si la persona tiene su fila, el default de la clínica no le
-- toca nada — mezclarlos haría que un bloque se moviera solo un día cualquiera, y eso se lee como
-- un error, no como una novedad.
--
-- ── UNA FILA POR CLÍNICA, Y TODOS LA LEEN ───────────────────────────────────────────────────────
--
-- La asimetría de la RLS es el punto entero: TODOS los de la clínica pueden LEERLA —si no, no
-- podría ser el punto de partida de nadie— y sólo un `admin` puede ESCRIBIRLA. Con la escritura
-- abierta, cualquiera cambiaría el tablero de entrada de sus compañeros.

create table if not exists public.tablero_default_clinica (
  clinic_id  uuid primary key references public.clinics(id) on delete cascade,
  -- Mismo formato que `tablero_preferencias.widgets`: `[{ "id": "metricas", "visible": true }, …]`
  -- en el orden en que se pintan. Compartir el formato es lo que permite que la misma función pura
  -- reconcilie los dos, y que guardar "lo que estoy viendo" como default sea copiar el arreglo.
  widgets    jsonb not null default '[]'::jsonb,
  -- Quién lo dejó así. `set null` y no `cascade`: si ese admin se va de la clínica, el tablero de
  -- entrada NO se borra — el equipo seguiría entrando con él, y borrarlo cambiaría la pantalla de
  -- todos por un motivo que nadie relacionaría con una baja de personal.
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.tablero_default_clinica enable row level security;

-- LEER: cualquiera de la clínica. Es el punto de partida de todos.
create policy "tablero_default_select" on public.tablero_default_clinica
  for select using (clinic_id = (select private.my_clinic_id()));

-- ESCRIBIR: sólo un admin. Las tres por separado y no un `for all`, para que se lea en el catálogo
-- qué puede hacer quién sin abrir la definición.
create policy "tablero_default_insert" on public.tablero_default_clinica
  for insert with check (
    clinic_id = (select private.my_clinic_id())
    and (select private.my_role()) = 'admin'::public.user_role
  );

create policy "tablero_default_update" on public.tablero_default_clinica
  for update using (
    clinic_id = (select private.my_clinic_id())
    and (select private.my_role()) = 'admin'::public.user_role
  ) with check (
    clinic_id = (select private.my_clinic_id())
    and (select private.my_role()) = 'admin'::public.user_role
  );

create policy "tablero_default_delete" on public.tablero_default_clinica
  for delete using (
    clinic_id = (select private.my_clinic_id())
    and (select private.my_role()) = 'admin'::public.user_role
  );

comment on table public.tablero_default_clinica is
  'El tablero con el que entra quien todavía no armó el suyo. Lo define un admin; lo lee toda la clínica. La preferencia personal (tablero_preferencias) le gana siempre.';
