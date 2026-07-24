import { createAdminClient } from "@/lib/supabase/admin"

// Purga de audio a 7 días (Ley 1581 / retención): borra del bucket los audios vencidos
// (retain_until < now) y anula storage_path, conservando la fila (duración, vínculo con el transcript).
// Lo dispara Vercel Cron a diario (ver vercel.json). Protegido con CRON_SECRET: Vercel manda
// Authorization: Bearer <CRON_SECRET> cuando la variable está definida.

const AUDIO_BUCKET = "consultation-audios"
const BATCH = 500

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return new Response("Falta configuración del servidor (SUPABASE_SERVICE_ROLE_KEY)", { status: 503 })
  }

  const { data: expired, error } = await admin
    .from("consultation_audios")
    .select("id, storage_path")
    .not("storage_path", "is", null)
    .lt("retain_until", new Date().toISOString())
    .limit(BATCH)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  let purged = 0
  for (const a of (expired ?? []) as { id: string; storage_path: string }[]) {
    const { error: rmErr } = await admin.storage.from(AUDIO_BUCKET).remove([a.storage_path])
    // 'not found' -> el archivo ya no está; igual anulamos el path para no reintentar.
    if (!rmErr || /not.?found/i.test(rmErr.message)) {
      await admin.from("consultation_audios").update({ storage_path: null }).eq("id", a.id)
      purged += 1
    }
  }

  return Response.json({ checked: expired?.length ?? 0, purged })
}
