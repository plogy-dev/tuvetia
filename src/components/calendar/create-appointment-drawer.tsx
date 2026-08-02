"use client"

// Drawer de creación/edición de cita. Controlado por el calendario (open/initial vienen por props;
// se remonta por `key` en cada apertura para re-sembrar el formulario sin efectos). Mismo patrón que
// create-owner-drawer: Drawer + Field/Input/Select + RPC SECURITY DEFINER + toast.

import { useState } from "react"
import { format } from "date-fns"
import { Loader2Icon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { borrarEventosRemotos } from "@/lib/calendar-remote"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  APPOINTMENT_STATUS,
  APPOINTMENT_STATUS_ORDER,
  type AppointmentStatus,
  type PatientOption,
  type SelectOption,
} from "@/lib/appointments"

const NONE = "__none__"

export type AppointmentFormInitial = {
  id?: string
  title?: string
  reason?: string
  status?: AppointmentStatus
  starts_at?: string // ISO
  ends_at?: string // ISO
  patient_id?: string | null
  owner_id?: string | null
  vet_id?: string | null
  notes?: string
  google_event_id?: string | null
  microsoft_event_id?: string | null
  /** Dueño del calendario donde vive el evento — se captura para poder borrarlo allá. */
  calendar_owner_id?: string | null
}

// ISO -> valor de <input type="datetime-local"> (hora local del navegador).
function toInput(iso?: string): string {
  if (!iso) return ""
  return format(new Date(iso), "yyyy-MM-dd'T'HH:mm")
}

