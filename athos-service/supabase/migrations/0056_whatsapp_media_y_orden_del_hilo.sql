-- La foto que llegaba como "[adjunto]", y el hilo ordenado por la hora de WhatsApp.
--
-- Van juntas porque son el mismo camino —el webhook escribe, la bandeja lee— y separarlas obliga a
-- tocar los mismos dos archivos dos veces.
--
-- ── 1. El bucket `whatsapp-media` ───────────────────────────────────────────────────────────────
--
-- `whatsapp_messages.media_url` existe desde el primer día y NINGUNO de los dos webhooks la escribió
-- nunca: ambos guardaban sólo `media_type`. Por eso la bandeja pintaba el literal `[image]` — tenía
-- el tipo y no tenía el contenido. No era un bug de la vista: era un hueco en la escritura.
--
-- Guardar la URL del proveedor no alcanza. En Meta la media caduca (y además exige el token del
-- tenant para descargarla, o sea que un <img src> del navegador nunca la vería), y en Evolution la
-- sirve Baileys desde la sesión viva. Las dos son efímeras: hay que bajar los bytes y guardarlos.
--
-- Bucket PRIVADO con el mismo contrato que `receipts`: primer segmento del path = `clinic_id`, y las
-- cuatro policies colgadas de `private.my_clinic_id()`. Así la bandeja firma la URL con la sesión del
-- vet y la RLS de storage hace de segunda barrera aunque el path se filtre.
--
-- ── 2. `provider_timestamp` ─────────────────────────────────────────────────────────────────────
--
-- El hilo se ordenaba por `created_at`, que es la hora en que el webhook LLEGÓ, no la hora en que el
-- titular escribió. Los dos proveedores mandan la buena y ninguno se usaba: Evolution manda
-- `messageTimestamp` (estaba declarado en el tipo y jamás leído) y Meta manda `timestamp` (se usaba
-- sólo para los acuses de entrega).
--
-- Con un reintento del webhook, dos mensajes seguidos, o el `after()` de una respuesta automática
-- corriendo entre medio, el hilo se pinta en un orden distinto del que el titular vio en su teléfono.
-- Y como el debounce del modo auto agrupa "lo último que dijo", el orden equivocado también cambia
-- lo que el agente cree que le preguntaron.
--
-- Se llena SIEMPRE (default `now()` + not null) para que la bandeja pueda ordenar por esta columna a
-- secas, sin `coalesce`: PostgREST no sabe ordenar por una expresión. Para los salientes que
-- mandamos nosotros el default es la respuesta correcta — la hora de envío ES la del proveedor.

-- ── Bucket ──────────────────────────────────────────────────────────────────────────────────────
-- 16 MB es el tope de la propia WhatsApp para imagen/audio/video; no tiene sentido aceptar más de lo
-- que el proveedor puede haber recibido.
insert into storage.buckets (id, name, public, file_size_limit)
values ('whatsapp-media', 'whatsapp-media', false, 16777216)
on conflict (id) do nothing;

drop policy if exists "whatsapp_media_storage_select" on storage.objects;
create policy "whatsapp_media_storage_select" on storage.objects for select
  using (
    bucket_id = 'whatsapp-media'
    and (storage.foldername(name))[1] = (private.my_clinic_id())::text
  );

drop policy if exists "whatsapp_media_storage_insert" on storage.objects;
create policy "whatsapp_media_storage_insert" on storage.objects for insert
  with check (
    bucket_id = 'whatsapp-media'
    and (storage.foldername(name))[1] = (private.my_clinic_id())::text
  );

drop policy if exists "whatsapp_media_storage_update" on storage.objects;
create policy "whatsapp_media_storage_update" on storage.objects for update
  using (
    bucket_id = 'whatsapp-media'
    and (storage.foldername(name))[1] = (private.my_clinic_id())::text
  )
  with check (
    bucket_id = 'whatsapp-media'
    and (storage.foldername(name))[1] = (private.my_clinic_id())::text
  );

drop policy if exists "whatsapp_media_storage_delete" on storage.objects;
create policy "whatsapp_media_storage_delete" on storage.objects for delete
  using (
    bucket_id = 'whatsapp-media'
    and (storage.foldername(name))[1] = (private.my_clinic_id())::text
  );

-- ── La hora del proveedor ───────────────────────────────────────────────────────────────────────
alter table public.whatsapp_messages
  add column if not exists provider_timestamp timestamptz;

-- Las filas viejas se quedan con su hora de llegada, que es la única que se conoce de ellas.
update public.whatsapp_messages set provider_timestamp = created_at where provider_timestamp is null;

alter table public.whatsapp_messages alter column provider_timestamp set default now();
alter table public.whatsapp_messages alter column provider_timestamp set not null;

-- El índice que sirve al hilo: por clínica y descendente, que es como lo lee la bandeja.
create index if not exists whatsapp_messages_clinic_provider_ts_idx
  on public.whatsapp_messages (clinic_id, provider_timestamp desc);

comment on column public.whatsapp_messages.provider_timestamp is
  'Hora del proveedor (Evolution messageTimestamp / Meta timestamp). El hilo se ORDENA por esta. '
  'created_at sigue siendo la hora de llegada y es lo que usa el cursor de Realtime: para ponerse al '
  'dia hace falta un reloj monotono de llegada, y este no lo es.';

comment on column public.whatsapp_messages.media_url is
  'Ruta dentro del bucket privado whatsapp-media (<clinic_id>/<wa_message_id>.<ext>), NO una URL '
  'publica. La bandeja la firma con la sesion del vet.';
