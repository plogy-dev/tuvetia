-- Verificación de la 0067 — un veterinario no queda con dos citas encima.
--
-- EJERCITA EL TRIGGER DE VERDAD: monta dos citas del mismo vet en el mismo horario y comprueba que
-- la segunda se rechace. Un trigger que existe pero no bloquea es el mismo defecto con otra cara, y
-- mirar el catálogo no lo distinguiría.
--
-- Prueba los cinco casos que importan: el choque, la válvula, dos citas PEGADAS (que no deben
-- chocar), vets distintos (legítimo), y el arrastrar-y-soltar — que es la vía que se salta los RPC
-- y la razón por la que esto es un trigger.
--
-- Todo se deshace con el `raise` final.

do $$
declare
  v_clinic  uuid;
  v_vet     uuid;
  v_vet2    uuid;
  v_owner   uuid;
  v_pac     uuid;
  v_a       uuid;
  v_b       uuid;
  v_base    timestamptz := date_trunc('hour', now()) + interval '400 days';  -- lejos de datos reales
  v_fallo   text;
  v_n       int;
begin
  select id into v_clinic from public.clinics order by created_at limit 1;
  select id into v_vet from public.profiles where clinic_id = v_clinic limit 1;
  if v_clinic is null or v_vet is null then
    raise exception 'hace falta una clinica con al menos un perfil';
  end if;

  insert into public.owners (clinic_id, full_name) values (v_clinic, 'ZZZ solape') returning id into v_owner;
  insert into public.patients (clinic_id, owner_id, name, species)
    values (v_clinic, v_owner, 'ZZZ solape', 'Perro') returning id into v_pac;

  -- ── 1. La primera cita entra sin problema ────────────────────────────────────────────────
  insert into public.appointments (clinic_id, patient_id, owner_id, vet_id, title, status, starts_at, ends_at)
  values (v_clinic, v_pac, v_owner, v_vet, 'ZZZ primera', 'scheduled', v_base, v_base + interval '30 min')
  returning id into v_a;

  -- ── 2. LA SEGUNDA, ENCIMA, DEBE FALLAR ───────────────────────────────────────────────────
  begin
    insert into public.appointments (clinic_id, patient_id, owner_id, vet_id, title, status, starts_at, ends_at)
    values (v_clinic, v_pac, v_owner, v_vet, 'ZZZ encima', 'scheduled',
            v_base + interval '10 min', v_base + interval '40 min');
    raise exception 'EL TRIGGER NO BLOQUEO: se pudo agendar una cita encima de otra del mismo vet';
  exception when others then
    get stacked diagnostics v_fallo = message_text;
    if v_fallo like 'EL TRIGGER NO BLOQUEO%' then raise; end if;
    if v_fallo not like '%ya tiene%' then
      raise exception 'fallo por un motivo distinto al solape: %', v_fallo;
    end if;
  end;

  -- ── 3. Dos citas PEGADAS no se solapan ───────────────────────────────────────────────────
  -- Una termina a las :30 y la otra empieza a las :30. Cualquier agenda espera que esto se pueda.
  insert into public.appointments (clinic_id, patient_id, owner_id, vet_id, title, status, starts_at, ends_at)
  values (v_clinic, v_pac, v_owner, v_vet, 'ZZZ pegada', 'scheduled',
          v_base + interval '30 min', v_base + interval '60 min')
  returning id into v_b;

  -- ── 4. La valvula deja pasar lo deliberado ───────────────────────────────────────────────
  insert into public.appointments
    (clinic_id, patient_id, owner_id, vet_id, title, status, starts_at, ends_at, permite_solape)
  values (v_clinic, v_pac, v_owner, v_vet, 'ZZZ urgencia', 'scheduled',
          v_base + interval '10 min', v_base + interval '20 min', true);

  -- ── 5. Un estado que no ocupa agenda tampoco choca ───────────────────────────────────────
  insert into public.appointments (clinic_id, patient_id, owner_id, vet_id, title, status, starts_at, ends_at)
  values (v_clinic, v_pac, v_owner, v_vet, 'ZZZ cancelada', 'canceled',
          v_base + interval '5 min', v_base + interval '25 min');

  -- ── 6. EL ARRASTRAR-Y-SOLTAR: un UPDATE directo de horario tambien se bloquea ────────────
  -- Es la via que se salta los RPC, y la razon por la que esto es un trigger y no un chequeo en
  -- create_appointment. Se mueve la cita "pegada" encima de la primera.
  begin
    update public.appointments
    set starts_at = v_base + interval '5 min', ends_at = v_base + interval '25 min'
    where id = v_b;
    raise exception 'EL TRIGGER NO CUBRE EL UPDATE: se pudo arrastrar una cita encima de otra';
  exception when others then
    get stacked diagnostics v_fallo = message_text;
    if v_fallo like 'EL TRIGGER NO CUBRE%' then raise; end if;
    if v_fallo not like '%ya tiene%' then
      raise exception 'el update fallo por un motivo distinto al solape: %', v_fallo;
    end if;
  end;

  -- ── 7. Otro veterinario a la misma hora es LEGITIMO ──────────────────────────────────────
  select id into v_vet2 from public.profiles where clinic_id = v_clinic and id <> v_vet limit 1;
  if v_vet2 is not null then
    insert into public.appointments (clinic_id, patient_id, owner_id, vet_id, title, status, starts_at, ends_at)
    values (v_clinic, v_pac, v_owner, v_vet2, 'ZZZ otro vet', 'scheduled', v_base, v_base + interval '30 min');
  end if;

  -- ── 8. Las que ya se solapaban quedaron marcadas, no bloqueadas ──────────────────────────
  select count(*) into v_n from public.appointments
  where permite_solape and title not like 'ZZZ%';
  if v_n = 0 then
    raise exception 'las 6 citas que ya se solapaban no quedaron marcadas: editarlas fallaria sin culpa del usuario';
  end if;

  raise exception '=== 0067 OK === bloquea el solape (insert Y update), deja pasar pegadas, canceladas, otro vet y la valvula; % citas historicas marcadas', v_n;
end $$;
