"use client"

// "Borrar datos de ejemplo". Vivía dentro de `dashboard/onboarding-checklist.tsx`, que el riel de
// configuración reemplazó.
//
// Va suelto y no dentro del riel a propósito: el riel se retira solo al llegar al 100%, y los datos
// de ejemplo pueden seguir ahí después. Metido adentro, "Luna (ejemplo)" se volvería imborrable
// desde la interfaz justo cuando la clínica ya está configurada y más molesta.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

export function BorrarEjemplo() {
  const router = useRouter()
  const [borrando, setBorrando] = useState(false)

  async function borrar() {
    setBorrando(true)
    try {
      const res = await fetch("/api/onboarding/demo-data", { method: "DELETE" })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      toast.success("Datos de ejemplo eliminados")
      router.refresh()
    } catch (e) {
      toast.error(`No se pudo borrar el ejemplo: ${(e as Error).message}`)
    } finally {
      setBorrando(false)
    }
  }

  return (
    <div className="px-4 lg:px-6">
      <Button size="sm" variant="ghost" onClick={borrar} disabled={borrando} className="text-fg-muted">
        {borrando ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        Borrar datos de ejemplo
      </Button>
    </div>
  )
}
