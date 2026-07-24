import Link from "next/link"
import { Stethoscope } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { AcceptInvitation } from "@/components/team/accept-invitation"
import { Button } from "@/components/ui/button"

export const metadata = { title: "Invitación · TuvetIA" }

// Página pública de aceptación de invitación. El lookup del token se hace server-side con
// service_role (la RLS de invitations es solo-admin) y solo se expone el nombre de la clínica.
export default async function InvitarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  let clinicName: string | null = null
  let invitedEmail: string | null = null
  try {
    const admin = createAdminClient()
    const { data: inv } = await admin
      .from("invitations")
      .select("email, clinic_id, accepted_at, expires_at")
      .eq("token", token)
      .maybeSingle()
    const invitation = inv as {
      email: string
      clinic_id: string
      accepted_at: string | null
      expires_at: string
    } | null
    if (invitation && !invitation.accepted_at && new Date(invitation.expires_at) > new Date()) {
      const { data: clinic } = await admin
        .from("clinics")
        .select("name")
        .eq("id", invitation.clinic_id)
        .maybeSingle()
      clinicName = (clinic as { name: string } | null)?.name ?? "una clínica"
      invitedEmail = invitation.email
    }
  } catch {
    // sin service_role configurado -> tratamos como inválida (mensaje genérico)
  }

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Stethoscope className="size-5" />
      </div>
      {children}
    </div>
  )

  if (!clinicName) {
    return shell(
      <>
        <h1 className="text-xl font-bold">Invitación no válida</h1>
        <p className="text-sm text-muted-foreground">
          Este link de invitación no existe, ya fue usado o expiró. Pedile a tu colega que te genere
          uno nuevo desde Configuración → Equipo.
        </p>
        <Button render={<Link href="/" />} variant="outline">
          Ir al inicio
        </Button>
      </>,
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const next = encodeURIComponent(`/invitar/${token}`)
    return shell(
      <>
        <h1 className="text-xl font-bold">Te invitaron a {clinicName}</h1>
        <p className="text-sm text-muted-foreground">
          Invitación para <b>{invitedEmail}</b>. Inicia sesión o crea tu cuenta con ese email y
          volverás aquí para aceptar.
        </p>
        <div className="flex gap-2">
          <Button render={<Link href={`/signup?next=${next}`} />}>Crear cuenta</Button>
          <Button variant="outline" render={<Link href={`/?next=${next}`} />}>
            Ya tengo cuenta
          </Button>
        </div>
      </>,
    )
  }

  // Con sesión: ¿ya pertenece a otra clínica? (aceptar lo MUEVE de clínica — advertir)
  const { data: prof } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle()
  const hasClinic = Boolean((prof as { clinic_id: string | null } | null)?.clinic_id)

  return shell(
    <>
      <h1 className="text-xl font-bold">Te invitaron a {clinicName}</h1>
      <AcceptInvitation token={token} clinicName={clinicName} hasClinic={hasClinic} />
    </>,
  )
}
