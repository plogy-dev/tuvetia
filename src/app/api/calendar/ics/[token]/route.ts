import { createAdminClient } from "@/lib/supabase/admin"
import { buildIcs, type IcsAppointment } from "@/lib/ics"

// Feed ICS de solo lectura, autenticado por el token en la URL (no requiere login ni OAuth de Google).
// Lee con service_role (sin RLS) acotando por el clinic_id que resuelve el token.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token) return new Response("Not found", { status: 404 })

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return new Response("Feed no disponible (falta configuración del servidor)", { status: 503 })
  }

  const { data: feed } = await admin
    .from("calendar_feeds")
    .select("clinic_id")
    .eq("token", token)
    .maybeSingle()
  if (!feed) return new Response("Not found", { status: 404 })

  const { data: appts } = await admin
    .from("appointments")
    .select("id, title, reason, notes, starts_at, ends_at, status, patient:patients(name)")
    .eq("clinic_id", (feed as { clinic_id: string }).clinic_id)
    .order("starts_at", { ascending: true })

  const ics = buildIcs((appts as unknown as IcsAppointment[] | null) ?? [], {
    calName: "TuvetIA — Agenda",
  })

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="tuvetia.ics"',
      "Cache-Control": "public, max-age=300",
    },
  })
}
