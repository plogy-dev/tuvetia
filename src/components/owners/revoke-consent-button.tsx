"use client"

// Revocatoria del consentimiento de grabación de un titular (Ley 1581: puede retirarlo cuando
// quiera). RPC revoke_owner_consent — a partir de ahí el grabador vuelve a preguntar en cada
// consulta. Confirmación inline para evitar clics accidentales.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, ShieldOff } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

export function RevokeConsentButton({ ownerId, ownerName }: { ownerId: string; ownerName: string }) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function revoke() {
    setBusy(true)
    const { error } = await supabase.rpc("revoke_owner_consent", { p_owner_id: ownerId })
    setBusy(false)
    setConfirming(false)
    if (error) {
      toast.error(`No se pudo revocar: ${error.message}`)
      return
    }
    toast.success(`Consentimiento de ${ownerName} revocado — se volverá a pedir en cada consulta`)
    router.refresh()
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button size="xs" variant="destructive" onClick={revoke} disabled={busy}>
          {busy ? <Loader2 className="size-3 animate-spin" /> : "Sí, revocar"}
        </Button>
        <Button size="xs" variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
          No
        </Button>
      </span>
    )
  }

  return (
    <Button
      size="xs"
      variant="ghost"
      className="text-destructive hover:text-destructive"
      onClick={() => setConfirming(true)}
      title="Revocar el consentimiento de grabación de este titular"
    >
      <ShieldOff className="size-3" /> Revocar
    </Button>
  )
}
