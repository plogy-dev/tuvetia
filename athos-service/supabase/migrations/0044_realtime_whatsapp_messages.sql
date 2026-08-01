-- Realtime para la bandeja de WhatsApp.
--
-- La publicación `supabase_realtime` existía pero estaba VACÍA — verificado contra producción el
-- 2026-07-31: `pg_publication_tables` devolvía cero filas. O sea que cualquier suscripción de
-- Realtime en el proyecto no emitía absolutamente nada, en silencio. Por eso la bandeja se apoyaba
-- en un poll de 15 s (y otro de 20 s para los ticks de entregado/leído).
--
-- RLS SE SIGUE APLICANDO, y es lo que hace que esto sea seguro: Realtime evalúa la policy SELECT
-- `whatsapp_messages_select` (`clinic_id = private.my_clinic_id()`) contra el JWT de cada
-- suscriptor antes de entregarle un evento. Una clínica no recibe los mensajes de otra. Publicar la
-- tabla NO la expone: sin sesión válida no llega nada.
--
-- REPLICA IDENTITY se deja en DEFAULT (clave primaria) a propósito. La bandeja sólo usa el registro
-- NUEVO de cada evento: INSERT para los mensajes que entran, UPDATE para los ticks. Ponerla en FULL
-- escribiría la fila vieja completa en el WAL en cada UPDATE sin que nadie la lea.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'whatsapp_messages'
  ) then
    alter publication supabase_realtime add table public.whatsapp_messages;
  end if;
end $$;
