"use client"

// Envío masivo a usuarios de la plataforma. Deliberadamente incómodo de disparar: hay que elegir
// destinatarios uno por uno (o "todos"), y confirmar escribiendo el número de destinatarios. Un
// masivo mal dirigido no se puede deshacer.

import { useState } from "react"
import { Loader2, Send, Users } from "lucide-react"
import { toast } from "sonner"

import { enviarCorreoMasivo } from "@/app/admin/usuarios/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type DestinatarioMasivo = { email: string; nombre: string | null; clinica: string | null }

export function BulkEmailPanel({
  candidatos,
  configurado,
  tope,
}: {
  candidatos: DestinatarioMasivo[]
  configurado: boolean
  tope: number
}) {
  const [abierto, setAbierto] = useState(false)
  const [elegidos, setElegidos] = useState<Set<string>>(new Set())
  const [subject, setSubject] = useState("")
  const [text, setText] = useState("")
  const [confirmacion, setConfirmacion] = useState("")
  const [enviando, setEnviando] = useState(false)

  const total = elegidos.size
  const excede = total > tope
  const confirmado = confirmacion.trim() === String(total) && total > 0
  const listo = configurado && confirmado && !excede && !!subject.trim() && !!text.trim()

  function alternar(email: string) {
    setElegidos((prev) => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email)
      else next.add(email)
      return next
    })
    setConfirmacion("")
  }

  function todos() {
    setElegidos((prev) =>
      prev.size === candidatos.length ? new Set() : new Set(candidatos.map((c) => c.email)),
    )
    setConfirmacion("")
  }

  async function enviar() {
    if (!listo) return
    setEnviando(true)
    const res = await enviarCorreoMasivo({
      destinatarios: [...elegidos],
      subject,
      text,
    })
    setEnviando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    if (res.fallidos.length === 0) {
      toast.success(`Enviado a ${res.enviados} ${res.enviados === 1 ? "persona" : "personas"}.`)
    } else {
      toast.warning(
        `Enviado a ${res.enviados}. Falló en ${res.fallidos.length}: ${res.fallidos
          .slice(0, 3)
          .map((f) => f.email)
          .join(", ")}${res.fallidos.length > 3 ? "…" : ""}`,
      )
    }
    setElegidos(new Set())
    setSubject("")
    setText("")
    setConfirmacion("")
    setAbierto(false)
  }

  if (!abierto) {
    return (
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)} disabled={!configurado}>
        <Users className="size-4" /> Envío masivo
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">Envío masivo</div>
          <p className="text-xs text-muted-foreground">
            Para <b>avisos operativos</b> a usuarios del producto (mantenimiento, cambios,
            incidencias).
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setAbierto(false)}>
          Cerrar
        </Button>
      </div>

      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
        <b>No lo uses para contenido comercial.</b> Eso exige base legal (Ley 1581), registro de
        consentimiento y enlace de baja — y nada de eso está construido todavía. Antes de la primera
        tanda, verificá SPF y DKIM del dominio: sin eso, los rebotes queman la reputación para{" "}
        <i>todo</i> el correo del producto, incluidas las facturas de las clínicas.
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium">
            Destinatarios ({total}/{candidatos.length})
          </span>
          <Button variant="ghost" size="sm" onClick={todos} className="h-6 text-xs">
            {total === candidatos.length ? "Ninguno" : "Todos"}
          </Button>
        </div>
        <div className="max-h-52 overflow-y-auto rounded-lg border">
          {candidatos.map((c) => (
            <label
              key={c.email}
              className="flex cursor-pointer items-center gap-2 border-b px-2.5 py-1.5 text-sm last:border-b-0 hover:bg-muted/50"
            >
              <input
                type="checkbox"
                checked={elegidos.has(c.email)}
                onChange={() => alternar(c.email)}
                className="size-3.5"
              />
              <span className="min-w-0 flex-1 truncate">{c.nombre ?? c.email}</span>
              <span className="truncate text-xs text-muted-foreground">{c.email}</span>
              {c.clinica && (
                <span className="shrink-0 text-[10px] text-muted-foreground">{c.clinica}</span>
              )}
            </label>
          ))}
        </div>
        {excede && (
          <p className="mt-1 text-xs text-destructive">
            Máximo {tope} por tanda. Por encima de eso hace falta una cola de verdad: esto corre en
            una función serverless y un lote grande se corta a mitad sin saber por dónde iba.
          </p>
        )}
      </div>

      <Input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Asunto"
        maxLength={200}
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Mensaje…"
        rows={7}
        maxLength={20000}
        className="w-full rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="text-xs text-muted-foreground">
            Escribí <b className="text-foreground">{total}</b> para confirmar
          </label>
          <Input
            value={confirmacion}
            onChange={(e) => setConfirmacion(e.target.value)}
            placeholder={String(total)}
            className="mt-1"
          />
        </div>
        <Button onClick={enviar} disabled={!listo || enviando}>
          {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Enviar a {total}
        </Button>
      </div>
      {enviando && (
        <p className="text-xs text-muted-foreground">
          Enviando con pausa entre correos para no disparar el rate limit del SMTP. No cierres la
          pestaña.
        </p>
      )}
    </div>
  )
}
