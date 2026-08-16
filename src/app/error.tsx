"use client"

// El boundary de la raíz de la app.
//
// PARA QUÉ, SI YA HAY UNO EN EL DASHBOARD. Un `error.tsx` no envuelve el layout de su propio
// segmento, así que `dashboard/error.tsx` NO atrapa un fallo de `dashboard/layout.tsx` — y ese
// layout hace trabajo que puede fallar: resuelve la sesión, lee el perfil y aplica el gate de cuenta
// desactivada. Sin este archivo, ese fallo caía en la pantalla por defecto de Next.
//
// También cubre `/login`, `/bienvenida`, `/admin` y las rutas públicas, que hasta hoy no tenían
// ninguna red.
//
// Éste SÍ recibe los estilos globales: `global-error.tsx` es el único que reemplaza el layout raíz.

import { useEffect } from "react"
import { RotateCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { codigoDeReporte, reportarError } from "@/lib/errores"

export default function ErrorDeLaApp({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    reportarError(error, "raiz")
  }, [error])

  const codigo = codigoDeReporte(error)

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-semibold">Algo se rompió de nuestro lado</h1>
        <p className="max-w-sm text-sm text-fg-muted">
          No es algo que hayas hecho mal. Ya quedó registrado; probá de nuevo en un momento.
        </p>
      </div>

      <Button onClick={() => unstable_retry()}>
        <RotateCw className="size-4" /> Reintentar
      </Button>

      {codigo && (
        <p className="text-xs text-fg-faint">
          Código: <code className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono">{codigo}</code>
        </p>
      )}
    </main>
  )
}
