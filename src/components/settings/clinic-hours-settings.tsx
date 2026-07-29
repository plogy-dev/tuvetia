"use client"

// Horarios de atención de la clínica (tabla clinic_hours, RLS por clínica — CRUD directo desde el
// cliente). Athos los usa para proponer citas con cupos reales y para el modo auto de WhatsApp.

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

export type ClinicHourRow = {
  id: string
  weekday: number
  opens_at: string
  closes_at: string
  slot_minutes: number
}

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
// Orden de despliegue lunes-primero (Colombia)
const ORDER = [1, 2, 3, 4, 5, 6, 0]

export function ClinicHoursSettings({ initialHours }: { initialHours: ClinicHourRow[] }) {
  const [supabase] = useState(() => createClient())
  const [hours, setHours] = useState<ClinicHourRow[]>(initialHours)
  const [weekday, setWeekday] = useState<string>("1")
  const [opens, setOpens] = useState("08:00")
  const [closes, setCloses] = useState("18:00")
  const [slot, setSlot] = useState("30")
  const [busy, setBusy] = useState(false)

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
        weekday: Number(weekday),
        opens_at: opens,
        closes_at: closes,
        slot_minutes: Number(slot) || 30,
      })
      .select("id, weekday, opens_at, closes_at, slot_minutes")
      .single()
    setBusy(false)
    if (error) {
      toast.error(`No se pudo agregar: ${error.message}`)
      return
    }
    setHours((prev) =>
      [...prev, data as ClinicHourRow].sort((a, b) => a.weekday - b.weekday || a.opens_at.localeCompare(b.opens_at)),
    )
    toast.success("Horario agregado")
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
      {hours.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin horarios configurados. Agrégalos para que Athos pueda proponer citas y responder por
          los horarios.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {ORDER.flatMap((d) => hours.filter((h) => h.weekday === d)).map((h) => (
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
        <Input type="time" value={opens} onChange={(e) => setOpens(e.target.value)} className="w-28" aria-label="Abre" />
        <Input type="time" value={closes} onChange={(e) => setCloses(e.target.value)} className="w-28" aria-label="Cierra" />
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
          Agregar
        </Button>
      </div>
    </div>
  )
}
