"use client"

// Botón "volver a ver la bienvenida".
//
// Hasta ahora no había forma de repetir el onboarding: los dos flags sólo avanzan (`mark_onboarded`
// y `mark_setup_completed` hacen `set ... where ... is null`, no existe el inverso) y el tour tiene
// además su propio candado en `localStorage`. Consecuencia práctica: nadie del equipo podía volver
// a verlo para probarlo, y un vet que se lo saltó de apuro lo perdía para siempre.
//
// No hace falta migración: la policy `profiles_update` deja que el propio usuario edite su fila, y
// el guard de `0021_profiles_update_guard.sql` sólo blinda `clinic_id` y `role`. Estos dos campos
// son suyos.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

export function RepetirOnboarding() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function repetir() {
    setBusy(true)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      toast.error("Tu sesión expiró. Vuelve a entrar.")
      setBusy(false)
      return
    }

    const { error } = await supabase
      .from("profiles")
      .update({ setup_completed_at: null, onboarded_at: null })
      .eq("id", user.id)
    if (error) {
      toast.error(`No se pudo reiniciar: ${error.message}`)
      setBusy(false)
      return
    }

    // Los candados del navegador van aparte de la base: sin esto el tour seguiría sin aparecer.
    localStorage.removeItem("tuvetia_onboarding_seen")
    localStorage.removeItem("tuvetia_checklist_dismissed")

    router.push("/bienvenida")
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
      <div>
        <div className="text-sm font-semibold">Volver a ver la bienvenida</div>
        <p className="text-sm text-muted-foreground">
          Repite la configuración inicial y el recorrido guiado. No borra nada de lo que ya cargaste.
        </p>
      </div>
      <Button variant="outline" onClick={repetir} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
        Repetir
      </Button>
    </div>
  )
}
