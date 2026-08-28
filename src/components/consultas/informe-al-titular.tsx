"use client"

// "Entregar el informe al titular": el paso que faltaba al cerrar la consulta.
//
// LO QUE PASABA ANTES. La consulta terminaba con la nota aprobada y ahí moría. Lo que el dueño se
// llevaba a la casa era lo que hubiera alcanzado a entender en el mostrador — y la nota SOAP no le
// sirve: está escrita para otro veterinario.
//
// EL FLUJO, y el orden importa:
//
//   1. Se abre → VetGPT redacta un borrador a partir de la nota APROBADA.
//   2. **El vet lo lee y lo edita.** Todas las secciones son campos de texto, no un preview.
//   3. Elige cómo entregarlo: PDF (se abre la vista de impresión) o copiar al portapapeles.
//
// EL PASO 2 NO ES DECORATIVO, es la razón de que esto se pueda entregar. Lo que el modelo escribe
// es un borrador; lo que sale por la puerta es lo que una persona aprobó. Por eso se guarda DESPUÉS
// de editar y no antes — lo que queda en `client_reports` es el papel real, no el intento.
//
// Y SE GUARDA UNA FILA POR ENTREGA, no una por consulta. Si el vet manda el PDF y además copia el
// texto, son dos entregas: la auditoría tiene que poder decir qué se entregó y por dónde.

