"use client"

// Conectar TU calendario — Google Calendar u Outlook Calendar, los dos vía Composio.
//
// Tres cosas que son el porqué del diseño actual:
//
//   1. NADA SE CONECTA SOLO. Antes el login guardaba el token sin que nadie lo pidiera; el vet se
//      enteraba de que su calendario estaba sincronizado cuando veía sus eventos personales en la
//      agenda de la clínica.
//   2. EL CALENDARIO ES DE CADA PERSONA (v5). Hasta v4 esto sólo se le mostraba al administrador,
//      porque el evento vivía en su calendario y la conexión de cualquier otro no cambiaba nada.
//      Ahora el evento se crea en el del VETERINARIO ASIGNADO —con el del admin de respaldo— así
//      que conectar el propio sí hace algo para cualquiera: su agenda de Tuvetia queda espejada en
//      su calendario. Los administradores además reciben todas las citas por invitación.
//   3. UNA SOLA VÍA. Tuvetia empuja sus citas; no lee nada del calendario. Por eso no hay botón
//      "Sincronizar": no hay nada que traer.
//
// El camino anterior de Outlook —OAuth por Supabase, capturando `provider_refresh_token` al volver—
// se retiró. Tenía un defecto que Composio elimina: ese token es el del proveedor con el que se
// INICIÓ SESIÓN, no el del botón que se apretó, y había que verificarlo en el cliente y en la ruta
// para que un login con Microsoft no dejara su token guardado como si fuera de Google.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarCheck, CalendarPlus, Loader2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  NOMBRE_DEL_CALENDARIO as NOMBRE,
  useConexionDeCalendario,
  useVueltaDeLaConexion,
  type CalendarProvider,
} from "./conectar-calendario"

export type { CalendarProvider }

export function CalendarSettings({
  connected,
  /** Si desconectar también le saca el correo a VetGPT: con Microsoft es la misma cuenta. */
  compartidoConElCorreo = false,
}: {
  connected: CalendarProvider | null
  compartidoConElCorreo?: boolean
}) {
  const router = useRouter()
  const [desconectando, setDesconectando] = useState(false)
  const { disponibles, conectando, conectar } = useConexionDeCalendario()
  useVueltaDeLaConexion()

  const busy = desconectando || conectando !== null

  async function disconnect() {
    if (!connected) return
    setDesconectando(true)
    try {
      const res = await fetch("/api/composio/calendario/disconnect", { method: "POST" })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      toast.success(`${NOMBRE[connected]} desconectado`)
      router.refresh()
    } catch (e) {
      toast.error(`No se pudo desconectar: ${(e as Error).message}`)
    } finally {
      setDesconectando(false)
    }
  }

  if (disponibles !== null && disponibles.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        La conexión de calendario no está disponible en este servidor todavía. Falta configurar
        Composio (<code>COMPOSIO_API_KEY</code> y el auth config del proveedor).
      </p>
    )
  }

  if (connected) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
            <CalendarCheck className="size-4 text-ok" aria-hidden />
            {NOMBRE[connected]} conectado
          </span>
          <Button variant="outline" size="sm" onClick={disconnect} disabled={busy}>
            {desconectando && <Loader2 className="size-4 animate-spin" />}
            Desconectar
          </Button>
        </div>
        {compartidoConElCorreo && (
          <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn-soft p-3 text-sm text-fg">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            <span>
              El calendario y el correo de Microsoft son <b>la misma cuenta</b>: desconectar acá
              también le saca a VetGPT el acceso a tu correo.
            </span>
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(disponibles ?? []).map((p) => (
        <Button key={p} variant="outline" onClick={() => conectar(p)} disabled={busy}>
          {conectando === p ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CalendarPlus className="size-4" aria-hidden />
          )}
          Conectar {NOMBRE[p]}
        </Button>
      ))}
    </div>
  )
}
