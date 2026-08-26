"use client"

// Horarios de atención (tabla clinic_hours, RLS por clínica — CRUD directo desde el cliente).
// VetGPT los usa para proponer citas con cupos reales y para el modo auto de WhatsApp.
//
// DOS HORARIOS Y NO UNO, desde la migración 0069. El de la CLÍNICA —el de siempre, el que se le
// responde a un titular que pregunta a qué hora abren— y el de cada PERSONA, que reemplaza al de la
// clínica para ella y sólo en los días que definió.
//
// SALIÓ DE LA REUNIÓN DEL 17-ago, a propósito de los correos que salían con la hora equivocada:
// *"lo manda desde su correo… el horario es el suyo y no es el mío"*. Con un veterinario un solo
// horario alcanza; con tres, uno que entra a las 2 aparecía libre a las 8 porque la clínica abre a
// las 8.
//
// LO QUE NO SE HACE EN SILENCIO. Tener horario propio no apaga el de la clínica: lo tapa día por
// día. La pestaña "El mío" DICE qué días siguen saliendo del horario de la clínica, porque un
// horario que reemplaza a otro sin avisar es un horario que nadie audita — y el que se entera es el
// titular que se quedó sin cupo.

import { useState } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export type ClinicHourRow = {
  id: string
  weekday: number
  opens_at: string
  closes_at: string
  slot_minutes: number
  /** Nulo = de la clínica. Con valor = de esa persona (0069). */
  vet_id: string | null
}

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
// Orden de despliegue lunes-primero (Colombia)
const ORDER = [1, 2, 3, 4, 5, 6, 0]

type DeQuien = "clinica" | "mio"

