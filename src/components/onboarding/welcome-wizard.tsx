"use client"

// Wizard de bienvenida (primer login del creador de la clínica). 5 pasos, TODOS saltables:
// bienvenida -> clínica/perfil -> primer paciente -> datos de ejemplo -> equipo. Al terminar (o
// "Saltar todo") marca setup_completed_at (RPC mark_setup_completed) y entra al dashboard, donde
// siguen el tour (orientar) y el checklist (acompañar).

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  Building2,
  Copy,
  Loader2,
  PawPrint,
  Sparkles,
  Stethoscope,
  UserPlus,
} from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

const STEPS = ["Bienvenida", "Tu clínica", "Primer paciente", "Datos de ejemplo", "Tu equipo"] as const

export function WelcomeWizard({
  userId,
  clinicId,
  initialClinicName,
  initialFullName,
  isAdmin,
}: {
  userId: string
  clinicId: string
  initialClinicName: string
  initialFullName: string
  isAdmin: boolean
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)

  // Paso 2
  const [clinicName, setClinicName] = useState(initialClinicName)
  const [fullName, setFullName] = useState(initialFullName)
  // Paso 3
  const [ownerName, setOwnerName] = useState("")
  const [ownerPhone, setOwnerPhone] = useState("")
  const [petName, setPetName] = useState("")
  const [petSpecies, setPetSpecies] = useState("")
  const [patientCreated, setPatientCreated] = useState(false)
  // Paso 4
  const [demoCreated, setDemoCreated] = useState(false)
  // Paso 5
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  async function finish() {
    setBusy(true)
    await supabase.rpc("mark_setup_completed")
    router.push("/dashboard")
    router.refresh()
  }

  async function saveClinicProfile() {
    setBusy(true)
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from("clinics").update({ name: clinicName.trim() }).eq("id", clinicId),
      supabase.from("profiles").update({ full_name: fullName.trim() }).eq("id", userId),
    ])
    setBusy(false)
    if (e1 || e2) {
      toast.error(`No se pudo guardar: ${(e1 ?? e2)?.message}`)
      return
    }
    setStep(2)
  }

  async function createFirstPatient() {
    setBusy(true)
    try {
      const { data: ownerId, error: oErr } = await supabase.rpc("create_owner", {
        p_full_name: ownerName.trim(),
        p_phone: ownerPhone.trim() || null,
      })
      if (oErr || !ownerId) throw new Error(oErr?.message ?? "no se pudo crear el titular")
      const { error: pErr } = await supabase.rpc("create_patient", {
        p_owner_id: ownerId,
        p_name: petName.trim(),
        p_species: petSpecies.trim() || "Perro",
      })
      if (pErr) throw new Error(pErr.message)
      setPatientCreated(true)
      toast.success(`${petName} quedó registrado 🐾`)
      setStep(3)
    } catch (e) {
      toast.error(`No se pudo crear el paciente: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function createDemoData() {
    setBusy(true)
    try {
      const res = await fetch("/api/onboarding/demo-data", { method: "POST" })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      setDemoCreated(true)
      toast.success("Paciente de ejemplo creado — explóralo en Pacientes")
      setStep(4)
    } catch (e) {
      toast.error(`No se pudo crear el ejemplo: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function inviteColleague(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { data: token, error } = await supabase.rpc("create_invitation", {
      p_email: inviteEmail.trim(),
      p_role: "vet",
    })
    setBusy(false)
    if (error || !token) {
      toast.error(`No se pudo invitar: ${error?.message ?? "desconocido"}`)
      return
    }
    setInviteLink(`${window.location.origin}/invitar/${token}`)
    toast.success("Invitación creada — copiá el link y compartilo")
  }

  const shell = (children: React.ReactNode, actions: React.ReactNode) => (
    <div className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center gap-6 px-6 py-10">
      {/* Progreso */}
      <div className="flex items-center gap-1.5">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`}
            aria-label={`${s}${i === step ? " (actual)" : ""}`}
          />
        ))}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
      <button
        type="button"
        onClick={finish}
        className="w-fit text-xs text-muted-foreground underline-offset-4 hover:underline"
        disabled={busy}
      >
        Saltar todo e ir al dashboard
      </button>
    </div>
  )

  const nextBtn = (label = "Siguiente") => (
    <Button variant="outline" onClick={() => (step === STEPS.length - 1 ? finish() : setStep(step + 1))} disabled={busy}>
      {label} <ArrowRight className="size-4" />
    </Button>
  )

  if (step === 0)
    return shell(
      <>
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Stethoscope className="size-5" />
        </div>
        <h1 className="text-2xl font-bold">Bienvenido a TuvetIA 🐾</h1>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          <li>• Registrás a tus <b className="text-foreground">pacientes</b> y sus titulares.</li>
          <li>• <b className="text-foreground">Grabás la consulta</b> y Athos la transcribe y redacta la nota clínica con literatura citada.</li>
          <li>• Vos <b className="text-foreground">revisás y aprobás</b> — nada entra a la historia sin tu OK.</li>
        </ul>
        <p className="text-sm text-muted-foreground">Te dejamos todo listo en 2 minutos.</p>
      </>,
      <Button onClick={() => setStep(1)}>Empezar <ArrowRight className="size-4" /></Button>,
    )

  if (step === 1)
    return shell(
      <>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Building2 className="size-5 text-muted-foreground" /> Tu clínica
        </h1>
        <Field>
          <FieldLabel htmlFor="wiz-clinic">Nombre de la clínica</FieldLabel>
          <Input id="wiz-clinic" value={clinicName} onChange={(e) => setClinicName(e.target.value)} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="wiz-name">Tu nombre</FieldLabel>
          <Input id="wiz-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>
      </>,
      <>
        <Button onClick={saveClinicProfile} disabled={busy || !clinicName.trim() || !fullName.trim()}>
          {busy && <Loader2 className="size-4 animate-spin" />} Guardar y seguir
        </Button>
        {nextBtn("Saltar")}
      </>,
    )

  if (step === 2)
    return shell(
      <>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <PawPrint className="size-5 text-muted-foreground" /> Tu primer paciente
        </h1>
        <p className="text-sm text-muted-foreground">
          Un titular y su mascota. Podés completar la ficha (raza, peso, alergias) después.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="wiz-owner">Titular</FieldLabel>
            <Input id="wiz-owner" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Nombre del dueño" />
          </Field>
          <Field>
            <FieldLabel htmlFor="wiz-phone">Teléfono (para WhatsApp)</FieldLabel>
            <Input id="wiz-phone" type="tel" value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="+57 300 …" />
          </Field>
          <Field>
            <FieldLabel htmlFor="wiz-pet">Mascota</FieldLabel>
            <Input id="wiz-pet" value={petName} onChange={(e) => setPetName(e.target.value)} placeholder="Luna" />
          </Field>
          <Field>
            <FieldLabel htmlFor="wiz-species">Especie</FieldLabel>
            <Input id="wiz-species" value={petSpecies} onChange={(e) => setPetSpecies(e.target.value)} placeholder="Perro, Gato…" />
          </Field>
        </div>
      </>,
      <>
        <Button onClick={createFirstPatient} disabled={busy || !ownerName.trim() || !petName.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <PawPrint className="size-4" />} Crear paciente
        </Button>
        {nextBtn(patientCreated ? "Siguiente" : "Lo hago después")}
      </>,
    )

  if (step === 3)
    return shell(
      <>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Sparkles className="size-5 text-muted-foreground" /> ¿Querés ver TuvetIA en acción?
        </h1>
        <p className="text-sm text-muted-foreground">
          Creamos un paciente de ejemplo (<b>Luna</b>) con una consulta ya transcrita y su{" "}
          <b>nota clínica redactada por Athos</b>, para que explores el Modo Fantasma sin grabar nada.
          Lo podés borrar cuando quieras desde el dashboard.
        </p>
      </>,
      <>
        <Button onClick={createDemoData} disabled={busy || demoCreated}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {demoCreated ? "Ejemplo creado" : "Crear ejemplo"}
        </Button>
        {nextBtn(demoCreated ? "Siguiente" : "No, gracias")}
      </>,
    )

  // Paso 5 — equipo
  return shell(
    <>
      <h1 className="flex items-center gap-2 text-xl font-bold">
        <UserPlus className="size-5 text-muted-foreground" /> Tu equipo
      </h1>
      {isAdmin ? (
        <>
          <p className="text-sm text-muted-foreground">
            ¿Trabajás con colegas? Invitalos y compartirán pacientes, consultas y agenda. También
            podés hacerlo después desde Configuración → Equipo.
          </p>
          <form onSubmit={inviteColleague} className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="wiz-invite">Email del colega</FieldLabel>
              <Input id="wiz-invite" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colega@clinica.com" />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="outline" disabled={busy || !inviteEmail.trim()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />} Crear invitación
              </Button>
              {inviteLink && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(inviteLink)
                    toast.success("Link copiado")
                  }}
                >
                  <Copy className="size-4" /> Copiar link
                </Button>
              )}
            </div>
          </form>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Listo — ¡a trabajar!</p>
      )}
    </>,
    <Button onClick={finish} disabled={busy}>
      {busy && <Loader2 className="size-4 animate-spin" />} Ir al dashboard <ArrowRight className="size-4" />
    </Button>,
  )
}
