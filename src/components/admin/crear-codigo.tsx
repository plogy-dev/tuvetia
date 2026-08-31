"use client"

// El formulario que crea un código, y el enlace que sale de él.
//
// EL CÓDIGO SE DEJA VACÍO Y LO INVENTA EL SERVIDOR. Ése es el camino esperado: nadie quiere
// bautizar un código, quiere repartirlo. El campo está por si hace falta uno legible para una charla
// («VETSBOGOTA»), que es el otro caso real.
//
// LOS DEFAULTS SON LA DECISIÓN DE PRODUCTO YA TOMADA: 7 días, del acta del 30-ago («con el enlace 7
// días, sin él los 3 de siempre»). Que el formulario abra con esa cifra puesta es lo que hace que la
// decisión se cumpla sin que nadie tenga que acordarse de ella.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"

import { crearCodigo } from "@/app/admin/acceso/actions"
import { normalizarCodigo } from "@/lib/puerta"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/** Los 7 días del acta del 30-ago. Vive acá porque es el default de la pantalla, no una regla. */
const DIAS_POR_DEFECTO = 7

export function CrearCodigo() {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [codigo, setCodigo] = useState("")
  const [dias, setDias] = useState(String(DIAS_POR_DEFECTO))
  const [maxUsos, setMaxUsos] = useState("25")
  const [expiraEn, setExpiraEn] = useState("")
  const [nota, setNota] = useState("")
  const [guardando, setGuardando] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setGuardando(true)
    const res = await crearCodigo({
      codigo: codigo || undefined,
      dias: Number(dias),
      maxUsos: Number(maxUsos),
      expiraEn: expiraEn || undefined,
      nota: nota || undefined,
    })
    setGuardando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(res.mensaje)
    setCodigo("")
    setNota("")
    setAbierto(false)
    router.refresh()
  }

  if (!abierto) {
    return (
      <Button size="sm" onClick={() => setAbierto(true)}>
        <Plus className="size-4" /> Crear código
      </Button>
    )
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-3 rounded-lg border p-4">
      <p className="text-sm font-medium">Código nuevo</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="codigo-nuevo">Código</FieldLabel>
          <Input
            id="codigo-nuevo"
            value={codigo}
            onChange={(e) => setCodigo(normalizarCodigo(e.target.value))}
            placeholder="Se genera solo"
            className="font-mono"
            autoComplete="off"
          />
          <FieldDescription>Dejalo vacío y sale uno legible, sin letras que se confundan.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="dias-nuevo">Días de prueba</FieldLabel>
          <Input
            id="dias-nuevo"
            type="number"
            min={1}
            max={60}
            value={dias}
            onChange={(e) => setDias(e.target.value)}
            required
          />
          {/* Que los días REEMPLAZAN la prueba y no se suman es la confusión que el acta del 30-ago
              anotó expresamente para que el copy no la tergiverse. Va también acá, que es donde
              alguien podría escribir "4" pensando que da 3+4. */}
          <FieldDescription>Reemplazan la prueba de 3 días, no se suman.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="usos-nuevo">Cuánta gente puede usarlo</FieldLabel>
          <Input
            id="usos-nuevo"
            type="number"
            min={1}
            max={10000}
            value={maxUsos}
            onChange={(e) => setMaxUsos(e.target.value)}
            required
          />
          <FieldDescription>Es el tope real: al llegar, el código deja de admitir gente.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="vence-nuevo">Vence el (opcional)</FieldLabel>
          <Input
            id="vence-nuevo"
            type="date"
            value={expiraEn}
            onChange={(e) => setExpiraEn(e.target.value)}
          />
          <FieldDescription>Vacío = no vence. Sirve todo ese día.</FieldDescription>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="nota-nueva">Para qué es (opcional)</FieldLabel>
        <Input
          id="nota-nueva"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Los 5 veterinarios de David"
          maxLength={200}
        />
        {/* Dentro de un mes nadie se acuerda de qué era VETK3M9PQ, y sin esta línea la tabla es una
            lista de códigos indistinguibles que nadie se anima a apagar. */}
        <FieldDescription>Es lo único que va a explicar este código dentro de un mes.</FieldDescription>
      </Field>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={guardando}>
          {guardando ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Crear
        </Button>
      </div>
    </form>
  )
}
