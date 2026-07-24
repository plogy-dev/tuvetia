"use client"

// "Enlace ICS": genera (vía RPC) la URL secreta del feed de la clínica y la muestra para pegar en
// Google Calendar ("Otros calendarios → Desde URL"). No requiere conectar la cuenta de Google.

import { useState } from "react"
import { CalendarClock, Copy, Loader2 } from "lucide-react"
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
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"

export function IcsFeedButton() {
  const [supabase] = useState(() => createClient())
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [url, setUrl] = useState("")

  async function openFeed() {
    setOpen(true)
    if (url) return
    setLoading(true)
    const { data, error } = await supabase.rpc("ensure_calendar_feed")
    setLoading(false)
    if (error || !data) {
      toast.error(`No se pudo generar el enlace: ${error?.message ?? "desconocido"}`)
      return
    }
    setUrl(`${window.location.origin}/api/calendar/ics/${data}`)
  }

  async function copy() {
    if (!url) return
    await navigator.clipboard.writeText(url)
    toast.success("Enlace copiado")
  }

  return (
    <>
      <Button variant="outline" onClick={openFeed}>
        <CalendarClock className="size-4" /> Enlace ICS
      </Button>
      <Drawer open={open} onOpenChange={setOpen} swipeDirection="right">
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Enlace de calendario (solo lectura)</DrawerTitle>
            <DrawerDescription>
              Pegá este enlace en Google Calendar → <b>Otros calendarios</b> → <b>Desde URL</b>. Tus
              citas aparecerán en Google <b>sin conectar tu cuenta</b>. Es de una vía (solo lectura) y
              Google lo actualiza cada varias horas.
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex items-center gap-2 px-4">
            <Input
              readOnly
              value={loading ? "Generando enlace…" : url}
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button variant="outline" onClick={copy} disabled={!url || loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
              Copiar
            </Button>
          </div>
          <DrawerFooter>
            <DrawerClose render={<Button variant="outline" />}>Cerrar</DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  )
}
