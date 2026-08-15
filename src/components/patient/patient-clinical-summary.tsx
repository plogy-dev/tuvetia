"use client"

// Resumen clínico de la ficha: alergias, medicación y vacunas.
//
// POR QUÉ EXISTE ESTE COMPONENTE. Hasta ahora las tres tarjetas eran de sólo lectura y se ocultaban
// cuando estaban vacías, con este razonamiento en la página: "tres cajas que nunca se pueden llenar
// desde acá son tres callejones sin salida, no información". Era correcto — no había ninguna ruta
// de escritura por UI.
//
// Resulta que la base sí la tenía: `medications` y `vaccines` ya traen policies de INSERT con
// `with check (clinic_id = private.my_clinic_id())`. O sea que lo que faltaba era la interfaz, no
// el backend. Con la ruta abierta el razonamiento se invierte: estas dos tarjetas ahora se pintan
// SIEMPRE, porque una tarjeta vacía con un botón "Agregar" ya no es un callejón sin salida.
//
// ALERGIAS SIGUEN DE SÓLO LECTURA, y no por olvido: las escribe Athos cuando el vet le aprueba una
// propuesta durante la consulta. Ese flujo existe y tiene su auditoría; duplicarlo con un alta
// suelta acá crearía dos caminos para el dato que dispara el gate de alergia severa, que es la
// regla clínica más delicada del producto. Por eso esa tarjeta conserva el comportamiento anterior.
//
// NO HAY BOTÓN DE BORRAR, también a propósito: las tres tablas tienen policies de INSERT, SELECT y
// UPDATE, pero NINGUNA de DELETE. La historia clínica es append-only desde la interfaz y la RLS lo
// impone. (La policy de UPDATE sí existe, así que quien quiera agregar "editar" o "terminar
// tratamiento" más adelante no necesita migración.)
//
// La escritura va con la SESIÓN del vet, no con service_role: la RLS ya garantiza que no pueda
// escribir en otra clínica. Mismo patrón que `patient-attachments.tsx`.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Loader2, Pill, Plus, Syringe } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { bogotaDateOnly, bogotaTodayISO } from "@/lib/date-utils"
import { SEVERIDAD_ALERGIA } from "@/lib/alergias"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"

export type Allergy = { id: string; allergen: string; severity: string; reaction: string | null }
export type Medication = {
  id: string
  drug_name: string
  dose: string
  frequency: string | null
  is_chronic: boolean
  end_date: string | null
}
export type Vaccine = {
  id: string
  vaccine_name: string
  administered_at: string
  next_dose_at: string | null
}

// El mapa se mudó a `lib/alergias.ts`, junto a la lógica que marca el alérgeno dentro del plan de
// la nota: las dos pantallas tienen que nombrar la misma severidad con la misma palabra.

function Campo({
  etiqueta,
  children,
}: {
  etiqueta: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{etiqueta}</span>
      {children}
    </label>
  )
}

function Tarjeta({
  icono,
  titulo,
  accion,
  children,
}: {
  icono: React.ReactNode
  titulo: string
  accion?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {icono} {titulo}
        </div>
        {accion}
      </div>
      {children}
    </div>
  )
}

