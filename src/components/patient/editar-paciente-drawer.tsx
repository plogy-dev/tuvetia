"use client"

// Corregir los datos de un paciente.
//
// LO QUE FALTABA. `patients` no tenía ninguna ruta de UPDATE en el producto: se creaba un paciente
// y un error de tipeo en el nombre quedaba así para siempre. Para una clínica que carga sus
// pacientes reales la primera semana, es un fallo de día 1.
//
// SÓLO DATOS DE IDENTIDAD. Nombre, especie, raza, sexo, fecha de nacimiento, peso y titular. Nada
// de historia clínica: alergias, medicación y vacunas tienen sus propias reglas —la historia es
// append-only desde la UI y lo impone la RLS— y meterlas acá crearía una segunda puerta para datos
// que hoy tienen una sola.
//
// LA VALIDACIÓN NO VIVE ACÁ. Está en `lib/pacientes/editar.ts`, sin React, para poder probarla en
// vitest. Este archivo es el formulario y nada más.
//
// NO CAMBIA LA FOTO. Subir un archivo es otro flujo (bucket, permisos, `photo_url`) y mezclarlo con
// "corregir el nombre" haría que un fallo de subida bloquee una corrección de texto. El drawer de
// creación ya lo maneja aparte, y ahí se queda.

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, PencilIcon } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { validarPaciente, type CamposDePaciente } from "@/lib/pacientes/editar"
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Titular = { id: string; full_name: string }

const SIN_TITULAR = "__ninguno__"

