"use client"

// Tarjeta de aprobación de una acción propuesta por Athos: el vet la ve, puede editar el texto
// (si es un mensaje), y Aprobar (ejecuta bajo SU sesión) o Rechazar. Ambas transiciones quedan
// en athos_actions + audit_logs.

import { useState } from "react"
import { CalendarPlus, Check, ClipboardEdit, Loader2, Mail, MessageCircle, PawPrint, Sparkles, UserPlus, X } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { camposDeAccion } from "@/lib/athos-agent/detalle-accion"

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
  send_email: { label: "Correo", icon: Mail },
  reply_email: { label: "Respuesta por correo", icon: Mail },
}

/**
 * Qué campos del payload puede editar el vet antes de aprobar, por tool.
 *
 * Antes esto era un booleano cableado a `send_whatsapp_message` con un único `<Textarea>` sobre
 * `payload.body`. Un correo necesita destinatario y asunto además del cuerpo, así que se declara
 * por tool.
 *
 * En los dos correos el destinatario ES editable, y a propósito: el modelo lo saca de lo que leyó
 * del hilo, y si se equivocó de dirección el vet tiene que poder corregirlo ANTES de aprobar — no
 * después, cuando el correo ya salió. Lo que no está en esta lista no se puede tocar.
 */
type CampoEditable = { campo: string; label: string; multilinea: boolean; ayuda?: string }

const CAMPOS_EDITABLES: Record<string, CampoEditable[]> = {
  send_whatsapp_message: [{ campo: "body", label: "Texto del mensaje", multilinea: true }],
  send_email: [
    { campo: "to_email", label: "Para", multilinea: false },
    { campo: "subject", label: "Asunto", multilinea: false },
    { campo: "body", label: "Mensaje", multilinea: true },
  ],
  reply_email: [
    {
      campo: "to_email",
      label: "Para",
      multilinea: false,
      ayuda: "Tiene que ser alguien del hilo — al aprobar se verifica contra Gmail.",
    },
    { campo: "subject", label: "Asunto", multilinea: false },
    { campo: "body", label: "Respuesta", multilinea: true },
  ],
}

/** Tools cuyo efecto es mandarle algo a alguien: el botón lo dice ("Aprobar y enviar"). */
const ENVIA = new Set(["send_whatsapp_message", "send_email", "reply_email"])

// Estados finales tal como los ve el vet. `approved` es intermedio: la ruta de ejecución RESERVA
// la acción (compare-and-set) antes de despachar, así que una fila puede quedarse ahí si el
// proceso se interrumpe justo en el medio. En ese caso el efecto pudo haber ocurrido o no — por
// eso no decimos "intentá de nuevo", que era el consejo que daba antes al caer en el genérico.
const RESOLVED_LABELS: Record<string, string> = {
  executed: "✓ Ejecutada",
  rejected: "✗ Rechazada",
  failed: "⚠ Falló — revisa e intenta de nuevo",
  expired: "⌛ Expiró — pedile a Athos una nueva",
  approved: "⏳ Quedó a medio ejecutar — verificá el resultado antes de repetirla",
}

