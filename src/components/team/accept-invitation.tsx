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
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          Ya perteneces a una clínica. Al aceptar, <b>pasarás a formar parte de {clinicName}</b> y
          dejarás de ver los datos de tu clínica actual.
        </p>
      )}
      <Button onClick={accept} disabled={accepting}>
        {accepting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
        Aceptar y unirme a {clinicName}
      </Button>
    </div>
  )
}
