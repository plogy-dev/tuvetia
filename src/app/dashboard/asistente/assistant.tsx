"use client"

import { useEffect, useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import {
  DefaultChatTransport,
  getStaticToolName,
  isStaticToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai"
import { Bot, Loader2, Send } from "lucide-react"
import { toast } from "sonner"

import { renderInline, splitBlocks } from "@/components/athos/rich-text"
import { ActionApprovalCard } from "@/components/athos/action-approval-card"
import { ConnectEmailCard } from "@/components/athos/connect-email-card"
import { PendingActions } from "@/components/athos/pending-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import type { StoredThreads } from "@/lib/athos-history"
import { CONEXION_CORREO } from "@/lib/athos-agent/conversacion"

export type AssistantPatient = { id: string; name: string; species: string }

const GENERAL = "__general__" // valor del selector para "Consulta general (sin paciente)"

// Transport único hacia el agente Athos (/api/athos/agent, Vercel AI SDK). El patientId NO va
// aquí: cambia con el selector, así que viaja en el body de cada sendMessage.
const transport = new DefaultChatTransport({ api: "/api/athos/agent" })

// Etiquetas en español de las tools de LECTURA. Se usan MIENTRAS la tool corre ("Consultando X…")
// y para nombrar el fallo si algo sale mal — no para dejar constancia cuando sale bien.
// Las tools que no están aquí son de escritura: proponen acciones que el vet aprueba.
const READ_TOOL_LABELS: Record<string, string> = {
  search_patients: "pacientes de la clínica",
  get_patient_summary: "la ficha del paciente",
  get_owner_by_phone: "el titular por teléfono",
  list_appointments_on_day: "la agenda del día",
  get_clinic_hours: "los horarios de la clínica",
  list_available_slots: "los cupos disponibles",
  search_whatsapp_conversation: "la conversación de WhatsApp",
  search_emails: "tu correo",
  read_email_thread: "el hilo de correo",
  search_clinical_evidence: "la literatura veterinaria",
}

/**
 * ¿La tool falló porque falta conectar una cuenta?
 *
 * Es un fallo con SOLUCIÓN, no un error a informar: se rinde como tarjeta con el botón de conectar
 * en vez de una línea gris que el vet no puede accionar.
 */
function necesitaConexion(output: unknown): boolean {
  if (!output || typeof output !== "object") return false
  return (output as { needs_connection?: unknown }).needs_connection === CONEXION_CORREO
}

// Salida de una tool de ESCRITURA: la acción quedó registrada como PROPUESTA (ver
// lib/athos-agent/actions.ts) y se rinde como tarjeta de aprobación.
type ProposedOutput = { action_id: string; summary: string }

function asProposed(output: unknown): ProposedOutput | null {
  if (!output || typeof output !== "object") return null
  const o = output as Record<string, unknown>
  return typeof o.action_id === "string" && o.status === "proposed" && typeof o.summary === "string"
    ? { action_id: o.action_id, summary: o.summary }
    : null
}

function outputError(output: unknown): string | null {
  if (!output || typeof output !== "object") return null
  const e = (output as { error?: unknown }).error
  return typeof e === "string" ? e : null
}

// Bloques de texto del asistente con el formato de siempre (rich-text compartido). El agente cita
// las fuentes en el propio texto, así que renderInline va sin lista de citas.
/**
 * Quita las marcas `[[propuesto:…]]` que se persisten con el turno.
 *
 * Son contexto PARA EL MODELO —le muestran que ese turno sí llamó una herramienta, y no solo lo
 * dijo— pero no son contenido para el veterinario. Ver `turnoAGuardar` en conversacion.ts.
 */
function sinMarcas(texto: string): string {
  return texto
    .replace(/\s*\[\[propuesto:[a-z_,]+\]\]/g, "")
    // `sanearHistorial` agrega esta segunda marca a los turnos VIEJOS que afirmaban una propuesta
    // sin haberla registrado. Igual que la otra: contexto para el modelo, invisible para el vet.
    .replace(/\s*\[\[sin-propuesta:[^\]]*\]\]/g, "")
    .trim()
}

function TextBlocks({ text, kp }: { text: string; kp: string }) {
  const limpio = sinMarcas(text)
  if (!limpio) return null
  return (
    <div className="rounded-2xl rounded-tl-sm border bg-muted/50 px-4 py-1 text-sm leading-relaxed">
      {splitBlocks(limpio).map((blk, j) =>
        blk.heading ? (
          <div key={j} className="pt-3 pb-1 text-[13px] font-semibold tracking-tight">
            {renderInline(blk.text, [], `${kp}h${j}`)}
          </div>
        ) : blk.bullet ? (
          <div key={j} className="flex gap-2 border-b border-border/60 py-2 last:border-b-0 last:pb-0">
            <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-muted-foreground" />
            <div className="min-w-0 flex-1">{renderInline(blk.text, [], `${kp}b${j}`)}</div>
          </div>
        ) : (
          <div key={j} className="border-b border-border/60 py-2.5 last:border-b-0 last:pb-0">
            {renderInline(blk.text, [], `${kp}p${j}`)}
          </div>
        ),
      )}
    </div>
  )
}

// Render de un part de tool según su estado de streaming:
// - input-streaming / input-available → spinner pequeño (la tool está en curso)
// - output-available con {action_id, status:"proposed"} → tarjeta de aprobación
// - output-available de lectura → NADA (el proceso interno no es contenido para el vet)
// - output-error / {error} → línea discreta de fallo
function ToolPartView({ part }: { part: ToolUIPart }) {
  const toolName = String(getStaticToolName(part))
  const readLabel = READ_TOOL_LABELS[toolName]

  if (part.state === "input-streaming" || part.state === "input-available") {
    return (
      <div className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 shrink-0 animate-spin" />
        {readLabel ? `Consultando ${readLabel}…` : "Preparando una propuesta…"}
      </div>
    )
  }

  if (part.state === "output-error") {
    return (
      <div className="py-1 text-xs text-destructive">
        {readLabel ? `No se pudo consultar ${readLabel}` : "No se pudo preparar la propuesta"}: {part.errorText}
      </div>
    )
  }

  if (part.state === "output-available") {
    const proposed = asProposed(part.output)
    if (proposed) {
      return (
        <div className="py-1.5">
          <ActionApprovalCard
            action={{
              id: proposed.action_id,
              tool_name: toolName,
              summary: proposed.summary,
              payload: (part.input ?? {}) as Record<string, unknown>,
              status: "proposed",
            }}
          />
        </div>
      )
    }
    if (necesitaConexion(part.output)) {
      return (
        <div className="py-1.5">
          <ConnectEmailCard />
        </div>
      )
    }
    const err = outputError(part.output)
    if (err) {
      return (
        <div className="py-1 text-xs text-muted-foreground">
          {readLabel ? `No se pudo consultar ${readLabel}` : "No se pudo registrar la propuesta"}: {err}
        </div>
      )
    }
    // Una lectura que salió bien NO deja rastro en la conversación.
    //
    // Antes se quedaba un "Consultó la literatura veterinaria" permanente debajo de cada respuesta.
    // Eso es metadata de proceso, no contenido para el veterinario: le ensucia el hilo y compite con
    // lo que sí importa, que es la respuesta. El indicador de "Consultando…" mientras corre sí se
    // mantiene — ahí sí informa que el sistema está trabajando.
    //
    // Para depurar qué tools se usaron está el log del servidor y la traza en `rag_retrieval_log`.
    return null
  }

  return null
}

function AssistantMessage({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Bot className="size-4" />
      </div>
      <div className="flex max-w-[92%] flex-1 flex-col gap-1.5">
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return part.text ? <TextBlocks key={i} text={part.text} kp={`t${i}-`} /> : null
          }
          if (isStaticToolUIPart(part)) {
            return <ToolPartView key={part.toolCallId} part={part} />
          }
          return null // step-start, reasoning, etc.
        })}
        {streaming && (
          <div className="py-1">
            <span className="inline-block h-4 w-1.5 animate-pulse bg-foreground align-middle" />
          </div>
        )}
      </div>
    </div>
  )
}