export function ActionApprovalCard({
  action,
  onResolved,
}: {
  action: ProposedAction
  onResolved?: (id: string, status: "executed" | "rejected" | "failed") => void
}) {
  const campos = CAMPOS_EDITABLES[action.tool_name] ?? []
  const editable = campos.length > 0
  // La lista `etiqueta → valor` del mockup. Se calcula del payload, no del resumen: el resumen es
  // prosa que arma la tool y deja campos afuera (ver `detalle-accion.ts`). Para los tools de
  // mensajería viene vacía, porque sus campos ya se pintan editables acá abajo.
  const detalle = camposDeAccion(action.tool_name, action.payload)
  // Valores de trabajo, sembrados del payload propuesto. Se comparan contra el original al aprobar
  // para mandar SOLO lo que el vet tocó.
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(campos.map((c) => [c.campo, String(action.payload[c.campo] ?? "")])),
  )
  const [busy, setBusy] = useState<"execute" | "reject" | null>(null)
  const [resolved, setResolved] = useState<string | null>(action.status !== "proposed" ? action.status : null)
  const [aviso, setAviso] = useState<{ texto: string; enlace: string | null } | null>(null)

  /** Solo los campos que el vet cambió; si no tocó nada, no se manda override. */
  function overrideEditado(): Record<string, string> | null {
    const cambios: Record<string, string> = {}
    for (const c of campos) {
      const nuevo = valores[c.campo]?.trim() ?? ""
      if (nuevo !== String(action.payload[c.campo] ?? "")) cambios[c.campo] = nuevo
    }
    return Object.keys(cambios).length > 0 ? cambios : null
  }

  async function act(kind: "execute" | "reject") {
    setBusy(kind)
    try {
      const override = kind === "execute" && editable ? overrideEditado() : null
      const res = await fetch(`/api/athos/actions/${action.id}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(override ? { payload_override: override } : {}),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        result?: { aviso?: string; aviso_enlace?: string }
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      const status = kind === "execute" ? "executed" : "rejected"
      setResolved(status)
      onResolved?.(action.id, status)
      // Un aviso NO es un error: la acción se ejecutó. Es algo que el vet necesita saber igual —
      // p.ej. que la cita no llegó a Google porque no está conectado. Sin esto la cita "desaparece"
      // de su teléfono y no hay forma de saber por qué.
      const aviso = json.result?.aviso
      if (aviso) {
        setAviso({ texto: aviso, enlace: json.result?.aviso_enlace ?? null })
        toast.warning(aviso)
      } else {
        toast.success(kind === "execute" ? "Acción ejecutada" : "Propuesta rechazada")
      }
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
    // FORMA DEL MOCKUP: borde de acento, franja menta arriba, y el descargo abajo. Sin sombra —el
    // sistema sólo permite la de popovers— y con tope de 640px: una propuesta es un formulario corto,
    // no un panel que cruza la pantalla.
    //
    // OJO AL TOCAR ESTO: es sólo el envoltorio. `act()`, `overrideEditado()`, `valores` y los enlaces
    // a `/api/athos/actions/[id]/execute|reject` quedan exactamente como estaban. Lo que cambia es
    // dónde se dibujan, no qué hacen.
    <div className="max-w-[640px] overflow-hidden rounded-xl border border-brand text-sm">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line bg-brand-soft px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-text">
          Acción propuesta
        </span>
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon aria-hidden className="size-4 shrink-0" />
          {meta.label}
        </span>
      </div>

      <div className="flex flex-col gap-3 px-4 py-3.5">
      <p>{action.summary}</p>
      {/* LA LISTA DE DEFINICIÓN DEL MOCKUP. Se sigue mostrando después de resuelta: es la
          constancia de qué se aprobó exactamente, y una tarjeta que borra sus datos al ejecutarse
          deja al vet sin forma de verificar lo que acaba de autorizar.

          `sm:` en la grilla porque en un teléfono dos columnas dejan al valor con 12 caracteres de
          ancho; ahí la etiqueta va encima. */}
      {detalle.length > 0 && (
        <dl className="grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)]">
          {detalle.map((c) => (
            <div key={c.etiqueta} className="contents">
              <dt className="text-fg-muted">{c.etiqueta}</dt>
              <dd className="min-w-0 break-words whitespace-pre-wrap">{c.valor}</dd>
            </div>
          ))}
        </dl>
      )}
      {editable && !resolved && (
        <div className="flex flex-col gap-2">
          {/* La etiqueta va VISIBLE, no sólo de placeholder: el placeholder desaparece en cuanto el
              campo tiene valor, y estos nacen llenos. El vet veía una caja con un correo adentro sin
              nada que dijera que ése era el destinatario — justo el dato que más conviene que mire
              antes de aprobar. */}
          {campos.map((c) => (
            <label key={c.campo} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">{c.label}</span>
              {c.multilinea ? (
                <Textarea
                  value={valores[c.campo] ?? ""}
                  onChange={(e) => setValores((v) => ({ ...v, [c.campo]: e.target.value }))}
                  className="min-h-20 text-sm"
                  aria-label={`${c.label} (editable)`}
                />
              ) : (
                <Input
                  value={valores[c.campo] ?? ""}
                  onChange={(e) => setValores((v) => ({ ...v, [c.campo]: e.target.value }))}
                  className="text-sm"
                  placeholder={c.label}
                  aria-label={`${c.label} (editable)`}
                />
              )}
              {c.ayuda && <span className="text-[11px] text-fg-muted">{c.ayuda}</span>}
            </label>
          ))}
        </div>
      )}
      {resolved ? (
        <>
          <p className="text-xs font-medium text-fg-muted">{RESOLVED_LABELS[resolved] ?? RESOLVED_LABELS.failed}</p>
          {aviso && (
            <p className="text-xs text-warn">
              {aviso.texto}{" "}
              {aviso.enlace && (
                <Link href={aviso.enlace} className="font-medium underline underline-offset-2">
                  Conectar Google Calendar
                </Link>
              )}
            </p>
          )}
        </>
      ) : (
        // El descargo va DENTRO de la tarjeta y pegado a los botones, como en el mockup: es la
        // frase que responde "¿qué pasa si le doy?" en el momento exacto en que se hace esa
        // pregunta. Suelto en otra parte de la pantalla, no lo lee nadie.
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => act("execute")}
              // Ningún campo editable puede quedar vacío: aprobar un correo sin asunto o sin cuerpo
              // fallaría recién en el servidor, después de haber dicho "Aprobar".
              disabled={busy !== null || campos.some((c) => !(valores[c.campo] ?? "").trim())}
            >
              {busy === "execute" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Aprobar{ENVIA.has(action.tool_name) ? " y enviar" : ""}
            </Button>
            <Button size="sm" variant="outline" onClick={() => act("reject")} disabled={busy !== null}>
              {busy === "reject" ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
              Descartar
            </Button>
          </div>
          <p className="text-[13px] text-fg-muted">
            {ENVIA.has(action.tool_name)
              ? "Athos no escribe al titular hasta que usted apruebe."
              : "Athos no ejecuta nada hasta que usted apruebe."}
          </p>
        </div>
      )}
      </div>
    </div>
  )
}
