"use client"

// Corregir los datos de contacto de un titular.
//
// UN SOLO FORMULARIO PARA DOS PANTALLAS. Se abre desde la ficha del titular y desde la ficha del
// paciente (pedido del cliente, reunión 24-ago: el vet está mirando a la mascota cuando el dueño
// le dicta el teléfono nuevo — mandarlo a otra pantalla a corregirlo es perder el dato). Si esto
// viviera duplicado, los dos formularios divergirían a la primera columna nueva.
//
// SÓLO DATOS DE CONTACTO. Nombre, teléfono, correo, documento y dirección. `notes` no aparece y el
// update no puede tocarla (el porqué está en `lib/titulares/editar.ts`, junto con la validación,
// que vive allá sin React para poder probarse en vitest).
//
// UPDATE DIRECTO CON EL CLIENTE DEL VET, como el drawer de edición de paciente: la RLS
// `owners_update` ya acota por clínica, así que no hace falta ni RPC ni migración.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, PencilIcon } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { validarTitular, type CamposDeTitular } from "@/lib/titulares/editar"
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

export function EditarTitularDrawer({
  ownerId,
  inicial,
  trigger,
  label = "Editar titular",
}: {
  ownerId: string
  inicial: CamposDeTitular
  /**
   * Trigger alternativo: la ficha del titular usa el botón estándar, pero en la ficha del paciente
   * el drawer cuelga de la línea "Titular: …" y ahí va un botón `xs`. Mismo patrón que
   * `CreateOwnerDrawer`.
   */
  trigger?: React.ReactElement
  label?: string
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())

  const [abierto, setAbierto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [campos, setCampos] = useState<CamposDeTitular>(inicial)
  const [errores, setErrores] = useState<Partial<Record<keyof CamposDeTitular, string>>>({})

  const set = (k: keyof CamposDeTitular) => (v: string) => {
    setCampos((c) => ({ ...c, [k]: v }))
    // El error se borra al tocar el campo: dejarlo mientras se escribe la corrección es decir que
    // sigue mal cuando ya se está arreglando.
    setErrores((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }

  function cerrar(v: boolean) {
    setAbierto(v)
    if (!v) {
      // Volver a lo guardado al cancelar: si no, reabrir el drawer muestra los cambios que se
      // acaban de descartar y parecen guardados.
      setCampos(inicial)
      setErrores({})
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()

    const r = validarTitular(campos, inicial)
    if (!r.ok) {
      setErrores(r.errores)
      return
    }

    if (Object.keys(r.cambios).length === 0) {
      toast.info("No hay nada que cambiar.")
      setAbierto(false)
      return
    }

    setGuardando(true)
    const { error } = await supabase.from("owners").update(r.cambios).eq("id", ownerId)
    setGuardando(false)

    if (error) {
      toast.error(`No se pudo guardar: ${error.message}`)
      return
    }

    toast.success(`${campos.fullName.trim()} quedó actualizado.`)
    setAbierto(false)
    router.refresh()
  }

  return (
    <Drawer open={abierto} onOpenChange={cerrar}>
      {/* El icono va sin clase de tamaño: así lo escala el propio botón (size-4 en `sm`, size-3
          en `xs`) y el mismo trigger sirve en la cabecera del titular y en la línea compacta de la
          ficha del paciente. */}
      <DrawerTrigger render={trigger ?? <Button variant="outline" size="sm" />}>
        <PencilIcon />
        <span>{label}</span>
      </DrawerTrigger>
      <DrawerContent>
        <form onSubmit={guardar} className="mx-auto flex w-full max-w-lg flex-col overflow-y-auto">
          <DrawerHeader>
            <DrawerTitle>Editar a {inicial.fullName}</DrawerTitle>
            <DrawerDescription>
              Datos de contacto del titular. Valen para todas sus mascotas: acá escriben WhatsApp,
              los recordatorios y la facturación.
            </DrawerDescription>
          </DrawerHeader>

          <FieldGroup className="px-4">
            <Field>
              <FieldLabel htmlFor="et-nombre">Nombre completo</FieldLabel>
              <Input
                id="et-nombre"
                value={campos.fullName}
                onChange={(e) => set("fullName")(e.target.value)}
                aria-invalid={!!errores.fullName}
                autoFocus
              />
              {errores.fullName && <p className="text-xs text-destructive">{errores.fullName}</p>}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="et-telefono">Teléfono</FieldLabel>
                <Input
                  id="et-telefono"
                  type="tel"
                  value={campos.phone}
                  onChange={(e) => set("phone")(e.target.value)}
                  placeholder="Opcional"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="et-correo">Email</FieldLabel>
                {/* type="text" y no type="email": la validación vive en `validarTitular`, que
                    permite guardar sin tocar un correo heredado inválido. El type nativo
                    bloquearía ESE caso en el submit, exactamente el que se quiere permitir. */}
                <Input
                  id="et-correo"
                  type="text"
                  inputMode="email"
                  value={campos.email}
                  onChange={(e) => set("email")(e.target.value)}
                  aria-invalid={!!errores.email}
                  placeholder="Opcional"
                />
                {errores.email && <p className="text-xs text-destructive">{errores.email}</p>}
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="et-documento">Documento</FieldLabel>
                <Input
                  id="et-documento"
                  value={campos.documentId}
                  onChange={(e) => set("documentId")(e.target.value)}
                  placeholder="Opcional"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="et-direccion">Dirección</FieldLabel>
                <Input
                  id="et-direccion"
                  value={campos.address}
                  onChange={(e) => set("address")(e.target.value)}
                  placeholder="Opcional"
                />
              </Field>
            </div>
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