// clinicId y patients llegan del server component (page.tsx): antes este componente hacía
// getUser -> profiles -> patients EN SERIE desde el navegador (3 round-trips al montar).
// clinicId entra solo por contrato de props: el agente deriva la clínica de la sesión.
export function Assistant({
  patients,
  threads = {},
  initialPatientId,
  saludo,
  contexto,
  riel,
}: {
  clinicId: string
  patients: AssistantPatient[]
  threads?: StoredThreads
  /** Paciente con el que abrir, del `?patient=` que pone el historial del sidebar. Ya viene
   *  validado contra los pacientes de la clínica. */
  initialPatientId?: string
  /** "Buenos días, María". Lo arma el server component, que es quien sabe la hora de Bogotá. */
  saludo?: string
  /** "Miércoles 5 de agosto · 9 citas · 2 cobros vencidos". Datos del día, no un eslogan. */
  contexto?: string
  /** El riel de configuración de la clínica. Se recibe ya renderizado desde el server component
   *  porque calcula el progreso con datos, y este componente es de cliente. */
  riel?: React.ReactNode
}) {
  const [patientId, setPatientId] = useState<string>(
    initialPatientId ?? patients[0]?.id ?? GENERAL,
  )
  const [input, setInput] = useState<string>("")
  const threadRef = useRef<HTMLDivElement>(null)

  // useChat contra el agente. Cambiar de paciente cambia el `id` → el hook crea un Chat nuevo, y
  // `messages` lo siembra con la conversación YA guardada de ese paciente. Antes se montaba vacío,
  // así que al recargar la página el veterinario perdía de vista el hilo aunque siguiera en la base.
  // La consulta general no tiene historial a propósito: el backend la trata como sin estado.
  const { messages, sendMessage, status, error, stop } = useChat({
    id: `athos-${patientId}`,
    messages: threads[patientId] ?? [],
    transport,
    onError: (e) => toast.error(`No se pudo consultar a Athos: ${e.message}`),
  })

  const busy = status === "submitted" || status === "streaming"

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [messages, status])

  const patient = patients.find((p) => p.id === patientId)
  const isGeneral = !patient // consulta general: sin ficha ni memoria de paciente

  function send() {
    const text = input.trim()
    if (!text) {
      toast.error("Escribe una pregunta.")
      return
    }
    if (busy) return
    setInput("")
    // El agente deriva la clínica de la sesión; aquí solo viaja el contexto de paciente.
    void sendMessage(
      { text },
      { body: { patientId: isGeneral ? null : patientId, source: "chat" } },
    )
  }

  const lastMessage = messages[messages.length - 1]

  return (
    // Llena el ancho en vez de ser una columna de 3xl centrada: al lado va el riel de la clínica, y
    // dos bloques centrados con aire a los costados leerían como dos páginas pegadas.
    <div className="flex h-[calc(100svh-var(--header-height))] min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
      {/* Encabezado: SALUDO CON DATOS, que es lo que el mockup pone acá. No dice "Athos" —
          el sidebar ya lo dice, y repetir el nombre de la sección gasta la línea más visible de la
          pantalla en información que el vet ya tiene. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[28px] font-medium leading-[1.2] tracking-[-0.01em] text-fg">
            {saludo ?? "Athos"}
          </h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            {contexto ?? "Athos propone — tú apruebas. Tu criterio decide."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {patient ? (
            <Badge variant="secondary">Contexto · {patient.name}</Badge>
          ) : (
            <Badge variant="outline">Consulta general</Badge>
          )}
          <Select
            value={patientId}
            onValueChange={(v) => {
              const nv = v ?? GENERAL
              if (nv === patientId) return // re-seleccionar lo mismo no borra el hilo
              void stop() // si había un stream en curso, córtalo antes de resetear
              setPatientId(nv) // el cambio de id de useChat resetea el hilo
            }}
            items={[
              { label: "Consulta general (sin paciente)", value: GENERAL },
              ...patients.map((p) => ({ label: `${p.name} · ${p.species}`, value: p.id })),
            ]}
          >
            <SelectTrigger size="sm" className="min-w-52">
              <SelectValue placeholder="Contexto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GENERAL}>Consulta general (sin paciente)</SelectItem>
              {patients.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} · {p.species}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {riel}

      {/* Aviso de contexto: memoria del hilo (con paciente) o consulta general */}
      <div className="flex items-center gap-2 rounded-lg border border-line-soft bg-brand-soft px-3 py-2 text-xs text-fg-muted">
        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-brand" />
        {patient ? (
          <span>
            <strong className="font-medium text-fg">Hilo con memoria</strong> — recuerdo el contexto
            de {patient.name} y las respuestas anteriores de esta conversación.
          </span>
        ) : (
          <span>
            <strong className="font-medium text-fg">Consulta general</strong> — respondo dudas médicas
            con literatura veterinaria citada, sin ficha de un paciente.
          </span>
        )}
      </div>

      {/* Hilo de conversación. Sin borde ni fondo propios: en el mockup la conversación no vive
          dentro de una card, ocupa la pantalla. El único borde de esta pantalla es el que separa
          el compositor abajo y el riel a la derecha. */}
      <div
        ref={threadRef}
        className="flex flex-1 flex-col gap-5 overflow-y-auto"
      >
        {messages.length === 0 && (
          <div className="m-auto flex max-w-md flex-col items-center gap-3 text-center">
            <Bot className="size-6 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">
              {patient
                ? `Pregúntame sobre ${patient.name} o una duda médica general. Puedo consultar su ficha, la agenda o la literatura, y proponerte acciones (citas, mensajes) que tú apruebas.`
                : "Pregúntame una duda médica general, o elige un paciente arriba para razonar con su ficha. Respondo con literatura citada y verificable — nunca un diagnóstico cerrado."}
            </p>
            {/* Sugerencias para arrancar. Sólo rellenan el cuadro de texto — no envían nada — y
                cada una pide algo que el agente sabe hacer con las tools que tiene. */}
            <div className="flex flex-wrap justify-center gap-1.5">
              {(patient
                ? [
                    `Resume la ficha de ${patient.name}`,
                    `¿Qué debería revisar hoy en ${patient.name}?`,
                    `Agenda un control para ${patient.name} la próxima semana`,
                  ]
                : [
                    "¿Qué citas hay hoy?",
                    "¿Cuáles son los horarios de la clínica?",
                    "¿Qué dice la literatura sobre otitis por Malassezia?",
                  ]
              ).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setInput(s)}
                  className="rounded-md border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) =>
          msg.role === "user" ? (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[82%] whitespace-pre-wrap rounded-2xl rounded-br-sm border bg-background px-4 py-2.5 text-sm">
                {msg.parts
                  .filter((p): p is Extract<(typeof msg.parts)[number], { type: "text" }> => p.type === "text")
                  .map((p) => p.text)
                  .join("")}
              </div>
            </div>
          ) : (
            <AssistantMessage
              key={msg.id}
              message={msg}
              streaming={status === "streaming" && msg.id === lastMessage?.id}
            />
          ),
        )}

        {status === "submitted" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Athos está pensando…
          </div>
        )}

        {error && (
          <div className="text-xs text-destructive">
            No se pudo consultar a Athos: {error.message}
          </div>
        )}

        {/* Lo que quedó esperando aprobación, leído de athos_actions. Las tarjetas del streaming
            se pierden al recargar (solo se persiste el texto del turno); esto no. */}
        <PendingActions recargarToken={messages.length} />
      </div>

      {/* Compositor. Franja separada por una línea, como en el mockup: la conversación termina y
          acá empieza la entrada. Antes era una card con sombra flotando sobre otra card. */}
      <div className="-mx-4 mt-auto border-t border-line px-4 pt-4 md:-mx-6 md:px-6">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send()
            }}
            rows={1}
            placeholder="Pedile algo a Athos — agenda el control de Luna la próxima semana"
            className="max-h-40 min-h-11 flex-1 resize-none"
          />
          <Button onClick={send} disabled={busy} variant="outline" className="h-11 shrink-0">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            <span className="hidden sm:inline">Enviar</span>
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-fg-faint">
          Athos propone — tú apruebas. Ninguna acción se ejecuta sin tu confirmación.
        </p>
      </div>
    </div>
  )
}
