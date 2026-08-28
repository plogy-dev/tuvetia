import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { clinicaDeLaSesion } from "@/lib/api/clinica-de-la-sesion"
import { getAppBaseUrl } from "@/lib/base-url"
import { loadClinicSender, sendTransactionalEmail } from "@/lib/email/transactional"
import { maquetarCorreo } from "@/lib/email/maqueta"

// Envío de la invitación de equipo por correo, **a pedido del admin** (botón "Enviar invitación").
//
// Sale por Resend, como todo el correo transaccional (ver CORREOS.md): del remitente de Tuvetia,
// firmado con el nombre de la clínica y con Reply-To a sus administradores — así el invitado que
// responde "¿esto qué es?" le escribe a quien lo invitó, no a nadie.
//
// Antes iba por `auth.admin.inviteUserByEmail`, o sea por el SMTP de Supabase Auth con sus propias
// plantillas: un tercer camino de correo que no compartía dominio ni reputación con el resto, y que
// nadie miraba cuando una invitación no llegaba. Con él se van también sus dos bugs conocidos: el
// enlace ya no es un magic link con `?code=` de PKCE que había que canjear en /auth/callback, sino
// el enlace directo a /invitar/<token>, que es una página pública y sabe recibir a alguien sin
// sesión (le ofrece crear cuenta con el correo invitado y vuelve acá).
//
// Lo que NO cambia: el enlace sigue siendo el camino garantizado. Si el correo no sale, el admin lo
// copia y lo manda por donde quiera — por eso el fallo se devuelve con su motivo en vez de romper.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { token?: string }
  if (!body.token) return NextResponse.json({ error: "Falta token" }, { status: 400 })

  // `clinicaDeLaSesion` comprueba además que la cuenta siga activa: invitar gente al equipo es
  // justamente lo que no puede seguir haciendo alguien a quien se le quitó el acceso.
  const sesion = await clinicaDeLaSesion(supabase, user.id)
  if (!sesion.ok) return NextResponse.json({ error: sesion.mensaje }, { status: sesion.status })
  const p = { clinic_id: sesion.clinicId, role: sesion.role, full_name: sesion.fullName }
  if (p.role !== "admin") {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 })
  }

  try {
    const admin = createAdminClient()
    const { data: inv } = await admin
      .from("invitations")
      .select("email, clinic_id, expires_at")
      .eq("token", body.token)
      .is("accepted_at", null)
      .maybeSingle()
    const invitation = inv as { email: string; clinic_id: string; expires_at: string } | null
    if (!invitation || invitation.clinic_id !== p.clinic_id) {
      return NextResponse.json({ error: "Invitación no encontrada" }, { status: 404 })
    }
    // Un token vencido produce un correo con un enlace muerto: el invitado hace clic, ve
    // "Invitación no válida" y nadie se entera de por qué. Mejor decirlo acá.
    if (new Date(invitation.expires_at) <= new Date()) {
      return NextResponse.json({
        sent: false,
        reason: "La invitación venció. Creá una nueva y volvé a enviarla.",
      })
    }

    // El origen sale de getAppBaseUrl(), no de `new URL(req.url).origin`: en un deployment de
    // preview ese origen es un dominio efímero, y el enlace del correo moría con él.
    const link = `${getAppBaseUrl()}/invitar/${body.token}`
    // El sender se carga una vez y se reusa: da el nombre de la clínica para el cuerpo y evita que
    // sendTransactionalEmail lo vuelva a buscar.
    const sender = await loadClinicSender(p.clinic_id, admin)
    const quienInvita = p.full_name?.trim()
    const clinica = sender.displayName

    const subject = `Te invitaron a ${clinica} en Tuvetia`
    // La frase que abre el correo se reusa como preheader: es justo lo que la bandeja tiene que
    // mostrar al lado del asunto, y un resumen aparte sería otra redacción más que sincronizar.
    const invita = quienInvita
      ? `${quienInvita} te invitó a unirte al equipo de ${clinica} en Tuvetia.`
      : `Te invitaron a unirte al equipo de ${clinica} en Tuvetia.`

    // EL ENLACE ES EL CORREO. Va como botón —la única acción que este mensaje pide— y la maqueta
    // escribe además su dirección debajo, en texto. Las dos cosas hacen falta: el `href` solo no
    // sobrevive a la versión en texto plano (que se deriva de este HTML), y hay clientes que comen
    // el botón o no dejan tocarlo. Un enlace que no se puede copiar deja al invitado sin camino, y
    // el enlace es justamente el camino garantizado de este flujo.
    //
    // Nada de esto se escapa a mano: `maquetarCorreo` escapa todo lo que recibe. Hacerlo acá además
    // dejaría el nombre de la clínica escrito como `Cl&#39;nica` en la pantalla del invitado.
    const html = maquetarCorreo({
      titulo: `Te invitaron a ${clinica}`,
      preheader: invita,
      parrafos: [
        "Hola,",
        invita,
        `El enlace vence en 7 días. Si todavía no tenés cuenta, vas a poder crearla con este mismo correo (${invitation.email}) y volver para aceptar.`,
      ],
      boton: { texto: "Aceptá la invitación", url: link },
      pie: ["Si no esperabas esta invitación, podés ignorar este correo."],
    })

    const result = await sendTransactionalEmail(
      p.clinic_id,
      { to: invitation.email, subject, html },
      sender,
    )

    if (!result.ok) {
      console.error(`[team/invite-email] no salió la invitación a ${invitation.email}:`, result.error)
      return NextResponse.json({ sent: false, reason: result.error ?? "Error desconocido" })
    }
    return NextResponse.json({ sent: true, to: invitation.email })
  } catch (e) {
    console.error("[team/invite-email] fallo inesperado:", e)
    return NextResponse.json({ sent: false, reason: (e as Error).message })
  }
}
