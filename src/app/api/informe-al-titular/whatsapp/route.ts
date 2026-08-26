// Manda el informe al titular por WhatsApp — y registra la entrega, las dos cosas acá.
//
// ── LA REGLA QUE ESTE ARCHIVO NO PUEDE ROMPER ─────────────────────────────────────────────────
//
// Lo clínico NUNCA sale solo. Este endpoint sólo se alcanza desde el diálogo del informe, donde el
// vet ya leyó y editó cada sección; el clic de «Enviar por WhatsApp» ES la aprobación. No hay
// camino automático hacia acá: la decisión de David del 25-ago («que pueda mandar la historia si
// el titular la pide») se resolvió el 26-ago como envío aprobado por el vet — David asume el canal,
// y la máquina no decide nada.
//
// ── POR QUÉ ENVÍA *Y* REGISTRA, EN VEZ DE DEJAR EL REGISTRO AL CLIENTE ────────────────────────
//
// Los otros canales (pdf, portapapeles) registran desde el navegador porque la entrega pasa EN el
// navegador. Acá la entrega pasa en el servidor: si el registro quedara del otro lado, un tab
// cerrado entre el envío y el insert dejaría un WhatsApp mandado sin fila de auditoría — y la
// auditoría vale por lo que no se puede olvidar de anotar. El insert corre con la SESIÓN del vet
// (RLS de la clínica intacta); sólo el envío usa la integración.
//
// ── EL DESTINO NO VIAJA EN EL BODY ────────────────────────────────────────────────────────────
//
// El teléfono se resuelve ACÁ, de la consulta → paciente → titular. Aceptarlo del navegador
// convertiría este endpoint en «mandale cualquier texto a cualquier número desde el WhatsApp de la
// clínica», que es otra función y una peor.

import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { sePuedeInformar, MOTIVOS, type NotaAprobada } from "@/lib/informe-al-titular/armar"
import { sendWhatsAppText } from "@/lib/whatsapp/send-message"

export const runtime = "nodejs"

type Body = {
  consultation_id?: string
  /** El informe YA EDITADO por el vet, como texto plano listo para el chat. */
  texto?: string
  /** Las secciones, para la fila de auditoría (misma forma que registran los otros canales). */
  informe?: {
    subject?: string
    salutation?: string
    body?: string
    plan?: string
    warnings?: string
    signature?: string
  }
  generated_at?: string
}

export async function POST(req: Request) {
  const { consultation_id, texto, informe, generated_at } = (await req
    .json()
    .catch(() => ({}))) as Body
  if (!consultation_id || !texto?.trim() || !informe?.body?.trim()) {
    return NextResponse.json({ error: "Falta el informe o la consulta." }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 })

  const { data: perfil } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle()
  const clinicId = (perfil as { clinic_id: string | null } | null)?.clinic_id
  if (!clinicId) return NextResponse.json({ error: "No hay clínica activa." }, { status: 400 })

  // La consulta de ESTA clínica, con el teléfono del titular y su nota más reciente. La RLS ya
  // acota, y el eq(clinic_id) explícito es la doble costura de siempre.
  const [{ data: consulta }, { data: nota }] = await Promise.all([
    supabase
      .from("consultations")
      .select("id, patient:patients(name, owner:owners(full_name, phone))")
      .eq("id", consultation_id)
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    supabase
      .from("clinical_notes")
      .select("status, assessment, plan")
      .eq("consultation_id", consultation_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const c = consulta as unknown as {
    id: string
    patient: { name: string; owner: { full_name: string | null; phone: string | null } | null } | null
  } | null
  if (!c) return NextResponse.json({ error: "Esa consulta no existe." }, { status: 404 })

  // La misma regla que protege el borrador (y que la 0071 impone con trigger al guardar): sin nota
  // aprobada no sale nada — por NINGÚN canal, y menos por el que llega directo al bolsillo.
  const gate = sePuedeInformar(nota as NotaAprobada | null)
  if (!gate.puede) {
    return NextResponse.json({ error: MOTIVOS[gate.motivo] }, { status: 409 })
  }

  const telefono = c.patient?.owner?.phone?.trim()
  if (!telefono) {
    return NextResponse.json(
      { error: "El titular no tiene teléfono registrado: cargalo en su ficha y volvé a intentar." },
      { status: 409 },
    )
  }

  try {
    await sendWhatsAppText(clinicId, telefono, texto.trim())
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }

  // El envío YA pasó: si esta fila fallara, el error se devuelve igual de fuerte — un WhatsApp
  // mandado sin registro es exactamente lo que la auditoría existe para impedir.
  const { error: registroErr } = await supabase.from("client_reports").insert({
    clinic_id: clinicId,
    consultation_id,
    created_by: user.id,
    subject: informe.subject || `Informe de ${c.patient?.name ?? "la consulta"}`,
    salutation: informe.salutation || null,
    body: informe.body,
    plan: informe.plan || null,
    warnings: informe.warnings || null,
    signature: informe.signature || null,
    channel: "whatsapp",
    generated_at: generated_at ?? new Date().toISOString(),
  })
  if (registroErr) {
    return NextResponse.json(
      { error: `El WhatsApp SALIÓ, pero la entrega no quedó registrada: ${registroErr.message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, titular: c.patient?.owner?.full_name ?? null })
}