export function EditarPacienteDrawer({
  patientId,
  inicial,
  ownerId,
}: {
  patientId: string
  inicial: CamposDePaciente
  ownerId: string | null
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())

  const [abierto, setAbierto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [campos, setCampos] = useState<CamposDePaciente>(inicial)
  const [titularId, setTitularId] = useState<string>(ownerId ?? SIN_TITULAR)
  const [errores, setErrores] = useState<Partial<Record<keyof CamposDePaciente, string>>>({})
  const [titulares, setTitulares] = useState<Titular[] | null>(null)

  // Los titulares se cargan al ABRIR y una sola vez. Traerlos al montar costaría una consulta en
  // cada ficha de paciente que alguien mira, y casi nadie la abre para editar.
  useEffect(() => {
    if (!abierto || titulares !== null) return
    let vivo = true
    void (async () => {
      const { data } = await supabase.from("owners").select("id, full_name").order("full_name")
      if (vivo) setTitulares((data as Titular[] | null) ?? [])
    })()
    return () => {
      vivo = false
    }
  }, [abierto, titulares, supabase])

  const set = (k: keyof CamposDePaciente) => (v: string) => {
    setCampos((c) => ({ ...c, [k]: v }))
    // El error se borra al tocar el campo: dejarlo mientras el vet escribe la corrección es
    // decirle que sigue mal cuando ya lo está arreglando.
    setErrores((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }

  function cerrar(v: boolean) {
    setAbierto(v)
    if (!v) {
      // Volver a lo guardado al cancelar: si no, reabrir el drawer muestra los cambios que el vet
      // acaba de descartar y parecen guardados.
      setCampos(inicial)
      setTitularId(ownerId ?? SIN_TITULAR)
      setErrores({})
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()

    const r = validarPaciente(campos, inicial)
    if (!r.ok) {
      setErrores(r.errores)
      return
    }

    const nuevoOwner = titularId === SIN_TITULAR ? null : titularId
    const cambioTitular = nuevoOwner !== ownerId
    const cambios = { ...r.cambios, ...(cambioTitular ? { owner_id: nuevoOwner } : {}) }

    if (Object.keys(cambios).length === 0) {
      toast.info("No hay nada que cambiar.")
      setAbierto(false)
      return
    }

    setGuardando(true)
    const { error } = await supabase.from("patients").update(cambios).eq("id", patientId)
    setGuardando(false)

    if (error) {
      toast.error(`No se pudo guardar: ${error.message}`)
      return
    }

    toast.success(`${campos.name.trim()} quedó actualizado.`)
    setAbierto(false)
    router.refresh()
  }

  return (
    <Drawer open={abierto} onOpenChange={cerrar}>
      <DrawerTrigger
        render={
          <Button variant="outline" size="sm">
            <PencilIcon className="size-4" /> Editar
          </Button>
        }
      />
      <DrawerContent>
        <form onSubmit={guardar} className="mx-auto flex w-full max-w-lg flex-col overflow-y-auto">
          <DrawerHeader>
            <DrawerTitle>Editar {inicial.name}</DrawerTitle>
            <DrawerDescription>
              Datos de identidad del paciente. La historia clínica —alergias, medicación, vacunas—
              se edita en su propia sección.
            </DrawerDescription>
          </DrawerHeader>

          <FieldGroup className="px-4">
            <Field>
              <FieldLabel htmlFor="ep-nombre">Nombre</FieldLabel>
              <Input
                id="ep-nombre"
                value={campos.name}
                onChange={(e) => set("name")(e.target.value)}
                aria-invalid={!!errores.name}
                autoFocus
              />
              {errores.name && <p className="text-xs text-destructive">{errores.name}</p>}
            </Field>

            <Field>
              <FieldLabel htmlFor="ep-especie">Especie</FieldLabel>
              <Input
                id="ep-especie"
                value={campos.species}
                onChange={(e) => set("species")(e.target.value)}
                aria-invalid={!!errores.species}
              />
              {errores.species && <p className="text-xs text-destructive">{errores.species}</p>}
            </Field>

            <Field>
              <FieldLabel htmlFor="ep-raza">Raza</FieldLabel>
              <Input
                id="ep-raza"
                value={campos.breed}
                onChange={(e) => set("breed")(e.target.value)}
                placeholder="Opcional"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="ep-sexo">Sexo</FieldLabel>
              {/* `onValueChange` entrega `string | null` en esta versión del Select. El null se
                  ignora en vez de escribirse: dejaría el sexo en un valor que la validación
                  rechaza, y el vet vería un error sobre un campo que no tocó. */}
              <Select
                value={campos.sex}
                onValueChange={(v) => v !== null && set("sex")(v)}
                // Sin `items`, Base UI pinta el valor crudo: "female" en vez de "Hembra".
                items={[
                  { label: "Hembra", value: "female" },
                  { label: "Macho", value: "male" },
                  { label: "Sin definir", value: "unknown" },
                ]}
              >
                <SelectTrigger id="ep-sexo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="female">Hembra</SelectItem>
                    <SelectItem value="male">Macho</SelectItem>
                    <SelectItem value="unknown">Sin definir</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="ep-nacimiento">Fecha de nacimiento</FieldLabel>
              <Input
                id="ep-nacimiento"
                type="date"
                value={campos.birthDate}
                onChange={(e) => set("birthDate")(e.target.value)}
                aria-invalid={!!errores.birthDate}
              />
              {errores.birthDate && <p className="text-xs text-destructive">{errores.birthDate}</p>}
            </Field>

            <Field>
              <FieldLabel htmlFor="ep-peso">Peso (kg)</FieldLabel>
              <Input
                id="ep-peso"
                type="number"
                step="0.1"
                min="0"
                value={campos.weightKg}
                onChange={(e) => set("weightKg")(e.target.value)}
                aria-invalid={!!errores.weightKg}
                placeholder="Opcional"
              />
              {errores.weightKg && <p className="text-xs text-destructive">{errores.weightKg}</p>}
            </Field>

            <Field>
              <FieldLabel htmlFor="ep-titular">Titular</FieldLabel>
              <Select
                value={titularId}
                onValueChange={(v) => setTitularId(v ?? SIN_TITULAR)}
                disabled={titulares === null}
              >
                <SelectTrigger id="ep-titular">
                  <SelectValue placeholder={titulares === null ? "Cargando…" : "Sin titular"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={SIN_TITULAR}>Sin titular</SelectItem>
                    {(titulares ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.full_name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>

          <DrawerFooter>
            <Button type="submit" disabled={guardando}>
              {guardando ? <Loader2Icon className="size-4 animate-spin" /> : "Guardar"}
            </Button>
            <DrawerClose render={<Button variant="outline">Cancelar</Button>} />
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
