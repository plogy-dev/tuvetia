"use client"

// Tarjeta de aprobación de una acción propuesta por Athos: el vet la ve, puede editar el texto
// (si es un mensaje), y Aprobar (ejecuta bajo SU sesión) o Rechazar. Ambas transiciones quedan
// en athos_actions + audit_logs.

import { useState } from "react"
import { CalendarPlus, Check, ClipboardEdit, Loader2, MessageCircle, PawPrint, Sparkles, UserPlus, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export type ProposedAction = {
  id: string
  tool_name: string
  summary: string
  payload: Record<string, unknown>
  status: string
  created_at?: string
}

const TOOL_LABELS: Record<string, { label: string; icon: typeof MessageCircle }> = {
  send_whatsapp_message: { label: "Mensaje de WhatsApp", icon: MessageCircle },
  create_appointment: { label: "Nueva cita", icon: CalendarPlus },
  update_appointment: { label: "Cambio de cita", icon: CalendarPlus },
  create_owner: { label: "Nuevo titular", icon: UserPlus },
  create_patient: { label: "Nuevo paciente", icon: PawPrint },
  create_owner_and_patient: { label: "Titular + paciente", icon: PawPrint },
  update_patient_record: { label: "Actualizar ficha", icon: ClipboardEdit },
}

export function ActionApprovalCard({
  action,
  onResolved,
}: {
  action: ProposedAction
  onResolved?: (id: string, status: "executed" | "rejected" | "failed") => void
}) {
  const editable = action.tool_name === "send_whatsapp_message"
  const [body, setBody] = useState(editable ? String(action.payload.body ?? "") : "")
  const [busy, setBusy] = useState<"execute" | "reject" | null>(null)
  const [resolved, setResolved] = useState<string | null>(action.status !== "proposed" ? action.status : null)

  async function act(kind: "execute" | "reject") {
    setBusy(kind)
    try {
      const res = await fetch(`/api/athos/actions/${action.id}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "execute" && editable && body.trim() !== String(action.payload.body ?? "")
            ? { payload_override: { body: body.trim() } }
            : {},
        ),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      const status = kind === "execute" ? "executed" : "rejected"
      setResolved(status)
      onResolved?.(action.id, status)
      toast.success(kind === "execute" ? "Acción ejecutada" : "Propuesta rechazada")
    } catch (e) {
      toast.error((e as Error).message)
      if (kind === "execute") {
        setResolved("failed")
        onResolved?.(action.id, "failed")
      }
    } finally {
      setBusy(null)
    }
  }

  const meta = TOOL_LABELS[action.tool_name] ?? { label: action.tool_name, icon: Sparkles }
  const Icon = meta.icon

  return (
    <div className="rounded-xl border border-line bg-card p-3 text-sm shadow-sm">
      <div className="mb-1.5 flex items-center gap-2">
        <Sparkles className="size-3.5 text-brand" />
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Athos propone · {meta.label}
        </span>
      </div>
      <p className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        <span>{action.summary}</span>
      </p>
      {editable && !resolved && (
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="mt-2 min-h-20 text-sm"
          aria-label="Texto del mensaje propuesto (editable)"
        />
      )}
      {resolved ? (
        <p className="mt-2 text-xs font-medium text-fg-muted">
          {resolved === "executed" ? "✓ Ejecutada" : resolved === "rejected" ? "✗ Rechazada" : "⚠ Falló — revisa e intenta de nuevo"}
        </p>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={() => act("execute")} disabled={busy !== null || (editable && !body.trim())}>
            {busy === "execute" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Aprobar{action.tool_name === "send_whatsapp_message" ? " y enviar" : ""}
          </Button>
          <Button size="sm" variant="outline" onClick={() => act("reject")} disabled={busy !== null}>
            {busy === "reject" ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
            Rechazar
          </Button>
        </div>
      )}
    </div>
  )
}
