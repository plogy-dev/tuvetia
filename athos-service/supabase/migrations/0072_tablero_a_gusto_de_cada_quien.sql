-- 0072: cada persona arma su tablero.
--
-- LO QUE SE PIDIÓ, y se repitió tres veces: *"dashboard modular"* (18-ago), *"el dashboard primero
-- y que sea la vista predeterminada"* (Luciano, 19-ago) y *"los clientes quieren que sea
-- prácticamente personalizable"*.
--
-- POR QUÉ ES POR PERSONA Y NO POR CLÍNICA. El tablero es lo primero que se ve al entrar, y lo
-- primero que necesita saber cada uno es distinto: el que factura quiere la plata del mes, el que
-- atiende quiere sus citas y sus notas sin aprobar. Un tablero por clínica obligaría a que los dos
-- miren el del otro — que es exactamente la queja original ("no me gusta cómo está organizada").
--
-- PERO TAMBIÉN POR CLÍNICA, en la clave. Un veterinario puede pertenecer a varias (memberships,
-- 0022) y el tablero que quiere en cada una no tiene por qué ser el mismo: en la suya mira la
-- facturación, en la que hace suplencias mira nada más la agenda. La clave es el par.
--
-- ── POR QUÉ `jsonb` Y NO UNA FILA POR WIDGET ────────────────────────────────────────────────────
--
-- Porque lo que se guarda es UNA LISTA ORDENADA, y el orden en filas se paga con una columna de
-- posición que hay que renumerar entera cada vez que alguien arrastra algo. Acá se lee y se escribe
-- de a una: la preferencia completa o nada.
--
-- LA BASE NO VALIDA LOS IDS a propósito. Un `check` contra la lista de widgets convertiría cada
-- widget nuevo en una migración, y peor: un widget retirado dejaría filas que ya no validan y que
-- nadie puede actualizar. La reconciliación vive en `lib/tablero/widgets.ts`, que ignora lo que no
-- conoce y agrega lo que apareció después — y eso sí está cubierto por tests.

create table if not exists public.tablero_preferencias (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  clinic_id  uuid not null references public.clinics(id) on delete cascade,

  -- `[{ "id": "metricas", "visible": true }, …]` en el orden en que se pintan.
  widgets    jsonb not null default '[]'::jsonb,

  updated_at timestamptz not null default now(),
  primary key (user_id, clinic_id)
);

alter table public.tablero_preferencias enable row level security;

-- SÓLO LA PROPIA, y esto es distinto del resto del sistema a propósito: casi toda la RLS de Tuvetia
-- acota por clínica porque los datos son de la clínica. Una preferencia de pantalla no lo es. Que
-- un compañero pueda leer —o peor, escribir— cómo tenés ordenado tu tablero no le sirve a nadie y
-- abre una superficie que no hace falta.
create policy "tablero_preferencias_select" on public.tablero_preferencias
  for select using (user_id = (select auth.uid()));
create policy "tablero_preferencias_insert" on public.tablero_preferencias
  for insert with check (
    user_id = (select auth.uid())
    -- La clínica, igual, tiene que ser una tuya: sin esto se podrían sembrar filas apuntando a
    -- clínicas ajenas. No filtra nada de valor, pero deja basura referenciando lo que no toca.
    and clinic_id = (select private.my_clinic_id())
  );
create policy "tablero_preferencias_update" on public.tablero_preferencias
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "tablero_preferencias_delete" on public.tablero_preferencias
  for delete using (user_id = (select auth.uid()));

comment on table public.tablero_preferencias is
  'Qué widgets ve cada persona en su tablero y en qué orden. Por (usuario, clínica): un vet puede estar en varias y querer cosas distintas en cada una.';
