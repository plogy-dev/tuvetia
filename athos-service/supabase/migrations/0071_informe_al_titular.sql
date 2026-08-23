-- 0071: el informe que se le entrega al titular, y el registro de lo que se le entregó.
--
-- LO QUE SE PIDIÓ, el 18-ago: *"todo lo que es el dashboard modular, ventas y reportes replicarlo
-- con la estética del cliente, incluyendo reporte en PDF como en el repo"*. En el prototipo de
-- Luciano ese reporte es `client_reports`: la consulta traducida al idioma del dueño —qué le pasa,
-- qué hay que hacer, cuándo volver corriendo— revisada por el vet y entregada en PDF.
--
-- POR QUÉ SE GUARDA Y NO SE GENERA AL VUELO CADA VEZ. Son tres cosas distintas y las tres importan:
--
--   1. **Auditoría.** Si el titular dice "ustedes me dijeron que le diera media pastilla", el vet
--      tiene que poder ver EXACTAMENTE qué decía el papel que se llevó, y de cuándo. Un documento
--      que se regenera cada vez no puede responder eso: el modelo redacta distinto cada corrida.
--   2. **Reenvío.** El dueño pierde el papel y quiere el mismo, no uno parecido.
--   3. **Es lo que el vet aprobó**, no lo que el modelo escribió. Entre una cosa y la otra hay una
--      edición humana, y lo que vale es lo de después.
--
-- ── LO QUE CAMBIA RESPECTO DEL PROTOTIPO ────────────────────────────────────────────────────────
--
-- Allá la RLS es `auth.uid() = user_id`: un vet, sus reportes. Acá una clínica tiene equipo, y un
-- informe entregado por un veterinario lo tiene que poder consultar el que atienda al mismo
-- paciente el mes que viene — si no, la auditoría depende de quién esté de turno.
--
-- Así que va `clinic_id` con RLS por clínica, como el resto del sistema, y `created_by` aparte para
-- saber QUIÉN lo entregó. Son dos preguntas distintas y una sola columna no contesta las dos.

create table if not exists public.client_reports (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  consultation_id uuid not null references public.consultations(id) on delete cascade,
  -- Quién lo entregó. `set null` y no `cascade`: si esa persona se va de la clínica, el informe que
  -- entregó NO se borra — es justamente el registro que la auditoría necesita que sobreviva.
  created_by      uuid references public.profiles(id) on delete set null,

  -- El contenido YA CURADO por el vet, en secciones. Separadas y no un `text` suelto porque el PDF,
  -- el texto plano del portapapeles y el correo del futuro las componen distinto — y partir un
  -- bloque de texto en secciones después es adivinar.
  subject         text not null,
  salutation      text,
  body            text not null,
  plan            text,
  warnings        text,
  signature       text,

  -- Por dónde salió de verdad. `email` queda declarado pero todavía no se usa: cuando se cablee,
  -- la tabla no cambia.
  channel         text not null check (channel in ('pdf', 'clipboard', 'email')),

  -- DOS MOMENTOS Y NO UNO. El modelo redacta, el vet revisa y edita, el vet entrega. Cuánto tiempo
  -- pasa entre `generated_at` y `sent_at` es lo que dice si el vet lo leyó o le dio a enviar — y es
  -- lo primero que se mira cuando un informe sale mal.
  generated_at    timestamptz not null default now(),
  sent_at         timestamptz not null default now(),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- El acceso real es "los informes de ESTA consulta, el más reciente primero" (el PDF imprime el
-- último). Y `clinic_id` va de primero porque toda policy filtra por él.
create index if not exists client_reports_de_la_consulta
  on public.client_reports (clinic_id, consultation_id, sent_at desc);

alter table public.client_reports enable row level security;

create policy "client_reports_select" on public.client_reports
  for select using (clinic_id = (select private.my_clinic_id()));
create policy "client_reports_insert" on public.client_reports
  for insert with check (clinic_id = (select private.my_clinic_id()));
create policy "client_reports_update" on public.client_reports
  for update using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

-- SIN POLICY DE DELETE, y es a propósito: un registro de auditoría que el auditado puede borrar no
-- es un registro. Si algún día hay que depurar informes viejos, se hace con una política de
-- retención explícita, no con un botón.

-- ── Que el informe no adelante a la nota ────────────────────────────────────────────────────────
--
-- REGLA 5 DEL SISTEMA: ninguna nota entra a la historia sin que el vet la apruebe. Un informe al
-- titular sale de esa nota, así que entregar uno derivado de un borrador sería saltarse la
-- aprobación por la puerta de atrás — y peor, por la puerta que da a la calle: el borrador se
-- queda adentro, el informe se lo lleva el dueño.
--
-- La UI ya deshabilita el botón, pero eso es una cortesía, no una garantía: la tabla se escribe
-- desde el cliente con RLS y nada impide un insert a mano. Va como trigger.
create or replace function private.informe_solo_de_nota_aprobada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.clinical_notes n
    where n.consultation_id = new.consultation_id
      and n.clinic_id = new.clinic_id
      and n.status = 'approved'
  ) then
    raise exception 'No se puede entregar un informe de una consulta cuya nota no está aprobada.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists client_reports_nota_aprobada on public.client_reports;

create trigger client_reports_nota_aprobada
  before insert on public.client_reports
  for each row execute function private.informe_solo_de_nota_aprobada();

-- ── El gasto del informe se mide aparte ─────────────────────────────────────────────────────────
--
-- `athos_agent_usage.surface` tiene un CHECK con la lista cerrada de superficies, así que una
-- superficie nueva sin agregarla acá no falla al llamar al modelo: falla al REGISTRAR el gasto,
-- después de haberlo pagado. O sea que se cobraría sin quedar contado, que es el peor de los dos
-- órdenes posibles.
--
-- Se mide aparte y no dentro de `agent` porque contesta una pregunta propia: cuánto cuesta que cada
-- consulta termine con un informe para el dueño. Metida en la bolsa grande, esa cifra no existe.
--
-- La lista se REESCRIBE ENTERA (mismo camino que la 0057 y la 0068): un CHECK no se "amplía", se
-- reemplaza, y omitir una de las viejas acá la rompería en silencio.
alter table public.athos_agent_usage
  drop constraint if exists athos_agent_usage_surface_check;

alter table public.athos_agent_usage
  add constraint athos_agent_usage_surface_check
  check (surface = any (array[
    'agent',
    'suggest_reply',
    'auto_reply',
    'cartera_inbound',
    'vision_recipe',
    'vision_purchase',
    'widget',
    'briefing',
    'consulta_viva',
    -- El informe que se le entrega al titular al cerrar la consulta (0071).
    'informe_titular'
  ]));
