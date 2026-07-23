"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, BookText, Bot, Loader2, Send } from "lucide-react"
import { toast } from "sonner"

import { athosChat, type Citation } from "@/lib/athos"
import { createClient } from "@/lib/supabase/client"
import { SourceCard } from "@/components/athos/source-card"
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

type Patient = { id: string; name: string; species: string }

// Un turno del hilo. El backend mantiene la memoria por (clinica, paciente); aquí acumulamos la
// conversación para que el vet la vea completa (antes era de un solo turno).
type Msg = {
  role: "user" | "assistant"
  content: string
  warning?: string
  citations?: Citation[]
  insufficient?: boolean
  streaming?: boolean
}

// Resalta el lenguaje de posibilidad (regla clínica: nunca diagnóstico cerrado).
const POSSIBILITY =
  /(compatible con|sugestivo de|sugerente de|no hay evidencia suficiente|evidencia insuficiente|posiblemente|posible|podría|sugiere|se recomienda valorar)/i

// Renderiza un tramo de texto: enlaza los marcadores [n] a su cita y resalta el lenguaje de
// posibilidad. Devuelve nodos listos para React.
function renderRich(text: string, citations: Citation[]) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const cite = part.match(/^\[(\d+)\]$/)
    if (cite) {
      const c = citations[parseInt(cite[1], 10) - 1]
      const cls =
        "mx-px rounded bg-secondary px-1 align-super text-[10px] font-bold text-foreground"
      return c?.url ? (
        <a
          key={i}
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          title={c.title ?? c.source ?? "Ver fuente"}
          className={`${cls} underline decoration-dotted underline-offset-2 hover:bg-accent`}
        >
          [{cite[1]}]
        </a>
      ) : (
        <sup key={i} className={cls}>
          [{cite[1]}]
        </sup>
      )
    }
    return part.split(new RegExp(`(${POSSIBILITY.source})`, "gi")).map((p, j) =>
      POSSIBILITY.test(p) ? (
        <span
          key={`${i}-${j}`}
          className="font-medium text-foreground underline decoration-dotted decoration-muted-foreground/60 underline-offset-2"
        >
          {p}
        </span>
      ) : (
        <span key={`${i}-${j}`}>{p}</span>
      ),
    )
  })
}

