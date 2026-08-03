-- La nota clínica aprobada es final, y el gate de alergia severa deja de ser un `if` del navegador.
--
-- LO QUE HABÍA. `clinical_notes` no tiene NI UN trigger ni UN check (verificado contra el
-- principal), y su policy de UPDATE es `using (clinic_id = private.my_clinic_id())` a secas. Los dos
-- controles que el producto promete vivían enteros en el cliente:
--
--   1. "Una nota aprobada no se edita" era que `consultas/[id]/page.tsx` cambia los <Textarea> por
--      <p> y deshabilita el botón. Con la sesión del propio vet, un
--      `supabase.from('clinical_notes').update({assessment:'otra cosa'})` desde la consola modifica
--      una historia clínica firmada — y no queda rastro, porque la columna `edit_history` que la
--      tabla ya trae no la escribe nadie (0 escrituras en todo el repo).
--
--   2. El gate de alergia severa era `if (note.allergy_gate_triggered && !gateAck) return`. El
--      CLAUDE.md del servicio lo declara "determinístico, bloqueante, nunca depende del LLM": lo
--      determinístico es el CÁLCULO del flag, pero nada impedía aprobar con el gate disparado.
--
-- Para una historia clínica eso no alcanza: la Resolución 1995 de 1999 pide que el registro sea
-- inalterable una vez suscrito.
--
-- POR QUÉ UN TRIGGER Y NO UNA POLICY. Una policy `with check` no puede mirar la fila VIEJA, y todo
-- esto es sobre la transición: "si ya estaba aprobada" y "si pasa de borrador a aprobada". El
-- trigger es la única herramienta que ve OLD y NEW.

-- Constancia de que el vet revisó la alergia antes de firmar. La casilla ya existe en la UI
-- (`gateAck`); lo que faltaba era dejarla escrita en algún lado y exigirla.
alter table public.clinical_notes
  add column if not exists allergy_acknowledged_at timestamptz;

comment on column public.clinical_notes.allergy_acknowledged_at is
  'Cuándo el vet confirmó que revisó la alergia severa. Obligatoria para aprobar si allergy_gate_triggered.';

create or replace function public.clinical_notes_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- 1) Aprobada = final. Se listan las columnas en vez de comparar la fila entera para que
  --    `updated_at` siga pudiendo moverse y para que agregar una columna nueva no bloquee de
  --    rebote algo que no tiene nada que ver.
  if old.status = 'approved' then
    if new.subjective            is distinct from old.subjective
    or new.objective             is distinct from old.objective
    or new.assessment            is distinct from old.assessment
    or new.plan                  is distinct from old.plan
    or new.citations             is distinct from old.citations
    or new.status                is distinct from old.status
    or new.approved_by           is distinct from old.approved_by
    or new.approved_at           is distinct from old.approved_at
    or new.allergy_gate_triggered is distinct from old.allergy_gate_triggered
    then
      raise exception 'La nota ya fue aprobada y forma parte de la historia clínica: no se puede modificar. Si hay que corregir algo, se registra en una consulta nueva.';
    end if;
  end if;

  -- Incluir `approved_by`/`approved_at` arriba cierra además la doble aprobación: `approve()` no
  -- lleva `.eq('status','draft')`, así que dos clics seguidos pisaban quién y cuándo firmó.

  -- 2) No se firma sobre una alergia severa sin dejar constancia.
  if old.status is distinct from 'approved'
     and new.status = 'approved'
     and new.allergy_gate_triggered
     and new.allergy_acknowledged_at is null
  then
    raise exception 'Esta nota tiene una alergia severa marcada: hay que confirmar que se revisó el plan antes de aprobarla.';
  end if;

  return new;
end;
$function$;

drop trigger if exists clinical_notes_guard on public.clinical_notes;
create trigger clinical_notes_guard
  before update on public.clinical_notes
  for each row execute function public.clinical_notes_guard();

-- ── Comprobación, para correr a mano después de aplicarla ───────────────────────────────────────
--   select tgname from pg_trigger
--   where tgrelid = 'public.clinical_notes'::regclass and not tgisinternal;
--   -- tiene que devolver clinical_notes_guard
--
-- Y la prueba de verdad, con la sesión de un vet desde la consola del navegador, sobre una nota YA
-- aprobada:
--   supabase.from('clinical_notes').update({ assessment: 'otra cosa' }).eq('id', '<id>')
--   -- tiene que devolver error, no éxito.
