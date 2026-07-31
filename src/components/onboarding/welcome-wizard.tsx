"use client"

// Wizard de bienvenida. Recupera los pasos que el commit 7c00ec1 (27-jul) borró al reducir el
// onboarding a una sola pantalla: primer paciente, datos de ejemplo e invitar al equipo volvieron,
// porque son los que dejan la cuenta USABLE — una clínica con el nombre puesto y cero pacientes
// sigue siendo una pantalla vacía.
//
// Reglas del flujo:
//   · Sólo el paso 1 (clínica) es obligatorio. Los otros tres se saltan con un clic.
//   · `mark_setup_completed()` se llama AL FINAL. Si el vet abandona a mitad, vuelve a ver el
//     wizard la próxima vez — que es lo correcto: no lo terminó.
//   · Nada de lo que se hace acá es irreversible ni difícil de deshacer después.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Copy, Loader2, PawPrint, Sparkles, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { WorkspaceSetup } from "@/components/onboarding/workspace-setup"

const PASOS = ["Clínica", "Primer paciente", "Ejemplo", "Equipo"] as const

export function WelcomeWizard({
  clinicId,
  initialClinicName,
  initialLogoUrl,
}: {
  clinicId: string
  initialClinicName: string
  initialLogoUrl: string | null
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [paso, setPaso] = useState(0)
  const [busy, setBusy] = useState(false)

  // Paso 2 — primer paciente
  const [ownerName, setOwnerName] = useState("")
  const [ownerPhone, setOwnerPhone] = useState("")
  const [petName, setPetName] = useState("")
  const [petSpecies, setPetSpecies] = useState("Perro")

  // Paso 4 — invitación
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  /** Cierra el onboarding: marca el flag y manda al dashboard. Único punto de salida. */
  async function terminar() {
    setBusy(true)
    const { error } = await supabase.rpc("mark_setup_completed")
    if (error) {
      // Si esto falla, el vet volvería a ver el wizard al recargar. Se dice, no se traga.
      toast.error(`No se pudo cerrar la configuración: ${error.message}`)
      setBusy(false)
      return
    }
    router.push("/dashboard")
    router.refresh()
  }

  async function crearPrimerPaciente() {
    if (!ownerName.trim() || !petName.trim()) return
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
      toast.success(`${petName.trim()} quedó registrado 🐾`)
      setPaso(2)
    } catch (e) {
      toast.error(`No se pudo crear el paciente: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function crearDatosDeEjemplo() {
    setBusy(true)
    try {
      // Endpoint que quedó huérfano al borrarse el wizard viejo: sigue vivo, es idempotente, y
      // siembra "Luna (ejemplo)" con consulta transcrita y nota SOAP en borrador.
      const res = await fetch("/api/onboarding/demo-data", { method: "POST" })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      toast.success("Paciente de ejemplo creado — explóralo en Pacientes")
      setPaso(3)
    } catch (e) {
      toast.error(`No se pudo crear el ejemplo: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function invitarColega(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setBusy(true)
    const { data: token, error } = await supabase.rpc("create_invitation", {
      p_email: inviteEmail.trim(),
      p_role: "vet",
    })
    setBusy(false)
    if (error || !token) {
      toast.error(`No se pudo invitar: ${error?.message ?? "error desconocido"}`)
      return
    }
    setInviteLink(`${window.location.origin}/invitar/${token}`)
    toast.success("Invitación creada — comparte el enlace")
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Progreso */}
      <div className="flex items-center gap-1.5" aria-label={`Paso ${paso + 1} de ${PASOS.length}`}>
        {PASOS.map((s, i) => (
          <span
            key={s}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i <= paso ? "bg-primary" : "bg-muted"
            }`}
            title={s}
          />
        ))}
      </div>

      {paso === 0 && (
        <WorkspaceSetup
          clinicId={clinicId}
          initialClinicName={initialClinicName}
          initialLogoUrl={initialLogoUrl}
          onSaved={() => setPaso(1)}
        />
      )}

      {paso === 1 && (
        <div className="flex flex-col gap-5">
          <Encabezado
            icono={<PawPrint className="size-5" />}
            titulo="Tu primer paciente"
            sub="Cárgalo ahora o hazlo después desde Pacientes — como prefieras."
          />
          <Field>
            <FieldLabel htmlFor="owner-name">Nombre del titular</FieldLabel>
            <Input
              id="owner-name"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Ana Restrepo"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="owner-phone">Teléfono (opcional)</FieldLabel>
            <Input
              id="owner-phone"
              value={ownerPhone}
              onChange={(e) => setOwnerPhone(e.target.value)}
              placeholder="+57 300 123 4567"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="pet-name">Nombre de la mascota</FieldLabel>
              <Input
                id="pet-name"
                value={petName}
                onChange={(e) => setPetName(e.target.value)}
                placeholder="Luna"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="pet-species">Especie</FieldLabel>
              <Input
                id="pet-species"
                value={petSpecies}
                onChange={(e) => setPetSpecies(e.target.value)}
                placeholder="Perro"
              />
            </Field>
          </div>
          <Acciones
            onSaltar={() => setPaso(2)}
            principal={
              <Button onClick={crearPrimerPaciente} disabled={busy || !ownerName.trim() || !petName.trim()}>
                {busy && <Loader2 className="size-4 animate-spin" />} Registrar paciente
              </Button>
            }
          />
        </div>
      )}

      {paso === 2 && (
        <div className="flex flex-col gap-5">
          <Encabezado
            icono={<Sparkles className="size-5" />}
            titulo="¿Quieres un ejemplo para explorar?"
            sub="Creamos a “Luna (ejemplo)” con una consulta ya transcrita y su nota SOAP en borrador, para que veas el Modo Fantasma sin grabar nada. Se borra de un clic cuando quieras."
          />
          <Acciones
            onSaltar={() => setPaso(3)}
            principal={
              <Button onClick={crearDatosDeEjemplo} disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />} Crear ejemplo
              </Button>
            }
          />
        </div>
      )}

      {paso === 3 && (
        <div className="flex flex-col gap-5">
          <Encabezado
            icono={<UserPlus className="size-5" />}
            titulo="Invita a tu equipo"
            sub="Quien acepte entra directo a esta clínica, sin volver a configurar nada."
          />
          {inviteLink ? (
            <div className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-4">
              <p className="text-sm font-medium">Invitación lista</p>
              <div className="flex items-center gap-2">
                <Input readOnly value={inviteLink} className="text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(inviteLink)
                    toast.success("Enlace copiado")
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <FieldDescription>
                También le llega por correo. El enlace vence en unos días.
              </FieldDescription>
            </div>
          ) : (
            <form onSubmit={invitarColega} className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="invite-email">Correo del colega</FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colega@clinica.com"
                />
              </Field>
              <Button type="submit" variant="outline" disabled={busy || !inviteEmail.trim()}>
                {busy && <Loader2 className="size-4 animate-spin" />} Crear invitación
              </Button>
            </form>
          )}
          <Button onClick={terminar} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Entrar a Tuvetia
          </Button>
        </div>
      )}

      {/* Salida rápida, siempre visible salvo en el último paso (que ya tiene su botón). */}
      {paso > 0 && paso < 3 && (
        <button
          type="button"
          onClick={terminar}
          disabled={busy}
          className="text-xs text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
        >
          Saltar todo y entrar
        </button>
      )}
    </div>
  )
}

function Encabezado({ icono, titulo, sub }: { icono: React.ReactNode; titulo: string; sub: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        {icono}
      </div>
      <h1 className="text-xl font-bold">{titulo}</h1>
      <p className="text-sm text-muted-foreground">{sub}</p>
    </div>
  )
}

function Acciones({ onSaltar, principal }: { onSaltar: () => void; principal: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Button type="button" variant="ghost" onClick={onSaltar}>
        Ahora no
      </Button>
      {principal}
    </div>
  )
}
