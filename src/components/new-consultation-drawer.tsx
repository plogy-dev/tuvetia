"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useIsMobile } from "@/hooks/use-mobile"
import { CirclePlusIcon, Loader2Icon } from "lucide-react"

type Patient = { id: string; name: string; species: string; owner_id: string | null }

export function NewConsultationDrawer() {
  const isMobile = useIsMobile()
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [patients, setPatients] = useState<Patient[] | null>(null)
  const [patientsLoading, setPatientsLoading] = useState(false)
  const [patientId, setPatientId] = useState<string>("")
  const [chiefComplaint, setChiefComplaint] = useState("")

  function resetForm() {
    setPatientId("")
    setChiefComplaint("")
    setError(null)
  }

  async function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      resetForm()
      return
    }
    if (patients !== null) return
    setPatientsLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from("patients")
      .select("id, name, species, owner_id")
      .order("name")
    const list = (data as Patient[] | null) ?? []
    setPatients(list)
    if (list.length) setPatientId(list[0].id)
    setPatientsLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!patientId) {
      setError("Elige un paciente para iniciar la consulta.")
      return
    }
    setLoading(true)
    const supabase = createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      setError("No se encontró tu sesión.")
      return
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("clinic_id")
      .eq("id", user.id)
      .single()
    if (!profile?.clinic_id) {
      setLoading(false)
      setError("Tu perfil no tiene una clínica asociada.")
      return
    }

    const patient = patients?.find((p) => p.id === patientId)
    const { data: created, error: insertError } = await supabase
      .from("consultations")
      .insert({
        clinic_id: profile.clinic_id,
        patient_id: patientId,
        owner_id: patient?.owner_id ?? null,
        vet_id: user.id,
        chief_complaint: chiefComplaint.trim() || null,
        status: "open",
      })
      .select("id")
      .single()

    if (insertError || !created) {
      setLoading(false)
      setError(insertError?.message ?? "No se pudo crear la consulta.")
      return
    }

    setLoading(false)
    toast.success("Consulta iniciada")
    setOpen(false)
    resetForm()
    router.push(`/dashboard/consultas/${created.id}`)
  }

  return (
    <Drawer
      open={open}
      onOpenChange={handleOpenChange}
      swipeDirection={isMobile ? "down" : "right"}
    >
      <DrawerTrigger render={<Button size="sm" />}>
        <CirclePlusIcon />
        Nueva consulta
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Nueva consulta</DrawerTitle>
          <DrawerDescription>
            Inicia una consulta para grabar, transcribir y generar la nota con el Modo Fantasma.
          </DrawerDescription>
        </DrawerHeader>
        <form
          id="new-consultation-form"
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 overflow-y-auto px-4 text-sm"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="consultation-patient">Paciente</FieldLabel>
              <Select
                value={patientId}
                onValueChange={(v) => setPatientId(v ?? "")}
                disabled={patientsLoading || (patients?.length ?? 0) === 0}
                items={(patients ?? []).map((p) => ({
                  label: `${p.name} · ${p.species}`,
                  value: p.id,
                }))}
              >
                <SelectTrigger id="consultation-patient" className="w-full">
                  <SelectValue
                    placeholder={patientsLoading ? "Cargando pacientes..." : "Selecciona"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {patients?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.species}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {patients?.length === 0 && (
                <FieldDescription>
                  No tienes pacientes registrados. Crea uno primero desde “Pacientes”.
                </FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="consultation-complaint">Motivo de consulta</FieldLabel>
              <Input
                id="consultation-complaint"
                placeholder="Opcional — p.ej. vómito y decaimiento"
                value={chiefComplaint}
                onChange={(e) => setChiefComplaint(e.target.value)}
              />
            </Field>
            {error && (
              <FieldDescription className="text-destructive">{error}</FieldDescription>
            )}
          </FieldGroup>
        </form>
        <DrawerFooter>
          <Button
            type="submit"
            form="new-consultation-form"
            disabled={loading || patientsLoading || !patientId}
          >
            {loading && <Loader2Icon className="animate-spin" />}
            Iniciar consulta
          </Button>
          <DrawerClose render={<Button variant="outline" />}>Cancelar</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