export function CreateAppointmentDrawer({
  open,
  onOpenChange,
  initial,
  patients,
  owners,
  vets,
  onSaved,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initial: AppointmentFormInitial
  patients: PatientOption[]
  owners: SelectOption[]
  vets: SelectOption[]
  onSaved: (appointmentId: string) => void
  /** Ya no lleva los ids del evento: el borrado remoto ocurre acá dentro, antes de borrar la fila. */
  onDeleted: () => void
}) {
  const isMobile = useIsMobile()
  const isEdit = Boolean(initial.id)
  const [supabase] = useState(() => createClient())
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ownerMismatch, setOwnerMismatch] = useState<string | null>(null)

  const [status, setStatus] = useState<AppointmentStatus>(initial.status ?? "scheduled")
  const [startsAt, setStartsAt] = useState(toInput(initial.starts_at))
  const [endsAt, setEndsAt] = useState(toInput(initial.ends_at))
  const [patientId, setPatientId] = useState(initial.patient_id ?? NONE)
  const [ownerId, setOwnerId] = useState(initial.owner_id ?? NONE)
  const [vetId, setVetId] = useState(initial.vet_id ?? NONE)
  // El motivo hace también de título del evento (summary de Google/Outlook) — un solo campo, no dos
  // que dijeran casi lo mismo. Si se edita una cita vieja sin motivo (p.ej. un evento traído por
  // pull, que solo tiene título), se siembra desde el título para no arrancar en blanco.
  const [reason, setReason] = useState(initial.reason ?? initial.title ?? "")
  const [notes, setNotes] = useState(initial.notes ?? "")

  // Elegir un paciente completa el titular automáticamente. Si ya había un titular elegido y el
  // paciente que se intenta elegir no es suyo, se bloquea (no se cambia patientId) y se explica por
  // qué — pedido explícito: "si ese paciente no está relacionado al titular... no lo permite".
  function handlePatientChange(id: string) {
    if (id === NONE) {
      setPatientId(NONE)
      setOwnerMismatch(null)
      return
    }
    const patient = patients.find((p) => p.id === id)
    if (ownerId !== NONE && patient && patient.ownerId !== ownerId) {
      setOwnerMismatch("Ese paciente no pertenece al titular seleccionado.")
      return
    }
    setPatientId(id)
    setOwnerMismatch(null)
    if (patient?.ownerId) setOwnerId(patient.ownerId)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!startsAt || !endsAt) {
      setError("Define inicio y fin de la cita")
      return
    }
    const startsIso = new Date(startsAt).toISOString()
    const endsIso = new Date(endsAt).toISOString()
    if (new Date(endsIso) <= new Date(startsIso)) {
      setError("La cita debe terminar después de empezar")
      return
    }
    if (patientId === NONE) {
      setError("Elegí el paciente")
      return
    }
    if (ownerId === NONE) {
      setError("Elegí el titular")
      return
    }
    if (vetId === NONE) {
      setError("Elegí el veterinario")
      return
    }
    const reasonTrimmed = reason.trim()
    if (!reasonTrimmed) {
      setError("Escribí el motivo de la cita")
      return
    }
    setLoading(true)
    const args = {
      p_title: reasonTrimmed,
      p_starts_at: startsIso,
      p_ends_at: endsIso,
      p_patient_id: patientId,
      p_owner_id: ownerId,
      p_vet_id: vetId,
      p_reason: reasonTrimmed,
      p_status: status,
      p_notes: notes.trim() || null,
    }
    const { data, error: rpcError } = isEdit
      ? await supabase.rpc("update_appointment", { p_id: initial.id, ...args })
      : await supabase.rpc("create_appointment", args)
    setLoading(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    // Ambas RPCs devuelven el uuid de la cita.
    const savedId = (data as string | null) ?? initial.id ?? ""
    toast.success(isEdit ? "Cita actualizada" : "Cita creada")
    onOpenChange(false)
    onSaved(savedId)
  }

  async function handleDelete() {
    if (!initial.id) return
    setDeleting(true)

    // PRIMERO el calendario externo, DESPUÉS la fila. El orden es de seguridad, no de comodidad:
    // mientras la cita existe, el servidor puede leer de ella en qué calendario vive y de quién es.
    // Al revés había que mandarle esos datos desde el navegador, y nada los ataba a esta cita — se
    // podía pedir el borrado de un evento cualquiera del calendario personal de un colega.
    const remoto = await borrarEventosRemotos(initial.id)

    const { error: delError } = await supabase.from("appointments").delete().eq("id", initial.id)
    setDeleting(false)
    if (delError) {
      setError(delError.message)
      return
    }
    // Best-effort: si el proveedor externo falló, la cita se borra igual y se avisa. Dejarla en
    // Tuvetia porque Google no contesta sería peor que un evento huérfano.
    if (!remoto.ok) {
      toast.warning(`Cita eliminada, pero no se pudo quitar del calendario: ${remoto.errores[0]}`)
    } else {
      toast.success("Cita eliminada")
    }
    onOpenChange(false)
    onDeleted()
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection={isMobile ? "down" : "right"}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{isEdit ? "Editar cita" : "Nueva cita"}</DrawerTitle>
          <DrawerDescription>Agenda una cita para un paciente de tu clínica.</DrawerDescription>
        </DrawerHeader>
        <form
          id="appointment-form"
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 overflow-y-auto px-4 text-sm"
        >
          <FieldGroup>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="appt-start">Inicio</FieldLabel>
                <Input
                  id="appt-start"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="appt-end">Fin</FieldLabel>
                <Input
                  id="appt-end"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  required
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="appt-patient">Paciente</FieldLabel>
              <Select value={patientId} onValueChange={(v) => handlePatientChange((v as string) ?? NONE)}>
                <SelectTrigger id="appt-patient" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={NONE}>Elegí un paciente</SelectItem>
                    {patients.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {ownerMismatch && <FieldDescription className="text-destructive">{ownerMismatch}</FieldDescription>}
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="appt-owner">Titular</FieldLabel>
                <Select
                  value={ownerId}
                  onValueChange={(v) => {
                    setOwnerId((v as string) ?? NONE)
                    setOwnerMismatch(null)
                  }}
                >
                  <SelectTrigger id="appt-owner" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={NONE}>Elegí un titular</SelectItem>
                      {owners.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Se completa solo al elegir el paciente.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="appt-vet">Veterinario</FieldLabel>
                <Select value={vetId} onValueChange={(v) => setVetId((v as string) ?? NONE)}>
                  <SelectTrigger id="appt-vet" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={NONE}>Elegí un veterinario</SelectItem>
                      {vets.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Queda citado en su calendario, como una invitación.</FieldDescription>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="appt-status">Estado</FieldLabel>
              <Select
                value={status}
                onValueChange={(v) => setStatus(((v as string) ?? "scheduled") as AppointmentStatus)}
              >
                <SelectTrigger id="appt-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {APPOINTMENT_STATUS_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>
                        {APPOINTMENT_STATUS[s].label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="appt-reason">Motivo</FieldLabel>
              <Input
                id="appt-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                placeholder="Control, vacunación…"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="appt-notes">Notas</FieldLabel>
              <Textarea
                id="appt-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </Field>
            {error && <FieldDescription className="text-destructive">{error}</FieldDescription>}
          </FieldGroup>
        </form>
        <DrawerFooter>
          <Button type="submit" form="appointment-form" disabled={loading || deleting}>
            {loading && <Loader2Icon className="animate-spin" />}
            {isEdit ? "Guardar cambios" : "Crear cita"}
          </Button>
          {isEdit && (
            <Button
              type="button"
              variant="outline"
              onClick={handleDelete}
              disabled={loading || deleting}
              className="text-destructive hover:text-destructive"
            >
              {deleting ? <Loader2Icon className="animate-spin" /> : <Trash2Icon className="size-4" />}
              Eliminar cita
            </Button>
          )}
          <DrawerClose render={<Button variant="outline" />}>Cancelar</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
