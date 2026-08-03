"use client"

// Tarjeta que aparece EN EL CHAT cuando Athos necesita el correo del veterinario y todavía no está
// conectado.
//
// Antes ese caso salía como una línea gris de error debajo de la respuesta. Es el peor lugar donde
// dejarlo: el vet acaba de pedir algo concreto ("mandale un correo a la dueña de Luna"), y lo que
// recibe es un texto que no puede accionar y que además no le dice a dónde ir. Acá se conecta sin
// salir de la conversación, y al volver retoma lo que estaba haciendo.

import { useState } from "react"
import { Mail, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

export function ConnectEmailCard() {
  const [busy, setBusy] = useState(false)

  async function conectar() {
    setBusy(true)
    try {
      const res = await fetch("/api/composio/gmail/connect", { method: "POST" })
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || !json.url) throw new Error(json.error ?? `HTTP ${res.status}`)
      window.location.href = json.url
    } catch (e) {
      toast.error(`No se pudo iniciar la conexión: ${(e as Error).message}`)
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-card p-3.5 text-sm shadow-sm">
      <div className="mb-1.5 flex items-center gap-2">
        <Mail className="size-4 shrink-0 text-brand" aria-hidden />
        <span className="font-medium text-fg">Conectá tu correo para que pueda escribir por vos</span>
      </div>
      <p className="mb-3 text-fg-muted">
        Uso <b>tu</b> cuenta, no una de la clínica: el titular recibe el correo de vos y te responde a
        vos. Nunca escribo sin que lo apruebes antes.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={conectar} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" aria-hidden />}
          Conectar mi Gmail
        </Button>
        <span className="text-xs text-fg-faint">Es un clic — no hace falta contraseña.</span>
      </div>
    </div>
  )
}
