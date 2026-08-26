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
import { CreatePatientDrawer } from "@/components/create-patient-drawer"
import { buscarPacientes } from "@/lib/athos-context/buscar-pacientes"
import { useIsMobile } from "@/hooks/use-mobile"
import { CirclePlusIcon, Loader2Icon, PawPrint, Search } from "lucide-react"
import { useCapacidad } from "@/components/planes/plan-provider"
import { useModalPro } from "@/components/planes/modal-subir-a-pro"

type Patient = {
  id: string
  name: string
  species: string
  /** Para el insert de la consulta. */
  owner_id: string | null
  /** Para la lupa: se busca también por el nombre del titular. */
  owner: string | null
}

export function NewConsultationDrawer({
  trigger,
  label = "Nueva consulta",
}: {
  // Trigger alternativo (p.ej. el botón primario del sidebar); por defecto, el botón compacto que
  // ya usaba la página de Consultas. Mismo patrón que `CreatePatientDrawer`.
  trigger?: React.ReactElement
  label?: string
} = {}) {
  const isMobile = useIsMobile()
  const router = useRouter()

  // El Modo Fantasma es de Pro. Acá sólo se decide qué mostrar: el corte de verdad es el trigger
  // `consultations_requiere_pro` de la migración 0065, porque este cajón inserta la consulta
  // DIRECTO contra la base y no pasa por ninguna ruta de API.
  const { puede: puedeGrabar } = useCapacidad("modo-fantasma")
  const { pedirPro, ventana } = useModalPro("modo-fantasma")

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [patients, setPatients] = useState<Patient[] | null>(null)
  const [patientsLoading, setPatientsLoading] = useState(false)
  const [patientId, setPatientId] = useState<string>("")
  const [busqueda, setBusqueda] = useState("")

  function resetForm() {
    setPatientId("")
    setBusqueda("")
    setError(null)
  }

  async function handleOpenChange(nextOpen: boolean) {
    // EL GATE VA AL ABRIR, no al enviar el formulario.
    //
    // La consigna era frenar en «Iniciar consulta», y este cajón ES ese botón: se abre desde el
    // botón primario del sidebar, desde la pantalla de Consultas y desde el estado vacío. Cortando
    // acá, la ventana de Pro aparece con un solo clic en vez de después de elegir paciente y
    // escribir el motivo — hacerle llenar un formulario a alguien para decirle al final que no
    // puede es la peor versión de este muro.
    if (nextOpen && !puedeGrabar) {
      pedirPro()
      return
    }

    setOpen(nextOpen)
    if (!nextOpen) {
      resetForm()
      return
    }
    if (patients !== null) return
    setPatientsLoading(true)
    const supabase = createClient()
    // El titular viaja porque la lupa busca por él — «el perro de doña Marta» es como la
    // recepción recuerda a la mitad de los pacientes.
    const { data } = await supabase
      .from("patients")
      .select("id, name, species, owner_id, owner:owners(full_name)")
      .order("name")
    const list = ((data as unknown as
      | {
          id: string
          name: string
          species: string
          owner_id: string | null
          owner: { full_name: string | null } | null
        }[]
      | null) ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      species: p.species,
      owner_id: p.owner_id,
      owner: p.owner?.full_name ?? null,
    }))
    setPatients(list)
    // SIN preselección. Antes se marcaba el primero por alfabeto, y un vet apurado que no mirara
    // el selector arrancaba la consulta —grabación incluida— sobre el animal equivocado. Elegir
    // al paciente es LA decisión de esta pantalla: tiene que ser explícita.
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
    // `?grabar=1` — la consulta se acaba de crear PARA grabar, así que la pantalla arranca sola.
    //
    // El cliente lo pidió así: «le doy iniciar consulta … y me la inicia ahí mismo». Antes había que
    // llegar, encontrar el panel plegable de grabación y darle a un segundo botón; ese paso no
    // decidía nada — nadie crea una consulta para no grabarla.
    //
    // NO se salta el consentimiento: la pantalla llama al mismo `iniciar()` de siempre, que si el
    // titular no lo dio todavía muestra el panel para que lo lea. Lo que se quita es el clic, no el
    // gate legal.
    router.push(`/dashboard/consultas/${created.id}?grabar=1`)
  }

  return (
    <>
    <Drawer
      open={open}
      onOpenChange={handleOpenChange}
      swipeDirection={isMobile ? "down" : "right"}
    >
      <DrawerTrigger render={trigger ?? <Button size="sm" />}>
        <CirclePlusIcon />
        <span>{label}</span>
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
            {/* LA LUPA, NO UNA LISTA. David, 25-ago: «cuando se le da a iniciar consulta, debe
                haber la opción de registrar nuevo paciente o lupa. En lista es poco amigable para
                el vet». El <Select> plano además PRESELECCIONABA el primer paciente por alfabeto —
                un descuido y la grabación arrancaba sobre el animal equivocado.

                El filtro es `buscarPacientes` (lib/athos-context), el mismo matcher del selector
                de contexto de Athos: normaliza tildes y ñ, y busca por nombre, especie Y titular
                — «el perro de doña Marta» encuentra. */}
            <Field>
              <FieldLabel htmlFor="consultation-patient">Paciente</FieldLabel>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="consultation-patient"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder={
                    patientsLoading ? "Cargando pacientes…" : "Buscar por mascota, especie o titular…"
                  }
                  autoComplete="off"
                  className="pl-8"
                />
              </div>

              <div
                role="listbox"
                aria-label="Pacientes"
                className="max-h-[38svh] overflow-y-auto rounded-lg border"
              >
                {(patients === null || patientsLoading) && (
                  <p className="px-3 py-4 text-sm text-muted-foreground">Cargando…</p>
                )}
                {patients !== null &&
                  buscarPacientes(patients, busqueda).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={p.id === patientId}
                      onClick={() => setPatientId(p.id)}
                      className={
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50 " +
                        (p.id === patientId ? "bg-accent/70 font-medium" : "")
                      }
                    >
                      <PawPrint className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {p.species}
                        {p.owner ? ` · ${p.owner}` : ""}
                      </span>
                    </button>
                  ))}
                {patients !== null && !patientsLoading && patients.length > 0 &&
                  buscarPacientes(patients, busqueda).length === 0 && (
                    <p className="px-3 py-4 text-sm text-muted-foreground">
                      Ningún paciente coincide con «{busqueda}».
                    </p>
                  )}
                {patients?.length === 0 && (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    Todavía no hay pacientes registrados: crea el primero acá abajo.
                  </p>
                )}
              </div>

              {/* El alta SIN salir del flujo: antes el único camino era un enlace que cerraba el
                  drawer y te mandaba a Pacientes — para volver a empezar desde cero. `onCreated`
                  agrega el nuevo a la lista y lo deja ELEGIDO: un clic más y la consulta arranca. */}
              <CreatePatientDrawer
                label="Registrar nuevo paciente"
                trigger={
                  <Button type="button" variant="outline" className="w-full">
                    <CirclePlusIcon className="size-4" /> Registrar nuevo paciente
                  </Button>
                }
                onCreated={(nuevo) => {
                  setPatients((prev) => [...(prev ?? []), { ...nuevo, owner_id: null, owner: null }])
                  setPatientId(nuevo.id)
                  setBusqueda("")
                }}
              />
            </Field>
            {/* EL MOTIVO SALE DE ACÁ. Decisión del 17-ago: el motivo que el titular declara en la
                puerta —"viene decaído"— casi nunca es de lo que terminó tratándose, y escribirlo es
                un formulario entre el veterinario y un animal que ya está sobre la mesa.

                La consulta se titula DESPUÉS, desde la nota SOAP (propuesta de Jesús): cuando
                terminó ya se sabe de qué fue. Ver `lib/consultas/titulo.ts`.

                La columna `chief_complaint` NO se borra: hay meses de consultas con el motivo
                escrito a mano y, si existe, sigue mandando sobre el derivado. */}
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
    {/* Hermana del cajón y no hija: cuando el plan no alcanza, el cajón nunca llega a abrirse, así
        que la ventana no puede colgar de su árbol. */}
    {ventana}
    </>
  )
}
