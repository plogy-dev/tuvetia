"use client"

// Botón de aceptar la invitación (con sesión activa). Llama la RPC accept_invitation, que asigna
// clinic_id + rol al profile y marca la invitación como aceptada.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

export function AcceptInvitation({
  token,
  clinicName,
  hasClinic,
}: {
  token: string
  clinicName: string
  hasClinic: boolean
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [accepting, setAccepting] = useState(false)

  async function accept() {
    setAccepting(true)
    const { error } = await supabase.rpc("accept_invitation", { invite_token: token })
    if (error) {
      setAccepting(false)
      toast.error(`No se pudo aceptar: ${error.message}`)
      return
    }
    toast.success(`¡Bienvenido a ${clinicName}!`)
    router.push("/dashboard")
    router.refresh()
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {hasClinic && (
        <p className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
          Ya perteneces a otra clínica. Al aceptar, se agrega <b>{clinicName}</b> a tus clínicas y
          pasa a ser tu clínica activa.
        </p>
      )}
      <Button onClick={accept} disabled={accepting}>
        {accepting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
        Aceptar y unirme a {clinicName}
      </Button>
    </div>
  )
}