export function PatientClinicalSummary({
  clinicId,
  patientId,
  allergies,
  medications,
  vaccines,
}: {
  clinicId: string
  patientId: string
  allergies: Allergy[]
  medications: Medication[]
  vaccines: Vaccine[]
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())

  const [formAbierto, setFormAbierto] = useState<"med" | "vac" | null>(null)
  const [guardando, setGuardando] = useState(false)

  // Medicación
  const [farmaco, setFarmaco] = useState("")
  const [dosis, setDosis] = useState("")
  const [frecuencia, setFrecuencia] = useState("")
  const [via, setVia] = useState("")
  const [hasta, setHasta] = useState("")
  const [cronico, setCronico] = useState(false)

  // Vacuna. La fecha por defecto es "hoy en Bogotá", no `new Date()`: este componente corre en el
  // navegador del vet, pero la fecha que se guarda tiene que ser la del negocio.
  const [vacuna, setVacuna] = useState("")
  const [aplicada, setAplicada] = useState(() => bogotaTodayISO())
  const [proxima, setProxima] = useState("")
  const [lote, setLote] = useState("")

  function cerrar() {
    setFormAbierto(null)
    setFarmaco("")
    setDosis("")
    setFrecuencia("")
    setVia("")
    setHasta("")
    setCronico(false)
    setVacuna("")
    setAplicada(bogotaTodayISO())
    setProxima("")
    setLote("")
  }

  async function guardarMedicacion(e: React.FormEvent) {
    e.preventDefault()
    if (!farmaco.trim() || !dosis.trim()) return
    setGuardando(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { error } = await supabase.from("medications").insert({
      clinic_id: clinicId,
      patient_id: patientId,
      drug_name: farmaco.trim(),
      dose: dosis.trim(),
      frequency: frecuencia.trim() || null,
      route: via.trim() || null,
      end_date: hasta || null,
      is_chronic: cronico,
      prescribed_by: user?.id ?? null,
    })
    setGuardando(false)
    if (error) {
      toast.error(`No se pudo guardar la medicación: ${error.message}`)
      return
    }
    toast.success(`"${farmaco.trim()}" agregado a la medicación`)
    cerrar()
    router.refresh()
  }

  async function guardarVacuna(e: React.FormEvent) {
    e.preventDefault()
    if (!vacuna.trim() || !aplicada) return
    setGuardando(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { error } = await supabase.from("vaccines").insert({
      clinic_id: clinicId,
      patient_id: patientId,
      vaccine_name: vacuna.trim(),
      administered_at: aplicada,
      next_dose_at: proxima || null,
      batch_number: lote.trim() || null,
      administered_by: user?.id ?? null,
    })
    setGuardando(false)
    if (error) {
      toast.error(`No se pudo guardar la vacuna: ${error.message}`)
      return
    }
    toast.success(`"${vacuna.trim()}" agregada al carné`)
    cerrar()
    router.refresh()
  }

  const botonAgregar = (cual: "med" | "vac", etiqueta: string) => (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 px-2 text-xs"
      onClick={() => setFormAbierto(formAbierto === cual ? null : cual)}
    >
      <Plus className="size-3.5" /> {etiqueta}
    </Button>
  )

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* ── Alergias: sólo lectura (las escribe Athos al aprobar una propuesta) ─────────────── */}
      <Tarjeta icono={<AlertTriangle className="size-4 text-muted-foreground" />} titulo="Alergias">
        {allergies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin alergias registradas. Entran cuando apruebas una propuesta de Athos durante una
            consulta.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {allergies.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <span
                  className={`size-1.5 shrink-0 rounded-full ${a.severity === "severe" ? "bg-destructive" : "bg-muted-foreground/50"}`}
                />
                <span className="font-medium">{a.allergen}</span>
                <span className="text-muted-foreground">
                  {SEVERIDAD_ALERGIA[a.severity] ?? a.severity}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      {/* ── Medicación ──────────────────────────────────────────────────────────────────────── */}
      <Tarjeta
        icono={<Pill className="size-4 text-muted-foreground" />}
        titulo="Medicación"
        accion={botonAgregar("med", "Agregar")}
      >
        {formAbierto === "med" && (
          <form onSubmit={guardarMedicacion} className="mb-3 flex flex-col gap-2 rounded-lg border bg-background p-3">
            <Campo etiqueta="Fármaco *">
              <Input value={farmaco} onChange={(e) => setFarmaco(e.target.value)} autoFocus required />
            </Campo>
            <Campo etiqueta="Dosis *">
              <Input
                value={dosis}
                onChange={(e) => setDosis(e.target.value)}
                placeholder="ej. 250 mg"
                required
              />
            </Campo>
            <Campo etiqueta="Frecuencia">
              <Input
                value={frecuencia}
                onChange={(e) => setFrecuencia(e.target.value)}
                placeholder="ej. cada 12 h"
              />
            </Campo>
            <Campo etiqueta="Vía">
              <Input value={via} onChange={(e) => setVia(e.target.value)} placeholder="ej. oral" />
            </Campo>
            <Campo etiqueta="Hasta">
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </Campo>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={cronico} onCheckedChange={(v) => setCronico(v === true)} />
              Tratamiento crónico
            </label>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={cerrar}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={guardando || !farmaco.trim() || !dosis.trim()}>
                {guardando ? <Loader2 className="size-4 animate-spin" /> : "Guardar"}
              </Button>
            </div>
          </form>
        )}

        {medications.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin medicación registrada.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {medications.slice(0, 6).map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{m.drug_name}</span>
                <span className="text-muted-foreground">{m.dose}</span>
                {m.frequency && <span className="text-muted-foreground">· {m.frequency}</span>}
                {m.is_chronic && (
                  <Badge variant="outline" className="text-[10px]">
                    Crónico
                  </Badge>
                )}
              </li>
            ))}
            {medications.length > 6 && (
              <li className="text-xs text-muted-foreground">
                y {medications.length - 6} más
              </li>
            )}
          </ul>
        )}
      </Tarjeta>

      {/* ── Vacunas ─────────────────────────────────────────────────────────────────────────── */}
      <Tarjeta
        icono={<Syringe className="size-4 text-muted-foreground" />}
        titulo="Vacunas"
        accion={botonAgregar("vac", "Agregar")}
      >
        {formAbierto === "vac" && (
          <form onSubmit={guardarVacuna} className="mb-3 flex flex-col gap-2 rounded-lg border bg-background p-3">
            <Campo etiqueta="Vacuna *">
              <Input
                value={vacuna}
                onChange={(e) => setVacuna(e.target.value)}
                placeholder="ej. Triple felina"
                autoFocus
                required
              />
            </Campo>
            <Campo etiqueta="Fecha de aplicación *">
              <Input type="date" value={aplicada} onChange={(e) => setAplicada(e.target.value)} required />
            </Campo>
            <Campo etiqueta="Próxima dosis">
              <Input type="date" value={proxima} onChange={(e) => setProxima(e.target.value)} />
            </Campo>
            <Campo etiqueta="Lote">
              <Input value={lote} onChange={(e) => setLote(e.target.value)} />
            </Campo>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={cerrar}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={guardando || !vacuna.trim() || !aplicada}>
                {guardando ? <Loader2 className="size-4 animate-spin" /> : "Guardar"}
              </Button>
            </div>
          </form>
        )}

        {vaccines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin vacunas registradas.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {vaccines.slice(0, 6).map((v) => (
              <li key={v.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{v.vaccine_name}</span>
                {/* `administered_at` es DATE: va con el formateador de fecha pura, no con el de
                    instantes — ese la corría un día hacia atrás. Ver lib/date-utils.ts. */}
                <span className="text-muted-foreground">{bogotaDateOnly(v.administered_at)}</span>
                {v.next_dose_at && (
                  <Badge variant="outline" className="text-[10px]">
                    próxima {bogotaDateOnly(v.next_dose_at)}
                  </Badge>
                )}
              </li>
            ))}
            {vaccines.length > 6 && (
              <li className="text-xs text-muted-foreground">y {vaccines.length - 6} más</li>
            )}
          </ul>
        )}
      </Tarjeta>
    </div>
  )
}
