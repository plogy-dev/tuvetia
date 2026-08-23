-- 0076: un administrador puede cambiarle el rol a alguien del equipo.
--
-- LO QUE FALTABA. La pantalla de equipo ya sabía INVITAR con un rol y QUITAR a alguien, pero no
-- cambiarle el rol al que ya está. El resultado es que ascender a un veterinario obligaba a
-- quitarlo y volver a invitarlo — y quitarlo lo saca de la clínica de verdad: deja de ver pacientes,
-- consultas y agenda hasta que acepte la nueva invitación.
--
-- ── EL ROL VIVE EN DOS LUGARES, Y ÉSA ES LA TRAMPA ──────────────────────────────────────────────
--
-- `memberships.role` es el rol EN ESA CLÍNICA —alguien puede estar en varias— y `profiles.role` es
-- el de la clínica ACTIVA. Actualizar sólo `profiles` parece funcionar hasta que la persona cambia
-- de clínica y vuelve: `switch_active_clinic` relee `memberships` y le devuelve el rol viejo.
--
-- Así que se escriben los dos, y `profiles` sólo si la clínica que se está tocando es la activa de
-- esa persona — cambiarle el rol en una clínica no puede pisarle el de otra.
--
-- ── LAS GUARDAS SON LAS MISMAS QUE LAS DE QUITAR ────────────────────────────────────────────────
--
-- Y una más, que es la que hace falta acá: NADIE SE DEGRADA A SÍ MISMO. Un admin que se quita el
-- rol pierde el botón con el que se lo devolvería, y si es el único queda una clínica sin
-- administrador. `remove_clinic_member` ya impide quitarse a uno mismo por el mismo motivo.

create or replace function public.cambiar_rol_de_miembro(p_member_id uuid, p_rol public.user_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id  uuid := private.my_clinic_id();
  v_rol_actual public.user_role;
  v_en_clinica uuid;
  v_admins     int;
begin
  if v_clinic_id is null then
    raise exception 'No hay clínica activa.';
  end if;
  if private.my_role() is distinct from 'admin'::public.user_role then
    raise exception 'Solo un administrador puede cambiar el rol de un miembro';
  end if;

  -- NI ASCENDERSE NI DEGRADARSE. Degradarse deja sin el botón para volver; ascenderse no tiene
  -- sentido —ya es admin— pero se corta igual, porque la regla "no te tocás a vos mismo" se
  -- entiende de una y no admite excepciones que después haya que recordar.
  if p_member_id = auth.uid() then
    raise exception 'No podés cambiarte el rol a vos mismo';
  end if;

  select role into v_rol_actual from public.memberships
   where clinic_id = v_clinic_id and user_id = p_member_id;

  if v_rol_actual is null then
    raise exception 'Esa persona no pertenece a tu clínica';
  end if;
  if v_rol_actual = p_rol then
    return;   -- Nada que hacer. No es un error: dos clics seguidos no tienen por qué fallar.
  end if;

  -- EL ÚLTIMO ADMIN NO SE DEGRADA. Misma regla que `remove_clinic_member`: una clínica sin
  -- administrador no puede invitar, ni quitar, ni volver a otorgar nada — se queda cerrada.
  if v_rol_actual = 'admin'::public.user_role and p_rol <> 'admin'::public.user_role then
    select count(*) into v_admins from public.memberships
     where clinic_id = v_clinic_id and role = 'admin'::public.user_role;
    if v_admins <= 1 then
      raise exception 'No podés dejar la clínica sin administrador';
    end if;
  end if;

  update public.memberships
     set role = p_rol
   where clinic_id = v_clinic_id and user_id = p_member_id;

  -- Y en `profiles` SÓLO si ésta es su clínica activa. Si esa persona está trabajando en otra, su
  -- rol de allá no se toca.
  select clinic_id into v_en_clinica from public.profiles where id = p_member_id;
  if v_en_clinica = v_clinic_id then
    update public.profiles set role = p_rol, updated_at = now() where id = p_member_id;
  end if;
end;
$$;

-- Sólo con sesión. `revoke ... from public` primero: crear una función le da EXECUTE a PUBLIC por
-- omisión, y `anon` hereda de ahí — es lo que la 0070 se olvidó y hubo que corregir en la 0073.
revoke execute on function public.cambiar_rol_de_miembro(uuid, public.user_role) from public;
revoke execute on function public.cambiar_rol_de_miembro(uuid, public.user_role) from anon;
grant  execute on function public.cambiar_rol_de_miembro(uuid, public.user_role) to authenticated;
grant  execute on function public.cambiar_rol_de_miembro(uuid, public.user_role) to service_role;
