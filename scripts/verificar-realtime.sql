-- Verificación de la bandeja en tiempo real. Pegar en el SQL Editor de Supabase (proyecto
-- principal) DESPUÉS de aplicar `0044_realtime_whatsapp_messages.sql`, y antes de mergear el PR.
--
-- Por qué existe: la publicación `supabase_realtime` de este proyecto estaba VACÍA —verificado el
-- 2026-07-31 y de nuevo el 2026-08-01: `pg_publication_tables` devolvía cero filas—, así que
-- cualquier suscripción de Realtime no emitía absolutamente nada, en silencio. Y el commit de la
-- bandeja ya quitó los dos polls que la sostenían: si se despliega sin la migración aplicada, los
-- mensajes nuevos sólo aparecen al recargar la página.
--
-- Devuelve UNA fila con un veredicto legible. Las tres condiciones tienen que dar OK.

with publicada as (
  select count(*) > 0 as ok
  from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = 'whatsapp_messages'
),
policy_select as (
  -- Publicar la tabla no la expone: Realtime evalúa esta policy contra el JWT de cada suscriptor
  -- antes de entregarle un evento. Si desapareciera, una clínica vería los mensajes de otra.
  select count(*) > 0 as ok
  from pg_policies
  where schemaname = 'public'
    and tablename = 'whatsapp_messages'
    and cmd = 'SELECT'
    and qual like '%my_clinic_id%'
),
rls as (
  select relrowsecurity as ok
  from pg_class
  where oid = 'public.whatsapp_messages'::regclass
)
select
  case when p.ok then '✅' else '❌' end || ' tabla en la publicación supabase_realtime'  as paso_1,
  case when r.ok then '✅' else '❌' end || ' RLS habilitada en whatsapp_messages'        as paso_2,
  case when s.ok then '✅' else '❌' end || ' policy SELECT acotada por my_clinic_id()'   as paso_3,
  case
    when p.ok and r.ok and s.ok
      then 'LISTO — Realtime está vivo y aislado por clínica. Se puede mergear el PR.'
    when not p.ok
      then 'FALTA APLICAR 0044_realtime_whatsapp_messages.sql — NO mergear todavía: la bandeja quedaría sin polls y sin Realtime.'
    else 'REVISAR — la tabla está publicada pero el aislamiento por clínica no está completo. NO mergear.'
  end as veredicto
from publicada p, rls r, policy_select s;
