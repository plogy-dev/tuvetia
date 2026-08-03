import "server-only"

// Las fotos, audios y documentos que manda el titular: bajarlos del proveedor y guardarlos.
//
// POR QUÉ EXISTE. `whatsapp_messages.media_url` estaba en el esquema desde el principio y ninguno de
// los dos webhooks la escribía. La bandeja tenía `media_type` y nada más, así que pintaba `[image]`
// literal: el vet veía que llegó una foto y no podía verla. Para una clínica eso no es un detalle —
// la foto de la herida ES la consulta.
//
// LA MEDIA DEL PROVEEDOR NO SE PUEDE REFERENCIAR. En Meta hace falta el token del tenant hasta para
// la descarga final (un `<img src>` del navegador nunca la vería) y la URL caduca. En Evolution el
// archivo viaja cifrado y sólo lo descifra la sesión de Baileys viva. En los dos casos la única
// opción real es bajar los bytes y guardarlos nosotros, en el bucket privado `whatsapp-media`
// (migración 0056), con el mismo contrato de path que `receipts`: `<clinic_id>/…`.
//
// TODO ESTO CORRE EN `after()`, DESPUÉS DE RESPONDER EL WEBHOOK. Meta reintenta el webhook si no
// contestamos rápido, y una descarga de 16 MB dentro del handler es exactamente cómo se producen
// mensajes duplicados. Por eso nada de acá puede tumbar la ingesta: si falla, el mensaje YA está
// guardado con su `media_type` y lo único que se pierde es la miniatura. Se loguea y se sigue.

import type { SupabaseClient } from "@supabase/supabase-js"

import { getMediaBase64 } from "./evolution"
import { descargarMediaDeMeta } from "./meta-provider"
import type { WhatsAppIntegrationRow } from "./provider"

export const MEDIA_BUCKET = "whatsapp-media"

// El propio tope de WhatsApp para imagen/audio/video. El bucket lo repite (0056): esta comprobación
// es para no gastar la subida, la del bucket es la que de verdad protege.
const MAX_BYTES = 16 * 1024 * 1024

const EXTENSIONES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/amr": "amr",
  "application/pdf": "pdf",
}

export function extensionDe(contentType: string | null): string {
  if (!contentType) return "bin"
  // Los mimetypes de WhatsApp vienen con parámetros: `audio/ogg; codecs=opus`.
  const base = contentType.split(";")[0]!.trim().toLowerCase()
  const conocida = EXTENSIONES[base]
  if (conocida) return conocida
  // Se limpia todo lo que no sea alfanumérico porque esto acaba pegado a un path. `|| "bin"` y no
  // `?? "bin"`: un mimetype raro puede dejar la cadena VACÍA después de limpiar (lo encontró el
  // test con `../../etc/passwd`), y `??` no atrapa el string vacío — quedaba un archivo terminado
  // en punto.
  return base.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "bin"
}

// Sube los bytes y deja la RUTA en `media_url` — no una URL. La bandeja la firma con la sesión del
// vet, así que la RLS de storage sigue siendo la barrera aunque la ruta se filtre.
async function guardar(
  admin: SupabaseClient,
  args: {
    clinicId: string
    waMessageId: string
    bytes: Buffer
    contentType: string | null
  },
): Promise<string | null> {
  if (args.bytes.byteLength === 0) return null
  if (args.bytes.byteLength > MAX_BYTES) {
    console.warn(`whatsapp/media: ${args.waMessageId} pesa ${args.bytes.byteLength} bytes, se omite`)
    return null
  }

  // El id del mensaje ya es único y viene del proveedor; sanearlo igual porque acaba siendo un path.
  const nombre = args.waMessageId.replace(/[^\w.-]+/g, "_").slice(0, 120)
  const path = `${args.clinicId}/${nombre}.${extensionDe(args.contentType)}`

  const { error } = await admin.storage.from(MEDIA_BUCKET).upload(path, args.bytes, {
    contentType: args.contentType ?? "application/octet-stream",
    // `upsert` a propósito: el webhook se reintenta y el segundo intento tiene que poder terminar.
    upsert: true,
  })
  if (error) {
    console.error(`whatsapp/media: no se pudo subir ${path}: ${error.message}`)
    return null
  }

  const { error: updErr } = await admin
    .from("whatsapp_messages")
    .update({ media_url: path })
    .eq("clinic_id", args.clinicId)
    .eq("wa_message_id", args.waMessageId)
  if (updErr) {
    console.error(`whatsapp/media: subida ok pero no se pudo enlazar ${path}: ${updErr.message}`)
    return null
  }
  return path
}

// ── Evolution (Baileys) ─────────────────────────────────────────────────────────────────────────
export async function capturarMediaEvolution(
  admin: SupabaseClient,
  args: { clinicId: string; instancia: string; waMessageId: string; mensajeCrudo: unknown },
): Promise<void> {
  try {
    const media = await getMediaBase64(args.instancia, args.mensajeCrudo)
    if (!media) return
    await guardar(admin, {
      clinicId: args.clinicId,
      waMessageId: args.waMessageId,
      bytes: Buffer.from(media.base64, "base64"),
      contentType: media.mimetype,
    })
  } catch (e) {
    console.error(`whatsapp/media evolution ${args.waMessageId}:`, (e as Error).message)
  }
}

// ── Meta Cloud API ──────────────────────────────────────────────────────────────────────────────
export async function capturarMediaMeta(
  admin: SupabaseClient,
  args: { clinicId: string; waMessageId: string; mediaId: string },
): Promise<void> {
  try {
    // La integración se busca acá y no en el webhook a propósito: el handler no carga
    // `access_token_enc` (no lo necesita para nada más) y esto corre fuera de la respuesta, donde una
    // query de más no le cuesta latencia a nadie.
    const { data } = await admin
      .from("whatsapp_integrations")
      .select("*")
      .eq("clinic_id", args.clinicId)
      .maybeSingle()
    const integ = data as WhatsAppIntegrationRow | null
    if (!integ?.access_token_enc) {
      // Pasa con Kapso, que reenvía el payload de Meta pero no nos da un token de Meta: la media
      // habría que pedírsela a Kapso. No es un fallo — es una combinación que no soportamos.
      console.warn(`whatsapp/media meta: la clínica ${args.clinicId} no tiene token propio, se omite`)
      return
    }
    const media = await descargarMediaDeMeta(integ, args.mediaId)
    if (!media) return
    await guardar(admin, {
      clinicId: args.clinicId,
      waMessageId: args.waMessageId,
      bytes: media.bytes,
      contentType: media.contentType,
    })
  } catch (e) {
    console.error(`whatsapp/media meta ${args.waMessageId}:`, (e as Error).message)
  }
}
