"use client"

// Envío masivo a usuarios de la plataforma. Deliberadamente incómodo de disparar: hay que elegir
// destinatarios uno por uno (o "todos"), y confirmar escribiendo el número de destinatarios. Un
// masivo mal dirigido no se puede deshacer.

import { useMemo, useState } from "react"
import { Eye, Loader2, Send, Users } from "lucide-react"
import { toast } from "sonner"

import { enviarCorreoMasivo } from "@/app/admin/usuarios/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PLANTILLAS, huecos, plantillaPorId, rellenar } from "@/lib/email/plantillas"

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
  const [valores, setValores] = useState<Record<string, string>>({})

  // LO QUE SE MANDA ES LO QUE SE VE, y por eso sale de la misma función que arma la vista previa
  // (`lib/email/plantillas`). Si el preview se armara por su cuenta, mostraría un texto y saldría
  // otro — y el masivo se firma mirando el preview.
  const asuntoFinal = useMemo(() => rellenar(subject, valores), [subject, valores])
  const cuerpoFinal = useMemo(() => rellenar(text, valores), [text, valores])
  const sinLlenar = useMemo(() => huecos(asuntoFinal, cuerpoFinal), [asuntoFinal, cuerpoFinal])

  const total = elegidos.size
  const excede = total > tope
  const confirmado = confirmacion.trim() === String(total) && total > 0
  const listo =
    configurado && confirmado && !excede && !!asuntoFinal.trim() && !!cuerpoFinal.trim() &&
    sinLlenar.length === 0

  function elegirPlantilla(id: string) {
    const p = plantillaPorId(id)
    if (!p) return
    setSubject(p.asunto)
    setText(p.cuerpo)
    // Los campos arrancan vacíos a propósito: un valor de ejemplo precargado es exactamente lo que
    // termina saliendo sin que nadie lo mire.
    setValores({})
    setConfirmacion("")
  }

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
      subject: asuntoFinal,
      text: cuerpoFinal,
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
    setValores({})
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

      <div className="rounded-lg border border-warn/40 bg-warn-soft p-3 text-xs">
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

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Plantilla:</span>
        {PLANTILLAS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => elegirPlantilla(p.id)}
            title={p.para}
            className="rounded-full border px-2.5 py-1 text-xs transition hover:bg-muted"
          >
            {p.nombre}
          </button>
        ))}
        <span className="text-xs text-muted-foreground">o escribilo a mano abajo.</span>
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

      {sinLlenar.length > 0 && (
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-xs font-medium">Completá los datos de la plantilla</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {sinLlenar.map((h) => (
              <label key={h} className="text-xs text-muted-foreground">
                {h}
                <Input
                  value={valores[h] ?? ""}
                  onChange={(e) => setValores((v) => ({ ...v, [h]: e.target.value }))}
                  placeholder={`{{${h}}}`}
                  className="mt-1"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* LA VISTA PREVIA NO ES UN ADORNO: es lo único que enseña el correo entero antes de que salga
          a doce cuentas, y muestra EXACTAMENTE el texto que se manda —el mismo `rellenar`— con los
          huecos que falten todavía a la vista. */}
      {(asuntoFinal.trim() || cuerpoFinal.trim()) && (
        <div className="rounded-lg border bg-background p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Eye className="size-3.5" /> Así les va a llegar
          </p>
          <p className="mt-2 text-sm font-semibold">{asuntoFinal || "(sin asunto)"}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{cuerpoFinal}</p>
          {sinLlenar.length > 0 && (
            <p className="mt-2 text-xs text-destructive">
              Todavía hay {sinLlenar.length === 1 ? "un dato" : "datos"} sin completar:{" "}
              {sinLlenar.map((h) => `{{${h}}}`).join(", ")}. No se puede enviar así.
            </p>
          )}
        </div>
      )}

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