import { useEffect, useState } from "react"
import { ClipboardCopy, Loader2, MessageCircle, Printer, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { comoTextoPlano, type Informe } from "@/lib/informe-al-titular/armar"

const SECCIONES: { campo: keyof Informe; etiqueta: string; filas: number; ayuda?: string }[] = [
  { campo: "subject", etiqueta: "Asunto", filas: 1 },
  { campo: "salutation", etiqueta: "Saludo", filas: 1 },
  { campo: "body", etiqueta: "Qué le pasó", filas: 7 },
  { campo: "plan", etiqueta: "Qué hacer en casa", filas: 4 },
  {
    campo: "warnings",
    etiqueta: "Cuándo volver de urgencia",
    filas: 3,
    ayuda: "Es lo único que el dueño puede leer a las 3 de la mañana. Que sea concreto.",
  },
  { campo: "signature", etiqueta: "Firma", filas: 1 },
]

export function InformeAlTitular({
  consultaId,
  paciente,
  titular,
  abierto,
  alCerrar,
}: {
  consultaId: string
  paciente: string
  titular: string | null
  abierto: boolean
  alCerrar: () => void
}) {
  const [informe, setInforme] = useState<Informe | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generadoEn, setGeneradoEn] = useState<string | null>(null)
  const [entregando, setEntregando] = useState(false)

  // SE PIDE AL ABRIR. Redactar cuesta una llamada al modelo y cuenta contra el cupo de la clínica,
  // así que no se hace al cargar la consulta: se hace cuando alguien decide entregar un informe.
  useEffect(() => {
    if (!abierto) return
    const corte = new AbortController()
    Promise.resolve()
      .then(() => {
        setInforme(null)
        setError(null)
        return fetch("/api/informe-al-titular", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ consultation_id: consultaId }),
          signal: corte.signal,
        })
      })
      .then(async (r) => {
        const j = (await r.json()) as { informe?: Informe; generated_at?: string; error?: string }
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
        setInforme(j.informe ?? null)
        setGeneradoEn(j.generated_at ?? null)
      })
      .catch((e) => {
        if ((e as Error)?.name !== "AbortError") setError((e as Error).message)
      })
    return () => corte.abort()
  }, [abierto, consultaId])

  function editar(campo: keyof Informe, valor: string) {
    setInforme((i) => (i ? { ...i, [campo]: valor } : i))
  }

  /**
   * Guarda la entrega y devuelve si se pudo.
   *
   * LA FILA SE ESCRIBE ANTES DE ABRIR EL PDF, no después. Si se abriera primero, una pestaña
   * bloqueada por el navegador dejaría al vet creyendo que entregó algo que no quedó registrado —
   * y la auditoría vale justamente por lo que NO se puede olvidar de anotar.
   */
  async function registrar(channel: "pdf" | "clipboard"): Promise<boolean> {
    if (!informe) return false
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { data: prof } = user
      ? await supabase.from("profiles").select("clinic_id").eq("id", user.id).maybeSingle()
      : { data: null }
    const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
    if (!clinicId) {
      toast.error("No se encontró tu clínica")
      return false
    }
    const { error: e } = await supabase.from("client_reports").insert({
      clinic_id: clinicId,
      consultation_id: consultaId,
      created_by: user?.id ?? null,
      subject: informe.subject || `Informe de ${paciente}`,
      salutation: informe.salutation || null,
      body: informe.body,
      plan: informe.plan || null,
      warnings: informe.warnings || null,
      signature: informe.signature || null,
      channel,
      generated_at: generadoEn ?? new Date().toISOString(),
    })
    if (e) {
      toast.error(`No se pudo registrar la entrega: ${e.message}`)
      return false
    }
    return true
  }

  // Los tres botones de entrega comparten `entregando`. `enviarPorWhatsApp` ya lo reponía en un
  // `finally`; estos dos lo hacían a mano, y `registrar()` llama a `auth.getUser()`, que LANZA.
  // Un rechazo dejaba los tres deshabilitados hasta cerrar y reabrir el diálogo.
  async function entregarPdf() {
    setEntregando(true)
    let ok = false
    try {
      ok = await registrar("pdf")
    } finally {
      setEntregando(false)
    }
    if (!ok) return
    window.open(`/dashboard/consultas/${consultaId}/informe`, "_blank", "noopener")
    toast.success("Informe entregado — se abrió la vista para guardarlo como PDF")
    alCerrar()
  }

  async function copiar() {
    if (!informe) return
    setEntregando(true)
    let ok = false
    try {
      ok = await registrar("clipboard")
    } finally {
      setEntregando(false)
    }
    if (!ok) return
    try {
      await navigator.clipboard.writeText(comoTextoPlano(informe))
      toast.success("Informe copiado — pegalo donde lo vayas a mandar")
      alCerrar()
    } catch {
      toast.error("No se pudo copiar. Seleccioná el texto a mano.")
    }
  }

  async function enviarPorWhatsApp() {
    if (!informe) return
    setEntregando(true)
    try {
      // El servidor manda Y registra (una sola transacción de responsabilidad): mandar desde acá y
      // registrar aparte dejaría un WhatsApp salido sin fila si el tab se cierra en el medio. El
      // destino NO viaja: el teléfono lo resuelve el servidor desde la ficha del titular.
      const res = await fetch("/api/informe-al-titular/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consultation_id: consultaId,
          texto: comoTextoPlano(informe),
          informe,
          generated_at: generadoEn ?? undefined,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; titular?: string | null }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      toast.success(`Informe enviado por WhatsApp${json.titular ? ` a ${json.titular}` : ""}`)
      alCerrar()
    } catch (e) {
      toast.error(`No se pudo enviar: ${(e as Error).message}`)
    } finally {
      setEntregando(false)
    }
  }

  const vacio = !informe?.body.trim()

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && alCerrar()}>
      <DialogContent className="max-w-2xl gap-0 p-0">
        <DialogHeader className="border-b border-line-soft p-5 pb-4">
          <DialogTitle>Informe para el titular</DialogTitle>
          <DialogDescription>
            La consulta de {paciente} contada en el idioma de {titular ?? "quien se lo lleva"}.
            Revisalo y editá lo que haga falta: lo que se entrega es esto, no lo que redactó VetGPT.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60svh] flex-col gap-4 overflow-y-auto p-5">
          {!informe && !error && (
            <p className="flex items-center gap-2 py-8 text-sm text-fg-muted">
              <Sparkles className="size-4 animate-pulse" aria-hidden />
              VetGPT está redactando el informe a partir de la nota aprobada…
            </p>
          )}

          {error && <p className="py-6 text-sm text-danger">{error}</p>}

          {informe &&
            SECCIONES.map((s) => (
              <label key={s.campo} className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-fg">{s.etiqueta}</span>
                <textarea
                  value={informe[s.campo]}
                  onChange={(e) => editar(s.campo, e.target.value)}
                  rows={s.filas}
                  className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
                {s.ayuda && <span className="text-[11.5px] text-fg-faint">{s.ayuda}</span>}
              </label>
            ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft p-4">
          <Button onClick={entregarPdf} disabled={!informe || vacio || entregando}>
            {entregando ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
            Entregar en PDF
          </Button>
          {/* El envío directo que pidió David (26-ago, decisión de Felipe): el clic del vet ES la
              aprobación — este diálogo existe justamente para que lo lea y lo edite antes. */}
          <Button variant="outline" onClick={enviarPorWhatsApp} disabled={!informe || vacio || entregando}>
            <MessageCircle className="size-4" />
            Enviar por WhatsApp
          </Button>
          <Button variant="outline" onClick={copiar} disabled={!informe || vacio || entregando}>
            <ClipboardCopy className="size-4" />
            Copiar el texto
          </Button>
          <span className="ml-auto text-[11.5px] text-fg-faint">
            Queda registrado qué se entregó y cuándo.
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
