"use client"

// Drawer de creación/edición de cita. Controlado por el calendario (open/initial vienen por props;
// se remonta por `key` en cada apertura para re-sembrar el formulario sin efectos). Mismo patrón que
// create-owner-drawer: Drawer + Field/Input/Select + RPC SECURITY DEFINER + toast.

import { useState } from "react"
import { format } from "date-fns"
import { Loader2Icon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { finSegunTipo, TIPOS_DE_CITA } from "@/lib/agenda/tipos-de-cita"
import { hayQueAvisar } from "@/lib/citas/cuando-avisar"
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

/**
 * El texto del ítem vacío, uno solo para los tres selectores.
 *
 * Antes cada uno decía lo suyo ("Elegí un paciente", "Elegí un titular"…) y ninguno se veía: sin
 * `items`, el `SelectValue` pintaba el valor crudo `__none__`. Con la lista puesta ya se leen, y se
 * unifican en una palabra — un formulario con tres frases distintas para el mismo hueco se lee como
 * tres cosas distintas.
 */
const SELECCIONAR = "Seleccionar"

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
  es_bloqueo?: boolean
  tipo?: string | null
  sin_hora?: boolean
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
  /**
   * `esEdicion` decide el título de la ventana de aviso; `avisarAlTitular`, si sale el
   * WhatsApp.
   *
   * LO DECIDE EL DRAWER Y NO EL CALENDARIO porque es el único que sabe QUÉ CAMBIÓ: el
   * calendario recibe un id y no tiene con qué comparar la hora vieja.
   */
  onSaved: (appointmentId: string, esEdicion: boolean, avisarAlTitular: boolean) => void
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

  // ── LO QUE TRAJO LA 0093 ─────────────────────────────────────────────────────────────────
  //
  // `esBloqueo` no es un campo más: cambia QUÉ pide el formulario. Con él marcado, paciente y
  // titular desaparecen —no se ocultan deshabilitados: se van— porque un bloqueo por definición no
  // los tiene, y la RPC rechaza si llegan.
  const [esBloqueo, setEsBloqueo] = useState(initial.es_bloqueo ?? false)
  const [tipo, setTipo] = useState<string>(initial.tipo ?? NONE)
  const [sinHora, setSinHora] = useState(initial.sin_hora ?? false)

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
    // Un BLOQUEO no lleva paciente ni titular — es su definición. El veterinario y el motivo se
    // siguen exigiendo: sin veterinario el bloqueo no bloquea nada (el antisolape de la 0067 se
    // saltea las citas sin `vet_id`), y sin motivo es un hueco que nadie sabe si puede usar.
    if (!esBloqueo) {
      if (patientId === NONE) {
        setError("Elegí el paciente")
        return
      }
      if (ownerId === NONE) {
        setError("Elegí el titular")
        return
      }
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
      // `null` EXPLÍCITO en un bloqueo, no el centinela `NONE`: mandarlo tal cual guardaría la
      // cadena "__none__" como si fuera un uuid.
      p_patient_id: esBloqueo ? null : patientId,
      p_owner_id: esBloqueo ? null : ownerId,
      p_vet_id: vetId,
      p_reason: reasonTrimmed,
      p_status: status,
      p_notes: notes.trim() || null,
      p_es_bloqueo: esBloqueo,
      // Un bloqueo lleva su tipo propio y no el del desplegable, que ni se le muestra.
      p_tipo: esBloqueo ? "bloqueo" : tipo === NONE ? null : tipo,
      p_sin_hora: sinHora,
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
    // El WhatsApp NO sale en cada guardado. La regla vive en `citas/cuando-avisar` con sus
    // tests: corregirle una tilde al motivo le mandaba al titular otro «quedó agendada»
    // idéntico al de ayer, y eso le escribe de más a un cliente real.
    onSaved(
      savedId,
      isEdit,
      hayQueAvisar({
        esEdicion: isEdit,
        status,
        esBloqueo,
        inicioAnterior: initial.starts_at ?? null,
        inicioNuevo: startsIso,
      }),
    )
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
            {/* ── SÓLO RESERVAR EL ESPACIO ──────────────────────────────────────────────────────
                Va PRIMERO porque cambia el resto del formulario: con esto marcado, paciente y
                titular desaparecen. Ponerlo abajo obligaría a llenar dos campos para después
                descubrir que no hacían falta.

                Se van y no se deshabilitan: un campo gris que no se puede tocar invita a preguntar
                por qué, y la respuesta —«un bloqueo no tiene paciente»— ya está en la etiqueta. */}
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface-2 p-3">
              <input
                type="checkbox"
                checked={esBloqueo}
                onChange={(e) => setEsBloqueo(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]"
              />
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium text-fg">
                  Sólo reservar el espacio
                </span>
                <span className="block text-[12.5px] leading-snug text-fg-muted">
                  Para un almuerzo, un quirófano o una ausencia. Ocupa la agenda del veterinario
                  igual que una cita, pero no lleva paciente ni titular.
                </span>
              </span>
            </label>

            <div className="grid grid-cols-1 gap-4">
              <Field>
                <FieldLabel htmlFor="appt-start">Inicio</FieldLabel>
                {/* `datetime-local` se pinta vacío como `dd/mm/aaaa --:--`, que no dice si el campo
                    está vacío o roto. El `aria-label` le da a un lector de pantalla la frase que el
                    control no tiene. */}
                <Input
                  id="appt-start"
                  type="datetime-local"
                  aria-label="Fecha y hora de inicio"
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
                  aria-label="Fecha y hora de fin"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  required
                />
              </Field>
            </div>

            {/* ── SIN HORA DEFINIDA ─────────────────────────────────────────────────────────────
                La cita cubre el día completo. `starts_at`/`ends_at` se guardan cubriendo el día
                igual —son NOT NULL y así se quedan, para no romper ninguna consulta que compare
                rangos— y lo que cambia es la MARCA, que es lo que deja pintarla como cita de día
                completo en vez de como un bloque de 24 horas que tapa la grilla entera. */}
            <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-fg-muted">
              <input
                type="checkbox"
                checked={sinHora}
                onChange={(e) => setSinHora(e.target.checked)}
                className="size-4 shrink-0 accent-[var(--color-brand)]"
              />
              Sin hora definida (ocupa el día entero)
            </label>
            {!esBloqueo && (
            <Field>
              <FieldLabel htmlFor="appt-patient">Paciente</FieldLabel>
              {/* `items` NO ES OPCIONAL, aunque compile sin él. Es de dónde saca `SelectValue` la
                  ETIQUETA del valor elegido; sin la lista pinta el valor CRUDO, y por eso estos
                  cuatro campos mostraban `__none__` y `scheduled` en pantalla. El patrón correcto
                  ya estaba en `new-consultation-drawer.tsx`; acá faltaba en los cuatro. */}
              <Select
                value={patientId}
                onValueChange={(v) => handlePatientChange((v as string) ?? NONE)}
                items={[
                  { label: SELECCIONAR, value: NONE },
                  ...patients.map((p) => ({ label: p.label, value: p.id })),
                ]}
              >
                <SelectTrigger id="appt-patient" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={NONE}>{SELECCIONAR}</SelectItem>
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
            )}
            <div className={esBloqueo ? "grid grid-cols-1 gap-4" : "grid grid-cols-2 gap-4"}>
              {!esBloqueo && (
              <Field>
                <FieldLabel htmlFor="appt-owner">Titular</FieldLabel>
                <Select
                  value={ownerId}
                  onValueChange={(v) => {
                    setOwnerId((v as string) ?? NONE)
                    setOwnerMismatch(null)
                  }}
                  items={[
                    { label: SELECCIONAR, value: NONE },
                    ...owners.map((o) => ({ label: o.label, value: o.id })),
                  ]}
                >
                  <SelectTrigger id="appt-owner" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={NONE}>{SELECCIONAR}</SelectItem>
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
              )}
              <Field>
                <FieldLabel htmlFor="appt-vet">Veterinario</FieldLabel>
                <Select
                  value={vetId}
                  onValueChange={(v) => setVetId((v as string) ?? NONE)}
                  items={[
                    { label: SELECCIONAR, value: NONE },
                    ...vets.map((v) => ({ label: v.label, value: v.id })),
                  ]}
                >
                  <SelectTrigger id="appt-vet" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={NONE}>{SELECCIONAR}</SelectItem>
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
                items={APPOINTMENT_STATUS_ORDER.map((s) => ({
                  label: APPOINTMENT_STATUS[s].label,
                  value: s,
                }))}
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
            {/* ── TIPO ──────────────────────────────────────────────────────────────────────
                NO reemplaza al motivo: lo clasifica. El motivo sigue siendo lo que el vet escribe
                y lo que le llega al titular por WhatsApp; el tipo es la etiqueta con la que se
                agrupa — la misma vacunación se escribe «vacuna», «refuerzo» y «VAC», y con texto
                libre no hay forma de contar cuántas hizo la clínica.

                ELEGIRLO MUEVE EL FIN. Una cirugía dura hora y media: dejarla en los 30 minutos por
                defecto la agenda encima de la consulta siguiente, y eso se descubre el día de la
                cirugía. */}
            {!esBloqueo && (
              <Field>
                <FieldLabel htmlFor="appt-tipo">Tipo</FieldLabel>
                <Select
                  value={tipo}
                  onValueChange={(v) => {
                    const elegido = (v as string) ?? NONE
                    setTipo(elegido)
                    const fin = startsAt ? finSegunTipo(new Date(startsAt).toISOString(), elegido) : null
                    if (fin) setEndsAt(toInput(fin))
                  }}
                  items={[
                    { value: NONE, label: SELECCIONAR },
                    ...TIPOS_DE_CITA.map((x) => ({ value: x.id, label: x.label })),
                  ]}
                >
                  <SelectTrigger id="appt-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={NONE}>{SELECCIONAR}</SelectItem>
                      {TIPOS_DE_CITA.map((x) => (
                        <SelectItem key={x.id} value={x.id}>
                          {x.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Ajusta la duración y el color en la agenda.</FieldDescription>
              </Field>
            )}

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
              {/* `rows={3}` y no 2: con dos filas la caja quedaba más baja que el resto de los
                  campos y se leía como un renglón suelto. */}
              <Textarea
                id="appt-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </Field>
            {error && <FieldDescription className="text-destructive">{error}</FieldDescription>}
          </FieldGroup>
          {/* AIRE ANTES DEL PIE. El `DrawerFooter` es hermano de este form y va pegado abajo, así
              que la caja de notas terminaba tocando el botón de crear cita: el último campo y la
              acción destructiva quedaban a la misma altura visual, sin nada que los separara.
              Va acá dentro —y no como margen del footer— porque el form es el que hace scroll. */}
          <div className="h-4 shrink-0" aria-hidden />
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
