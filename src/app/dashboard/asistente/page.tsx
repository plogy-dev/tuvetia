"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, BookText, Bot, Loader2, Send } from "lucide-react"
import { toast } from "sonner"

import { athosChat, type Citation } from "@/lib/athos"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type Patient = { id: string; name: string; species: string }

// Resalta el lenguaje de posibilidad (regla clínica: nunca diagnóstico cerrado).
const POSSIBILITY =
  /(compatible con|sugestivo de|sugerente de|no hay evidencia suficiente|evidencia insuficiente|posiblemente|posible|podría|sugiere|se recomienda valorar)/i
function highlight(text: string) {
  const parts = text.split(new RegExp(`(${POSSIBILITY.source})`, "gi"))
  return parts.map((p, i) =>
    POSSIBILITY.test(p) ? (
      <span key={i} className="font-medium text-foreground underline decoration-dotted decoration-muted-foreground/60 underline-offset-2">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}

// Tarjeta de fuente verificable (mismo lenguaje visual que la propuesta, con nuestros tokens).
function SourceCard({ c }: { c: Citation }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <div className="mb-1 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Fuente verificable
      </div>
      <div className="text-sm leading-relaxed">
        <span className="font-medium">{c.source ?? "Fuente"}</span>
        {c.locator && <span className="text-muted-foreground"> · {c.locator}</span>}
        <span className="text-muted-foreground"> · {c.doc_id}</span>
      </div>
    </div>
  )
}

export default function AsistentePage() {
  const [clinicId, setClinicId] = useState<string>("")
  const [patients, setPatients] = useState<Patient[]>([])
  const [patientId, setPatientId] = useState<string>("")
  const [question, setQuestion] = useState<string>("")
  const [asked, setAsked] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [warning, setWarning] = useState<string>("")
  const [answer, setAnswer] = useState<string>("")
  const [citations, setCitations] = useState<Citation[]>([])
  const [insufficient, setInsufficient] = useState(false)
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
  }, [answer, asked])

  const patient = patients.find((p) => p.id === patientId)
  const blocks = answer.split(/\n{2,}|\n(?=[-•])/).map((b) => b.trim()).filter(Boolean)

  async function ask() {
    const q = question.trim()
    if (!q || !patientId || !clinicId) {
      toast.error("Elige un paciente y escribe una pregunta.")
      return
    }
    setLoading(true)
    setAsked(q)
    setQuestion("")
    setWarning("")
    setAnswer("")
    setCitations([])
    setInsufficient(false)
    await athosChat(
      { question: q, patientId, clinicId },
      {
        onWarning: (t) => setWarning(t),
        onToken: (t) => setAnswer((prev) => prev + t),
        onDone: (d) => {
          setCitations(d.citations)
          setInsufficient(d.insufficient_evidence)
          setLoading(false)
        },
        onError: (e) => {
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
          <select
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {patients.length === 0 && <option value="">Sin pacientes</option>}
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.species}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Hilo de conversación */}
      <div
        ref={threadRef}
        className="flex flex-1 flex-col gap-4 overflow-y-auto rounded-xl border bg-card/40 p-4"
      >
        {!asked && !loading && (
          <div className="m-auto max-w-sm text-center text-sm text-muted-foreground">
            <Bot className="mx-auto mb-2 size-6 opacity-50" />
            Pregúntame sobre un caso. Respondo con literatura citada y verificable — nunca un diagnóstico
            cerrado.
          </div>
        )}

        {asked && (
          <div className="flex justify-end">
            <div className="max-w-[82%] rounded-2xl rounded-br-sm border bg-background px-4 py-2.5 text-sm">
              {asked}
            </div>
          </div>
        )}

        {warning && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{warning}</span>
          </div>
        )}

        {(answer || loading) && (
          <div className="flex gap-2.5">
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Bot className="size-4" />
            </div>
            <div className="max-w-[92%] flex-1">
              <div className="rounded-2xl rounded-tl-sm border bg-muted/50 px-4 py-1 text-sm leading-relaxed">
                {blocks.map((b, i) => (
                  <div key={i} className="border-b border-border/60 py-2.5 last:border-b-0">
                    {highlight(b)}
                  </div>
                ))}
                {loading && (
                  <div className="py-2.5">
                    <span className="inline-block h-4 w-1.5 animate-pulse bg-foreground align-middle" />
                  </div>
                )}
              </div>

              {insufficient && (
                <Badge variant="outline" className="mt-2">
                  Evidencia insuficiente
                </Badge>
              )}

              {citations.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <BookText className="size-3.5" /> Fuentes citadas ({citations.length})
                  </div>
                  {citations.map((c) => (
                    <SourceCard key={c.chunk_id} c={c} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 rounded-xl border bg-background p-2 shadow-xs">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask()
          }}
          rows={1}
          placeholder="Escribe tu consulta clínica…  (Ctrl/⌘ + Enter para enviar)"
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm focus-visible:outline-none"
        />
        <Button size="icon" onClick={ask} disabled={loading} aria-label="Enviar">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  )
}
