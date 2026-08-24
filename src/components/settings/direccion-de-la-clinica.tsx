"use client"

// La dirección de la clínica — dónde queda, para poder decírselo al titular.
//
// PARA QUÉ SE CARGA. Va al campo de ubicación de cada cita que se empuja al calendario, que es lo
// que el teléfono del titular convierte en un enlace a mapas. Sin esto, la invitación le dice a qué
// hora tiene que estar pero no dónde — y el titular termina llamando a la clínica para preguntar la
// dirección, que es exactamente el trabajo que agendar por calendario venía a ahorrar.
//
// LAS COLUMNAS YA EXISTÍAN. `clinics.address` y `clinics.city` están en el esquema base desde el
// principio; lo que faltaba era una forma de cargarlas y algo que las usara. No hace falta
// migración: sólo esto y `composio/calendario.ts`.
//
// QUIÉN PUEDE EDITARLA: sólo un administrador, y no porque lo decida este componente. La policy
// `clinics_update` del esquema base ya exige `private.my_role() = 'admin'`, así que un vet que
// mande el update igual recibe un rechazo de la base. Acá se le muestra en modo lectura para que
// vea qué dirección está saliendo en las citas sin toparse con un error que no puede resolver.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { direccionDeLaClinica } from "@/lib/agenda/destinatarios"

export function DireccionDeLaClinica({
  clinicId,
  initialAddress,
  initialCity,
  isAdmin,
}: {
  clinicId: string
  initialAddress: string
  initialCity: string
  isAdmin: boolean
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [address, setAddress] = useState(initialAddress)
  const [city, setCity] = useState(initialCity)
  const [saving, setSaving] = useState(false)

  const sinCambios = address.trim() === initialAddress.trim() && city.trim() === initialCity.trim()

  if (!isAdmin) {
    const actual = direccionDeLaClinica({ address: initialAddress, city: initialCity })
    return (
      <p className="text-sm text-fg-muted">
        {actual ? (
          <>
            Las citas salen con esta dirección: <b className="text-fg">{actual}</b>. Sólo un
            administrador puede cambiarla.
          </>
        ) : (
          "Tu clínica no tiene dirección cargada, así que las citas del calendario salen sin ubicación. Pedile a un administrador que la cargue."
        )}
      </p>
    )
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    // `nullif` a mano: guardar cadena vacía haría que `direccionDeLaClinica` tuviera que distinguir
    // "" de null, y que un evento pudiera salir con una ubicación en blanco.
    const { error } = await supabase
      .from("clinics")
      .update({ address: address.trim() || null, city: city.trim() || null })
      .eq("id", clinicId)
    setSaving(false)
    if (error) {
      toast.error(`No se pudo guardar: ${error.message}`)
      return
    }
    toast.success("Dirección actualizada")
    router.refresh()
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="clinica-direccion">Dirección</FieldLabel>
        <Input
          id="clinica-direccion"
          value={address}
          placeholder="Cra 7 #45-12, Local 3"
          onChange={(e) => setAddress(e.target.value)}
        />
        <FieldDescription>
          Se adjunta a cada cita que se crea en el calendario, para que al titular le llegue en la
          invitación y pueda abrirla en el mapa.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="clinica-ciudad">Ciudad</FieldLabel>
        <Input
          id="clinica-ciudad"
          value={city}
          placeholder="Bogotá"
          onChange={(e) => setCity(e.target.value)}
        />
      </Field>
      <div>
        <Button type="submit" disabled={saving || sinCambios}>
          {saving && <Loader2Icon className="animate-spin" />} Guardar dirección
        </Button>
      </div>
    </form>
  )
}
