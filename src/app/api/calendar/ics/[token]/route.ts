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

  // ── VENTANA Y TOPE, O EL FEED SE CONGELA (revisión de escala, 26-ago) ─────────────────────
  //
  // Sin filtro, PostgREST corta en 1.000 filas SIN ERROR y `order ASC` entrega las 1.000 MÁS
  // VIEJAS: al pasar mil citas acumuladas, las nuevas jamás llegaban al calendario del vet y
  // nadie veía fallar nada. Un calendario vive del presente.
  //
  // ── EL ARREGLO DE AYER TRAÍA LA MISMA BOMBA CON OTRA MECHA ──────────────────────────────
  //
  // Quedó en 30 días hacia atrás con tope 500, y esos dos números se pelean: una clínica con
  // 20 citas al día llena las 500 con el pasado —600 filas— y TODO el futuro se cae del feed.
  // El mismo fallo silencioso, sólo que hace falta más volumen para verlo.
  //
  // La ventana baja a 7 días, que es todo el pasado que un calendario necesita mostrar, y el
  // tope sube al máximo que sirve PostgREST. Con eso el pasado ocupa a lo sumo ~140 filas y las
  // otras ~860 son futuro.
  //
  // ── Y SE QUEDA EN ASCENDENTE, A PROPÓSITO ───────────────────────────────────────────────
  //
  // Darlo vuelta a descendente parece el arreglo natural —«traer lo más nuevo»— y es peor: el
  // tope se comería entonces las citas MÁS CERCANAS y dejaría las de dentro de seis meses. Un
  // feed al que le falta la cita de mañana no sirve para nada; uno al que le falta la de
  // noviembre se completa solo cuando llegue.
  //
  // Ascendente desde hace una semana garantiza la propiedad que importa: lo primero que entra
  // es lo que está por pasar, y lo que se cae —si algún día se cae— es lo más lejano.
  const hace7Dias = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString()
  const { data: appts } = await admin
    .from("appointments")
    .select("id, title, reason, notes, starts_at, ends_at, status, patient:patients(name)")
    .eq("clinic_id", (feed as { clinic_id: string }).clinic_id)
    .gte("starts_at", hace7Dias)
    .order("starts_at", { ascending: true })
    .limit(1000)

  const ics = buildIcs((appts as unknown as IcsAppointment[] | null) ?? [], {
    calName: "Tuvetia — Agenda",
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