export default function AsistentePage() {
  const [clinicId, setClinicId] = useState<string>("")
  const [patients, setPatients] = useState<Patient[]>([])
  const [patientId, setPatientId] = useState<string>("")
  const [question, setQuestion] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase
        .from("profiles")
        .select("clinic_id")
        .eq("id", user.id)
        .single()
      if (!profile?.clinic_id) return
      setClinicId(profile.clinic_id)
      const { data: pts } = await supabase
        .from("patients")
        .select("id,name,species")
        .eq("clinic_id", profile.clinic_id)
        .order("name")
      setPatients(pts ?? [])
      if (pts?.length) setPatientId(pts[0].id)
    })()
  }, [])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [messages])

  const patient = patients.find((p) => p.id === patientId)

  // Actualiza el último mensaje (el del asistente en curso) sin recrear el resto del hilo.
  const patchLast = (fn: (m: Msg) => Msg) =>
    setMessages((prev) => {
      const next = [...prev]
      next[next.length - 1] = fn(next[next.length - 1])
      return next
    })

  async function ask() {
    const q = question.trim()
    if (!q || !patientId || !clinicId) {
      toast.error("Elige un paciente y escribe una pregunta.")
      return
    }
    setLoading(true)
    setQuestion("")
    setMessages((prev) => [
      ...prev,
      { role: "user", content: q },
      { role: "assistant", content: "", streaming: true },
    ])
    await athosChat(
      { question: q, patientId, clinicId },
      {
        onWarning: (t) => patchLast((m) => ({ ...m, warning: t })),
        onToken: (t) => patchLast((m) => ({ ...m, content: m.content + t })),
        onDone: (d) => {
          patchLast((m) => ({
            ...m,
            citations: d.citations,
            insufficient: d.insufficient_evidence,
            streaming: false,
          }))
          setLoading(false)
        },
        onError: (e) => {
          patchLast((m) => ({
            ...m,
            content: m.content || "No se pudo consultar a Athos.",
            streaming: false,
          }))
          toast.error(`No se pudo consultar a Athos: ${(e as Error)?.message ?? e}`)
          setLoading(false)
        },
      },
    )
  }

  return (
    <div className="mx-auto flex h-[calc(100svh-var(--header-height))] w-full max-w-3xl flex-col gap-3 p-4 md:p-6">
      {/* Encabezado + contexto */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bot className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Copiloto clínico</h1>
            <p className="text-xs text-muted-foreground">
              Razona con la ficha y literatura veterinaria citada. Lenguaje de posibilidad, tu criterio decide.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {patient && <Badge variant="secondary">Contexto · {patient.name}</Badge>}
          <Select
            value={patientId}
            onValueChange={(v) => {
              setPatientId(v ?? "")
              setMessages([]) // nuevo paciente = hilo nuevo en pantalla
            }}
            items={patients.map((p) => ({
              label: `${p.name} · ${p.species}`,
              value: p.id,
            }))}
            disabled={patients.length === 0}
          >
            <SelectTrigger size="sm" className="min-w-40">
              <SelectValue placeholder={patients.length === 0 ? "Sin pacientes" : "Paciente"} />
            </SelectTrigger>
            <SelectContent>
              {patients.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} · {p.species}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Hilo de conversación (con memoria) */}
      <div
        ref={threadRef}
        className="flex flex-1 flex-col gap-4 overflow-y-auto rounded-xl border bg-card/40 p-4"
      >
        {messages.length === 0 && (
          <div className="m-auto max-w-sm text-center text-sm text-muted-foreground">
            <Bot className="mx-auto mb-2 size-6 opacity-50" />
            Pregúntame sobre un caso. Recuerdo el hilo de este paciente y respondo con literatura
            citada y verificable — nunca un diagnóstico cerrado.
          </div>
        )}

        {messages.map((msg, i) =>
          msg.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[82%] rounded-2xl rounded-br-sm border bg-background px-4 py-2.5 text-sm">
                {msg.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex gap-2.5">
              <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Bot className="size-4" />
              </div>
              <div className="max-w-[92%] flex-1">
                {msg.warning && (
                  <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>{msg.warning}</span>
                  </div>
                )}

                <div className="rounded-2xl rounded-tl-sm border bg-muted/50 px-4 py-1 text-sm leading-relaxed">
                  {msg.content
                    .split(/\n{2,}|\n(?=[-•])/)
                    .map((b) => b.trim())
                    .filter(Boolean)
                    .map((b, j) => (
                      <div key={j} className="border-b border-border/60 py-2.5 last:border-b-0">
                        {renderRich(b, msg.citations ?? [])}
                      </div>
                    ))}
                  {msg.streaming && (
                    <div className="py-2.5">
                      <span className="inline-block h-4 w-1.5 animate-pulse bg-foreground align-middle" />
                    </div>
                  )}
                </div>

                {msg.insufficient && (
                  <Badge variant="outline" className="mt-2">
                    Evidencia insuficiente
                  </Badge>
                )}

                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <BookText className="size-3.5" /> Fuentes citadas ({msg.citations.length})
                    </div>
                    {msg.citations.map((c) => (
                      <SourceCard key={c.chunk_id} c={c} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ),
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 rounded-xl border bg-background p-2 shadow-xs">
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask()
          }}
          rows={1}
          placeholder="Escribe tu consulta clínica…  (Ctrl/⌘ + Enter para enviar)"
          className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <Button size="icon" onClick={ask} disabled={loading} aria-label="Enviar">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  )
}
