"use client"

// Envío individual desde la fila del usuario. Molde de `settings/team-settings.tsx`:
// confirmar → acción → `router.refresh()`.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Mail } from "lucide-react"
import { toast } from "sonner"

import { enviarCorreoPlataforma } from "@/app/admin/usuarios/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function SendEmailDialog({
  to,
  nombre,
  configurado,
}: {
  to: string
  nombre: string | null
  configurado: boolean
}) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [subject, setSubject] = useState("")
  const [text, setText] = useState("")
  const [enviando, setEnviando] = useState(false)

  if (!configurado) {
    return (
      <Button size="sm" variant="ghost" disabled title="El correo de plataforma no está configurado">
        <Mail className="size-4" />
      </Button>
    )
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!subject.trim() || !text.trim()) return
    // Confirmar: el correo sale de verdad, a una persona real, en cuanto se aprieta.
    if (!window.confirm(`¿Enviar este correo a ${to}?`)) return

    setEnviando(true)
    const res = await enviarCorreoPlataforma({ to, subject, text })
    setEnviando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(res.mensaje)
    setAbierto(false)
    setSubject("")
    setText("")
    router.refresh()
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setAbierto((v) => !v)} title={`Escribir a ${to}`}>
        <Mail className="size-4" />
      </Button>
      {abierto && (
        <form
          onSubmit={enviar}
          className="absolute right-0 z-20 mt-1 flex w-80 flex-col gap-2 rounded-lg border bg-popover p-3 shadow-popover"
        >
          <div className="text-xs text-muted-foreground">
            Para: <span className="font-medium text-foreground">{nombre ?? to}</span> · {to}
          </div>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Asunto"
            maxLength={200}
            autoFocus
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Mensaje…"
            rows={6}
            maxLength={20000}
            className="w-full rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <div className="flex items-center justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={enviando || !subject.trim() || !text.trim()}>
              {enviando ? <Loader2 className="size-4 animate-spin" /> : "Enviar"}
            </Button>
          </div>
        </form>
      )}
    </>
  )
}