export function ClinicHoursSettings({
  initialHours,
  vetId,
}: {
  initialHours: ClinicHourRow[]
  /** Quién está mirando. Sin él no hay pestaña "El mío": no se sabe de quién sería. */
  vetId: string | null
}) {
  const [supabase] = useState(() => createClient())
  const [hours, setHours] = useState<ClinicHourRow[]>(initialHours)
  const [deQuien, setDeQuien] = useState<DeQuien>("clinica")
  const [weekday, setWeekday] = useState<string>("1")
  const [opens, setOpens] = useState("08:00")
  const [closes, setCloses] = useState("18:00")
  const [slot, setSlot] = useState("30")
  const [busy, setBusy] = useState(false)

  // El dueño de lo que se está viendo y de lo que se agregue: nulo = la clínica.
  const dueno = deQuien === "mio" ? vetId : null
  const visibles = hours.filter((h) => h.vet_id === dueno)
  const diasPropios = new Set(hours.filter((h) => h.vet_id === vetId).map((h) => h.weekday))
  // Los días que, aun estando en "El mío", los sigue cubriendo la clínica.
  const heredados = hours.filter((h) => h.vet_id === null && !diasPropios.has(h.weekday))

  async function add() {
    if (closes <= opens) {
      toast.error("La hora de cierre debe ser posterior a la de apertura")
      return
    }
    setBusy(true)
    // clinic_id es NOT NULL: se manda explícito desde el perfil (la policy WITH CHECK igualmente
    // valida que sea la clínica del usuario — mandar otra falla).
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { data: prof } = user
      ? await supabase.from("profiles").select("clinic_id").eq("id", user.id).maybeSingle()
      : { data: null }
    const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
    if (!clinicId) {
      setBusy(false)
      toast.error("No se encontró tu clínica")
      return
    }
    const { data, error } = await supabase
      .from("clinic_hours")
      .insert({
        clinic_id: clinicId,
        // EXPLÍCITO, incluido el nulo. La columna acepta nulo por default y omitirla funcionaría,
        // pero entonces de qué horario se trata dependería de un default de la tabla en vez de del
        // interruptor que el vet acaba de tocar.
        vet_id: dueno,
        weekday: Number(weekday),
        opens_at: opens,
        closes_at: closes,
        slot_minutes: Number(slot) || 30,
      })
      .select("id, weekday, opens_at, closes_at, slot_minutes, vet_id")
      .single()
    setBusy(false)
    if (error) {
      toast.error(`No se pudo agregar: ${error.message}`)
      return
    }
    setHours((prev) =>
      [...prev, data as ClinicHourRow].sort((a, b) => a.weekday - b.weekday || a.opens_at.localeCompare(b.opens_at)),
    )
    toast.success(dueno ? "Horario tuyo agregado" : "Horario agregado")
  }

  async function remove(id: string) {
    const prev = hours
    setHours((h) => h.filter((x) => x.id !== id))
    const { error } = await supabase.from("clinic_hours").delete().eq("id", id)
    if (error) {
      setHours(prev)
      toast.error(`No se pudo eliminar: ${error.message}`)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* SIN `vetId` NO HAY INTERRUPTOR y la pantalla se comporta como siempre: el horario de la
          clínica, a secas. Es el caso de quien todavía no tiene sesión resuelta. */}
      {vetId && (
        <ToggleGroup
          // Base UI maneja el valor como ARREGLO aunque la selección sea única. `?? deQuien`
          // ignora el intento de des-seleccionar: siempre se está viendo uno de los dos.
          value={[deQuien]}
          onValueChange={(v) => setDeQuien(((v as string[])[0] as DeQuien) ?? deQuien)}
          variant="outline"
          size="sm"
          aria-label="De quién es el horario que se está editando"
        >
          <ToggleGroupItem value="clinica">De la clínica</ToggleGroupItem>
          <ToggleGroupItem value="mio">
            El mío
            {diasPropios.size > 0 && (
              <span className="ml-1.5 font-mono text-[11px] tabular-nums text-fg-faint">
                {diasPropios.size}
              </span>
            )}
          </ToggleGroupItem>
        </ToggleGroup>
      )}

      {visibles.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {deQuien === "mio"
            ? "No tenés horario propio. Mientras no cargues ninguno, atendés en el horario de la clínica."
            : "Sin horarios configurados. Agrégalos para que VetGPT pueda proponer citas y responder por los horarios."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {ORDER.flatMap((d) => visibles.filter((h) => h.weekday === d)).map((h) => (
            <li key={h.id} className="flex items-center justify-between rounded-lg border px-3 py-1.5">
              <span>
                <b>{WEEKDAYS[h.weekday]}</b> · {h.opens_at.slice(0, 5)}–{h.closes_at.slice(0, 5)}
                <span className="text-muted-foreground"> · citas de {h.slot_minutes} min</span>
              </span>
              <Button size="icon" variant="ghost" onClick={() => remove(h.id)} aria-label="Eliminar horario">
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* LO QUE SE HEREDA, DICHO. Es la mitad de la función de esta pestaña: sin esta línea, alguien
          que carga "los martes entro a las 2" se queda pensando que su semana entera cambió. */}
      {deQuien === "mio" && heredados.length > 0 && (
        <p className="text-[13px] text-muted-foreground">
          El resto de la semana seguís con el horario de la clínica:{" "}
          {ORDER.flatMap((d) => heredados.filter((h) => h.weekday === d))
            .map((h) => `${WEEKDAYS[h.weekday].slice(0, 3)} ${h.opens_at.slice(0, 5)}–${h.closes_at.slice(0, 5)}`)
            .join(" · ")}
          .
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Select value={weekday} onValueChange={(v) => v && setWeekday(String(v))}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Día" />
          </SelectTrigger>
          <SelectContent>
            {ORDER.map((d) => (
              <SelectItem key={d} value={String(d)}>
                {WEEKDAYS[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="time" value={opens} onChange={(e) => setOpens(e.target.value)} className="w-36" aria-label="Abre" />
        <Input type="time" value={closes} onChange={(e) => setCloses(e.target.value)} className="w-36" aria-label="Cierra" />
        <Input
          type="number"
          min={5}
          max={240}
          value={slot}
          onChange={(e) => setSlot(e.target.value)}
          className="w-20"
          aria-label="Minutos por cita"
          title="Minutos por cita"
        />
        <Button onClick={add} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {deQuien === "mio" ? "Agregar a mi horario" : "Agregar"}
        </Button>
      </div>
    </div>
  )
}
