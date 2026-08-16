"use client"

import { use, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  AudioLines,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileText,
  Loader2,
  Save,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"

import { athosPhantomSuggest, type Citation, type ConditionAlert } from "@/lib/athos"
import { createClient } from "@/lib/supabase/client"
import { parseTranscript } from "@/lib/transcript"
import { ConsultationRecorder } from "@/components/consultation-recorder"
import { Cuaderno } from "@/components/athos/cuaderno"
import { ConsultationThread } from "@/components/athos/consultation-thread"
import { renderInline, tramosIndivisibles } from "@/components/athos/rich-text"
import { SourceCard } from "@/components/athos/source-card"
import {
  esSevera,
  marcarAlergenos,
  resumenDeAlergias,
  SEVERIDAD_ALERGIA,
  type AlergiaRegistrada,
} from "@/lib/alergias"
import { HelpTip } from "@/components/help-tip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"

type Soap = { subjective: string; objective: string; assessment: string; plan: string }

type Note = {
  id: string
  status: string
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  allergy_gate_triggered: boolean
  citations: Citation[] | null
  // `ai_model` (el id crudo del modelo) NO se trae a propósito: hacia el vet la nota la redacta
  // Athos, sin nombrar el motor. La columna se sigue escribiendo — es rastro de auditoría — pero
  // sólo la lee /admin con service_role. Dejarla fuera del tipo hace que volver a pintarla no
  // compile, que es más fiable que acordarse de la regla.
  ai_generated_at: string | null
}

type Consultation = {
  id: string
  status: string
  chief_complaint: string | null
  clinic_id: string
  patient_id: string
  patient: { name: string; species: string; owner_id: string | null } | null
}

const SOAP_FIELDS: { key: keyof Soap; label: string; hint: string }[] = [
  { key: "subjective", label: "Subjetivo", hint: "Motivo y relato del titular" },
  { key: "objective", label: "Objetivo", hint: "Hallazgos del examen físico" },
  { key: "assessment", label: "Análisis", hint: "Impresión — lenguaje de posibilidad" },
  { key: "plan", label: "Plan", hint: "Conducta y siguientes pasos" },
]

/** Quita las referencias crudas de chunk que las notas viejas embebían en el texto. */
function limpiarNota(raw: string): string {
  return raw
    .replace(/\s*\(chunk_id:[^)]*\)/gi, "")
    .replace(/\s*\[[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{18,}\]/gi, "")
}

// Render de la nota (solo lectura): delega en el render compartido (negritas, citas [n] enlazadas,
// posibilidad).
function renderNote(raw: string, citations: Citation[], kp: string) {
  return renderInline(limpiarNota(raw), citations, kp)
}

/**
 * Igual que `renderNote`, pero encendiendo en rojo cada mención de algo a lo que el paciente es
 * alérgico.
 *
 * ES LA PIEZA DEL MOCKUP QUE FALTABA, y la única de la lista que evita un daño real. La alerta de
 * alergia existía, pero vivía en un panel arriba de la pantalla y no nombraba el fármaco. Acá la
 * contraindicación aparece dentro de la frase que la propone, que es donde se decide prescribir.
 *
 * No la escribe ningún modelo: sale de cruzar `allergies` con el texto. El chequeo da lo mismo cada
 * vez que se abre la nota.
 */
function renderPlan(
  raw: string,
  citations: Citation[],
  kp: string,
  alergias: AlergiaRegistrada[],
) {
  const texto = limpiarNota(raw)
  const trozos = marcarAlergenos(texto, alergias, tramosIndivisibles(texto))
  return trozos.map((t, i) =>
    t.alergeno ? (
      // `<mark>` y no un `<span>` con color: para un lector de pantalla esto ES una marca sobre el
      // texto, y el `title` dice por qué está marcada — el color solo no le llega a quien no lo ve.
      <mark
        key={`${kp}-al${i}`}
        title={`Alergia registrada: ${t.alergeno.allergen}${
          SEVERIDAD_ALERGIA[t.alergeno.severity] ? ` (${SEVERIDAD_ALERGIA[t.alergeno.severity]})` : ""
        }`}
        className={`rounded-sm px-0.5 font-semibold ${
          esSevera(t.alergeno)
            ? "bg-danger-soft text-destructive"
            : "bg-warn-soft text-warn"
        }`}
      >
        {renderInline(t.texto, citations, `${kp}-al${i}`)}
      </mark>
    ) : (
      renderInline(t.texto, citations, `${kp}-t${i}`)
    ),
  )
}

export default function NotaConsultaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [supabase] = useState(() => createClient())

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [gateAck, setGateAck] = useState(false)
  const [consultation, setConsultation] = useState<Consultation | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [alerts, setAlerts] = useState<ConditionAlert[]>([])
  const [alergias, setAlergias] = useState<AlergiaRegistrada[]>([])
  const [transcript, setTranscript] = useState<string>("")
  const [soap, setSoap] = useState<Soap>({ subjective: "", objective: "", assessment: "", plan: "" })
  const [captureOpen, setCaptureOpen] = useState(true) // panel colapsable de grabación/transcripción

  const load = useCallback(async () => {
    const { data: c, error: cErr } = await supabase
      .from("consultations")
      .select("id, status, chief_complaint, clinic_id, patient_id, patient:patients(name, species, owner_id)")
      .eq("id", id)
      .single()
    if (cErr || !c) {
      // RLS, id inexistente o fallo de red: estado de error visible, no una pantalla a medias.
      console.error("No se pudo cargar la consulta:", cErr)
      setLoadError(true)
      setLoading(false)
      return
    }
    setLoadError(false)
    setConsultation(c as unknown as Consultation | null)

    // Las alergias registradas del paciente, para marcarlas DENTRO del plan.
    //
    // El gate (`allergy_gate_triggered`) es un booleano: dice que hay una alergia severa y no dice
    // CUÁL. El vet leía "revisá el plan considerando esta alergia severa" sin que la pantalla
    // nombrara nunca el fármaco. Esto trae el nombre, que es lo que hace accionable la alerta.
    //
    // Va después del select de la consulta porque necesita su `patient_id`.
    const patientId = (c as unknown as Consultation).patient_id
    if (patientId) {
      const { data: al } = await supabase
        .from("allergies")
        .select("allergen, severity, reaction")
        .eq("patient_id", patientId)
      setAlergias((al ?? []) as unknown as AlergiaRegistrada[])
    }

    const { data: t } = await supabase
      .from("transcripts")
      .select("full_text")
      .eq("consultation_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    setTranscript((t as { full_text: string | null } | null)?.full_text ?? "")

    // `alerts` (migración 0004, ya aplicada al principal) viaja en el MISMO select de la nota:
    // antes era un 5º round-trip aparte a la misma fila.
    const { data: n } = await supabase
      .from("clinical_notes")
      .select(
        "id, status, subjective, objective, assessment, plan, allergy_gate_triggered, citations, ai_generated_at, alerts",
      )
      .eq("consultation_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (n) {
      const parsed = n as unknown as Note & { alerts?: ConditionAlert[] }
      setNote(parsed)
      setSoap({
        subjective: parsed.subjective ?? "",
        objective: parsed.objective ?? "",
        assessment: parsed.assessment ?? "",
        plan: parsed.plan ?? "",
      })
      if (Array.isArray(parsed.alerts)) setAlerts(parsed.alerts)
    }
    // Con nota ya generada, el foco es la nota: el panel de grabación/transcripción arranca plegado.
    setCaptureOpen(!n)
    setLoading(false)
  }, [supabase, id])

  useEffect(() => {
    // load() es async: todos sus setState ocurren después de awaits (nunca síncronos en el effect).
    // El compilador de React no traza a través del async y lo marca igual — falso positivo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function generate() {
    if (!consultation) return
    setGenerating(true)
    try {
      const res = await athosPhantomSuggest({ consultationId: id, clinicId: consultation.clinic_id })
      setAlerts(res.alerts ?? [])
      // La sugerencia está lista para la revisión del vet -> avanza el estado de la consulta.
      await supabase
        .from("consultations")
        .update({ status: "review", updated_at: new Date().toISOString() })
        .eq("id", id)
      toast.success("Sugerencia generada por el Modo Fantasma")
      await load()
    } catch (e) {
      toast.error(`No se pudo generar la sugerencia: ${(e as Error).message}`)
    } finally {
      setGenerating(false)
    }
  }

  async function save() {
    if (!note) return
    setSaving(true)
    const { error } = await supabase
      .from("clinical_notes")
      .update({ ...soap, updated_at: new Date().toISOString() })
      .eq("id", note.id)
    setSaving(false)
    if (error) toast.error(`No se pudo guardar: ${error.message}`)
    else toast.success("Cambios guardados")
  }

  async function approve() {
    if (!note) return
    // Gate de alergia severa: bloqueante. No se aprueba hasta que el vet confirme que revisó el plan.
    //
    // Este `if` es la cortesía, no la barrera. Desde la migración 0054 quien decide es un trigger:
    // pasar de borrador a aprobada con el gate disparado y sin `allergy_acknowledged_at` lo rechaza
    // Postgres. Antes esto era lo ÚNICO que lo impedía, y un update desde la consola lo saltaba.
    if (note.allergy_gate_triggered && !gateAck) {
      toast.error("Confirma que revisaste la alergia severa antes de aprobar la nota.")
      return
    }
    setApproving(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { error } = await supabase
      .from("clinical_notes")
      .update({
        ...soap,
        status: "approved",
        approved_by: user?.id,
        approved_at: new Date().toISOString(),
        // La constancia de que se revisó la alergia va en la MISMA escritura que la aprobación: si
        // fueran dos, entre una y otra habría un instante con la nota firmada y sin constancia.
        ...(note.allergy_gate_triggered ? { allergy_acknowledged_at: new Date().toISOString() } : {}),
      })
      .eq("id", note.id)
    if (error) {
      setApproving(false)
      toast.error(`No se pudo aprobar: ${error.message}`)
      return
    }
    // Cierra el ciclo: la nota entró a la historia -> consulta 'completed'.
    // (open->transcribing->generating_note lo pone el backend en /athos/transcribe;
    //  aquí nuestro flujo del Phantom la lleva a 'completed' al aprobar. Ver seam en la bitácora.)
    await supabase
      .from("consultations")
      .update({
        status: "completed",
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
    setApproving(false)
    toast.success("Nota aprobada y añadida a la historia clínica")
    await load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-16 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Cargando consulta…
      </div>
    )
  }

  if (loadError || !consultation) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 px-4 py-16 text-center">
        <p className="text-sm font-medium">No se pudo cargar la consulta.</p>
        <p className="text-sm text-muted-foreground">
          Puede que no exista, que no tengas acceso o que haya un problema de conexión.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setLoading(true); void load() }}>
            Reintentar
          </Button>
          <Button variant="ghost" render={<Link href="/dashboard/consultas" />}>
            Volver a consultas
          </Button>
        </div>
      </div>
    )
  }

  const approved = note?.status === "approved"
  const citations = note?.citations ?? []
  const turns = parseTranscript(transcript)
  const pet = consultation?.patient
  const initial = (pet?.name ?? "?").charAt(0).toUpperCase()

  return (
    // `consulta` = superficie GRAFITO. Es el segundo contexto del sistema de diseño v2: el CRM va en
    // blanco y la consulta abierta en oscuro. No es estética — es lo que separa el "cockpit" de la
    // consulta del resto de la app, y de un vistazo dice si estás con un paciente delante o no.
    //
    // La clase sólo reasigna variables (`globals.css`), así que TODO lo de adentro —cards, badges,
    // el hilo de Athos, los bloques del calendario— se repinta heredando. Ningún componente de acá
    // sabe en qué contexto está, que es justamente el punto.
    //
    // El padding que antes tenía el contenedor centrado sube a este: `dashboard/layout.tsx` no pone
    // ninguno alrededor de `{children}`, así que el grafito tiene que llegar solo hasta el borde del
    // área de contenido. Si el padding se quedara adentro, quedaría un marco blanco alrededor.
    <div className="consulta flex flex-1 flex-col px-4 py-4 md:py-6 lg:px-6">
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 md:gap-5">
      <Link
        href="/dashboard/consultas"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Volver a consultas
      </Link>

      {/* UNA SOLA COLUMNA, y es lo que pidió el cliente el 12-ago: «la distribución de paneles
          centralizarla del lado izquierdo, es una vaina mucho más tranquila».

          Antes eran dos: la consulta a la izquierda y el hilo de Athos ocupando un tercio fijo a la
          derecha, sticky, siempre visible. Ese tercio es justo donde David quiere el transcripto —
          «aquí me suelta el transcripto en esta parte de acá hasta acá». El hilo baja al final,
          plegado: sigue estando, deja de competir. */}
      <div className="flex min-w-0 flex-col gap-4 md:gap-5">

      {/* Cabecera del paciente */}
      <div className="rounded-xl border bg-card p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-secondary text-xl font-bold">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
              {consultation ? (
                <Link
                  href={`/dashboard/patients/${consultation.patient_id}`}
                  className="underline-offset-4 hover:underline"
                  title={`Abrir la ficha clínica de ${pet?.name ?? "este paciente"}`}
                >
                  {pet?.name ?? "Consulta"}
                </Link>
              ) : (
                pet?.name ?? "Consulta"
              )}
            </h1>
            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {pet?.species && <span className="font-medium text-foreground">{pet.species}</span>}
              <span>{consultation?.chief_complaint ?? "Consulta"}</span>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border bg-secondary px-2.5 py-1 text-xs font-medium">
            <span className={`size-1.5 rounded-full ${approved ? "bg-foreground" : "bg-muted-foreground"}`} />
            {note ? (approved ? "Aprobada" : "Borrador — requiere aprobación") : "Sin nota"}
          </span>
          {note?.ai_generated_at && (
            <span className="inline-flex items-center gap-1.5 rounded-md border bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
              Redactada por <span className="text-foreground">Athos</span>
            </span>
          )}
          {note && (
            <span className="inline-flex items-center gap-1.5 rounded-md border bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-muted-foreground" />
              {citations.length > 0 ? "Evidencia suficiente" : "Sin literatura citada"}
            </span>
          )}
        </div>
      </div>

      {/* Alertas de la consulta: gate de alergia (bloqueante) + condiciones relevantes */}
      {(note?.allergy_gate_triggered || alerts.length > 0) && (
        <section className="rounded-xl border bg-card p-4 md:p-5">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
            Alertas de la consulta
          </p>
          <div className="flex flex-col gap-3">
            {/* Gate de alergia severa — CRÍTICO, bloquea la aprobación */}
            {note?.allergy_gate_triggered && (
              <details open className="group overflow-hidden rounded-lg border border-destructive/40 bg-card">
                <summary className="flex cursor-pointer list-none items-center gap-3 border-l-4 border-l-destructive bg-danger-soft p-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-destructive text-destructive-foreground">
                    <AlertTriangle className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-destructive">
                      Alergia severa · bloqueante
                    </span>
                    <span className="block font-semibold">Alergia severa registrada — revisa antes del plan</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground">
                    Ver
                    <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <div className="border-t p-4 text-sm leading-relaxed">
                  <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Fuente: ficha del paciente (determinístico, no del modelo)
                  </p>
                  <p>
                    <span className="mr-1.5 rounded-md bg-secondary px-2 py-0.5 text-[11px] font-bold uppercase text-foreground">
                      En {pet?.name ?? "este paciente"}
                    </span>
                    {/* NOMBRA EL FÁRMACO. El gate es un booleano en la nota, así que este panel
                        decía "hay una alergia severa registrada" y mandaba a revisar el plan sin
                        decir nunca contra qué. Los nombres salen de `allergies`, la misma tabla que
                        dispara el gate. Si por lo que sea no cargaron, cae al texto de antes en vez
                        de dejar el hueco. */}
                    {alergias.some(esSevera) ? (
                      <>
                        Alergia severa registrada:{" "}
                        <strong>{resumenDeAlergias(alergias.filter(esSevera))}</strong>. Evita ese
                        fármaco y su clase en cualquier plan.
                      </>
                    ) : (
                      <>
                        Hay una <strong>alergia severa</strong> registrada en su historia. Evita el
                        fármaco implicado y su clase en cualquier plan.
                      </>
                    )}{" "}
                    Esta alerta <strong>bloquea la aprobación</strong> de la nota hasta tu revisión.
                  </p>
                  {!approved && (
                    <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-medium">
                      <Checkbox
                        checked={gateAck}
                        onCheckedChange={(checked) => setGateAck(checked === true)}
                      />
                      Confirmo que revisé el plan considerando esta alergia severa
                    </label>
                  )}
                </div>
              </details>
            )}

            {/* Condiciones relevantes — no bloqueantes, panel "afectaciones en este paciente" */}
            {alerts.map((a, i) => (
              <details key={`${a.condition}-${i}`} className="group overflow-hidden rounded-lg border bg-card">
                <summary className="flex cursor-pointer list-none items-center gap-3 border-l-4 border-l-muted-foreground bg-secondary p-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                    <Activity className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Condición relevante
                    </span>
                    <span className="block font-semibold">{a.condition}</span>
                  </span>
                  {a.detail && (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground">
                      Ver afectaciones
                      <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                    </span>
                  )}
                </summary>
                {a.detail && (
                  <div className="border-t p-4 text-sm leading-relaxed">
                    <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                      Explicación generada · anclada a la literatura recuperada
                    </p>
                    <p>
                      <span className="mr-1.5 rounded-md bg-secondary px-2 py-0.5 text-[11px] font-bold uppercase text-foreground">
                        En {pet?.name ?? "este paciente"}
                      </span>
                      {a.detail}
                    </p>
                  </div>
                )}
              </details>
            ))}
          </div>
        </section>
      )}

      {/* TRANSCRIPTO Y CUADERNO, LADO A LADO. Es la secuencia que describió el cliente palabra por
          palabra: «aquí me suelta el transcripto en esta parte de acá hasta acá. Y en esta parte me
          pone un cuaderno para tomar notas yo. Y acá quedan las notas clínicas».

          Es también la forma que ya tenía el panel flotante, así que ahora las dos superficies se
          parecen en vez de competir.

          En un teléfono se apilan y el CUADERNO VA PRIMERO (`flex-col-reverse`): ahí no caben las
          dos, y entre releer lo que se acaba de decir y poder anotar, lo segundo es lo que no se
          puede hacer en ningún otro lado. */}
      <div className="flex flex-col-reverse gap-4 md:gap-5 lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
      {((consultation && !approved) || turns.length > 0) && (
        <details
          open={captureOpen}
          onToggle={(e) => setCaptureOpen((e.currentTarget as HTMLDetailsElement).open)}
          className="group rounded-xl border bg-card"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AudioLines className="size-4 text-muted-foreground" /> Grabación y transcripción de la consulta
            </div>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-4 border-t p-4">
            {/* El grabador solo aparece al INICIAR la consulta (aún sin transcripción); después,
                la nota trabaja con la grabación/transcripción ya tomada. */}
            {consultation && !approved && turns.length === 0 && (
              <ConsultationRecorder
                consultationId={id}
                clinicId={consultation.clinic_id}
                patientId={consultation.patient_id}
                ownerId={pet?.owner_id}
                patientName={pet?.name}
                motivo={consultation.chief_complaint}
                onTranscribed={load}
              />
            )}
            {turns.length === 0 ? (
              <p className="text-sm text-muted-foreground">Esta consulta aún no tiene transcripción.</p>
            ) : (
              <div className="flex max-h-[45vh] flex-col gap-2.5 overflow-y-auto">
                {turns.map((t, i) => (
                  <div key={i} className={t.who === "vet" ? "flex flex-col items-end" : "flex flex-col items-start"}>
                    <span className="mb-0.5 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t.who === "vet" ? "Veterinario" : "Titular"}
                    </span>
                    <div
                      className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${
                        t.who === "vet"
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm border bg-background"
                      }`}
                    >
                      {t.text}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}

      {/* El cuaderno NO va dentro del `<details>` de la captura, aunque esté a su lado: es lo que
          el vet escribe él, y esconderlo detrás del mismo plegable que la transcripción lo trataría
          como un anexo de la grabación.

          Se muestra aunque la nota ya esté aprobada, y editable: es material de trabajo, no la
          historia clínica, y agregarle algo después no altera nada que se haya firmado. */}
      {consultation && (
        <Cuaderno consultaId={id} filas={10} className="rounded-xl border bg-card p-4 md:p-5" />
      )}
      </div>

      {/* Nota clínica (SOAP) — una columna */}
      <section className="flex flex-col rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="size-4 text-muted-foreground" /> Nota clínica
            <HelpTip>
              Athos redacta la nota SOAP a partir de la transcripción, con literatura veterinaria
              citada y verificable. Es un <b>borrador</b>: revisala, editala y aprobala — nada entra
              a la historia sin tu aprobación.
            </HelpTip>
          </div>
          {note && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Sparkles className="size-3" /> {approved ? "Aprobada" : "Athos redacta · borrador"}
            </Badge>
          )}
        </div>

        {!note ? (
          <div className="flex flex-col items-center gap-4 px-4 py-14 text-center">
            <Sparkles className="size-8 text-muted-foreground" />
            <div>
              <p className="font-medium">Aún no hay nota para esta consulta</p>
              <p className="text-sm text-muted-foreground">
                Genera una sugerencia SOAP con literatura veterinaria citada a partir de la
                transcripción.
              </p>
            </div>
            <Button onClick={generate} disabled={generating}>
              {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Generar sugerencia (Modo Fantasma)
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-4 md:p-6">
            {SOAP_FIELDS.map((f) => (
              <div key={f.key} className="flex gap-3">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border bg-secondary text-sm font-bold">
                  {f.label.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {f.label}
                    </span>
                    <span className="text-xs text-muted-foreground">{f.hint}</span>
                  </div>
                  {approved ? (
                    // ANCHO DE LECTURA. Sin el tope esto corría a 84 caracteres por línea medidos
                    // en producción a 1440px — y como no tenía `max-width`, seguía creciendo con el
                    // monitor. Es el mismo defecto que se corrigió en el hilo del chat, sobre el
                    // texto que más se lee del producto: la nota que el vet revisa antes de firmar.
                    // 70ch queda dentro del rango cómodo y cerca de los 75ch de la transcripción.
                    <p className="max-w-[70ch] text-sm leading-relaxed whitespace-pre-wrap">
                      {soap[f.key] ? (
                        f.key === "plan" ? (
                          renderPlan(soap[f.key], citations, f.key, alergias)
                        ) : (
                          renderNote(soap[f.key], citations, f.key)
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </p>
                  ) : (
                    <Textarea
                      value={soap[f.key]}
                      onChange={(e) => setSoap((s) => ({ ...s, [f.key]: e.target.value }))}
                      rows={f.key === "assessment" || f.key === "plan" ? 4 : 2}
                    />
                  )}
                  {/* LA ADVERTENCIA VA SIEMPRE QUE HAYA ALERGIA, mencione el plan el fármaco o no.
                      El resaltado de arriba sólo se enciende si el texto lo nombra; el riesgo que
                      importa es el otro — que el plan prescriba algo de la misma clase con otro
                      nombre y nada en pantalla diga contra qué revisar.

                      Y va también mientras se EDITA, que es cuando el vet todavía puede cambiar la
                      conducta: dentro de un <textarea> no se puede resaltar nada, así que sin esta
                      línea la revisión sería justo el momento sin aviso. */}
                  {f.key === "plan" && alergias.length > 0 && (
                    <p
                      className={`mt-2 flex items-start gap-1.5 text-xs font-medium ${
                        alergias.some(esSevera) ? "text-destructive" : "text-warn"
                      }`}
                    >
                      <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
                      <span>
                        Alergias registradas de {pet?.name ?? "este paciente"}:{" "}
                        {resumenDeAlergias(alergias)}. Evita el fármaco implicado y su clase.
                      </span>
                    </p>
                  )}
                </div>
              </div>
            ))}

            {/* LAS FUENTES, ENUMERADAS. Hasta hoy la única forma de saber qué era `[3]` era pasarle
                el mouse por encima y leer el `title`. Un hover no sobrevive a imprimir la nota, a
                exportarla ni a leerla desde el teléfono — y esto es una historia clínica, no un
                chat. `SourceCard` estaba construida para esto desde el principio y nunca se había
                montado en ninguna pantalla.

                Sólo con la nota APROBADA: mientras es borrador las citas todavía pueden cambiar —
                la verificación de fidelidad descarta referencias después de generar. */}
            {approved && citations.length > 0 && (
              <div className="flex flex-col gap-2 border-t pt-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Fuentes ({citations.length})
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {citations.map((c, i) => (
                    <SourceCard key={`fuente-${i}`} c={c} />
                  ))}
                </div>
              </div>
            )}

            {!approved && (
              <p className="text-xs text-muted-foreground">
                Se guardará en la ficha de <b className="text-foreground">{pet?.name}</b> cuando
                apruebes. Ninguna nota entra a la historia sin tu aprobación.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={save} disabled={saving || approved}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Guardar cambios
              </Button>
              <Button
                onClick={approve}
                disabled={approving || approved || (note.allergy_gate_triggered && !gateAck)}
              >
                {approving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                {approved ? "Nota aprobada" : "Revisar y aprobar"}
              </Button>
              {note.ai_generated_at && (
                <span className="ml-auto text-xs text-muted-foreground">Redactada por Athos</span>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Referencias citadas — lista numerada estilo mockup */}
      {note && (
        <section className="rounded-xl border bg-card p-4 md:p-5">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
            Referencias citadas ({citations.length})
          </p>
          {citations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin evidencia suficiente: esta nota no cita literatura (Athos se abstiene antes que
              inventar una fuente).
            </p>
          ) : (
            <ol className="flex flex-col divide-y">
              {citations.map((c, i) => (
                <li key={`${c.chunk_id}-${i}`} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="grid size-6 shrink-0 place-items-center rounded-md border bg-secondary font-mono text-[11px] font-bold">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    {c.title && <div className="text-sm font-medium leading-snug">{c.title}</div>}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      {c.source && <span className="font-medium text-foreground/80">{c.source}</span>}
                      {c.year && <span className="font-mono">{c.year}</span>}
                      {c.locator && <span>· {c.locator}</span>}
                    </div>
                    {c.url && (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-foreground underline underline-offset-2 hover:text-foreground/80"
                      >
                        Abrir artículo <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
      </div>

      {/* Hilo del copiloto embebido (columna derecha del mockup) */}
      {consultation && (
        <ConsultationThread
          clinicId={consultation.clinic_id}
          patientId={consultation.patient_id}
          patientName={pet?.name}
        />
      )}
      </div>
    </div>
  )
}
