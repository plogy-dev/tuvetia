"use client"

// Conectar un calendario, desde donde sea que se pida.
//
// POR QUÉ ESTÁ ACÁ Y NO DENTRO DE `calendar-settings.tsx`, que es donde vivía: desde v5 la conexión
// se pide desde DOS lugares. Integraciones, que es donde uno va a conectar cosas a propósito, y la
// ventana que la agenda le abre a quien todavía no conectó el suyo — porque nadie va a Integraciones
// a resolver un problema que no sabe que tiene.
//
// Los dos tienen que hacer exactamente lo mismo: preguntar qué proveedores ofrece el servidor, pedir
// la URL de consentimiento y mandar el navegador ahí. Copiarlo era garantizar que en unos meses uno
// de los dos mandara mal el `volverA` y devolviera a la gente a la pantalla equivocada.

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

export type CalendarProvider = "google" | "outlook"

export const NOMBRE_DEL_CALENDARIO: Record<CalendarProvider, string> = {
  google: "Google Calendar",
  outlook: "Outlook Calendar",
}

/**
 * Los proveedores que este despliegue puede ofrecer, y cómo arrancar la conexión.
 *
 * `disponibles` arranca en `null` —"todavía no sé"— y eso NO es lo mismo que `[]`, que significa
 * "este servidor no tiene calendario configurado". Quien pinta esto necesita distinguirlos: con
 * `null` no se muestra nada todavía, con `[]` se explica que falta configurar Composio. Mostrar un
 * botón que va a fallar al tocarlo es peor que no mostrar ninguno.
 *
 * `volverA` es a dónde devolver el navegador después del consentimiento. El servidor lo sanea
 * (`lib/ruta-de-vuelta.ts`); acá se manda tal cual.
 */
export function useConexionDeCalendario(volverA?: string) {
  const [disponibles, setDisponibles] = useState<CalendarProvider[] | null>(null)
  const [conectando, setConectando] = useState<CalendarProvider | null>(null)

  // Cuáles ofrecer lo decide el servidor: depende de qué auth configs estén puestos.
  useEffect(() => {
    let vivo = true
    fetch("/api/composio/calendario/connect")
      .then((r) => r.json())
      .then((j: { proveedores?: CalendarProvider[] }) => {
        if (vivo) setDisponibles(j.proveedores ?? [])
      })
      .catch(() => {
        if (vivo) setDisponibles([])
      })
    return () => {
      vivo = false
    }
  }, [])

  const conectar = useCallback(
    async (proveedor: CalendarProvider) => {
      setConectando(proveedor)
      try {
        const res = await fetch("/api/composio/calendario/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proveedor, ...(volverA ? { volverA } : {}) }),
        })
        const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
        if (!res.ok || !json.url) throw new Error(json.error ?? `HTTP ${res.status}`)
        // No se limpia `conectando`: el navegador se va de esta página y dejar el botón girando es
        // más honesto que devolverlo a su estado normal mientras la navegación ocurre.
        window.location.assign(json.url)
      } catch (e) {
        toast.error(`No se pudo iniciar la conexión: ${(e as Error).message}`)
        setConectando(null)
      }
    },
    [volverA],
  )

  return { disponibles, conectando, conectar }
}

/**
 * Avisa y refresca al volver del consentimiento (`?calendario=conectado`).
 *
 * La conexión ya está hecha del lado de Composio cuando el navegador vuelve; lo único que falta es
 * que el server component la lea. Se saca el parámetro de la URL con `replaceState` para que
 * recargar la página no vuelva a mostrar el aviso.
 */
export function useVueltaDeLaConexion() {
  const router = useRouter()
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get("calendario") !== "conectado") return
    url.searchParams.delete("calendario")
    window.history.replaceState({}, "", url.toString())
    toast.success("Calendario conectado")
    router.refresh()
  }, [router])
}
