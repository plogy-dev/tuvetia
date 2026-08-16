"use client" // Los boundaries de Next tienen que ser Client Components.

// El boundary de las PÁGINAS del dashboard.
//
// Este es el que va a atrapar el 99% de los fallos reales, y el único que conserva el contexto: se
// renderiza DENTRO de `dashboard/layout.tsx`, así que el vet sigue viendo la barra lateral y puede
// irse a otra pantalla sin recargar. Es la diferencia entre "esta sección falló" y "la aplicación
// se cayó".
//
// LO QUE ESTE BOUNDARY *NO* ATRAPA: los errores del propio `dashboard/layout.tsx`. Un `error.tsx`
// envuelve el `page.tsx`, el `loading.tsx` y los layouts ANIDADOS, pero no el layout de su mismo
// segmento (doc de Next, `file-conventions/error.md:96`). Y el layout del dashboard hace trabajo que
// puede fallar de verdad: resuelve la sesión, el perfil y el gate de cuenta desactivada. Por eso
// existe además `app/error.tsx`, que sí lo cubre.

import { useEffect } from "react"
import Link from "next/link"
import { RotateCw, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { codigoDeReporte, reportarError } from "@/lib/errores"

export default function ErrorDelDashboard({
  error,
  // `unstable_retry`, NO `reset`. En esta versión de Next el boundary recibe `unstable_retry()`, que
  // re-renderiza dentro de una Transition y **vuelve a pedir los datos** — que es lo que hace falta
  // cuando el fallo fue una consulta a Supabase que se cayó. `reset()` todavía existe pero sólo
  // limpia el estado sin re-fetchear, y el doc lo desaconseja para este caso (`error.md:157`).
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    reportarError(error, "dashboard")
  }, [error])

  const codigo = codigoDeReporte(error)

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <span className="grid size-11 place-items-center rounded-full bg-warn-soft">
          <TriangleAlert className="size-5 text-warn" aria-hidden />
        </span>

        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-xl font-semibold">Esta pantalla falló</h1>
          <p className="text-sm text-fg-muted">
            El resto de la plataforma sigue funcionando. Podés reintentar acá mismo o irte a otra
            sección — no se perdió nada de lo que ya estaba guardado.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => unstable_retry()}>
            <RotateCw className="size-4" /> Reintentar
          </Button>
          <Button variant="outline" render={<Link href="/dashboard" />}>
            Ir al inicio
          </Button>
        </div>

        {/* EL CÓDIGO SE MUESTRA A PROPÓSITO. En producción Next no manda el mensaje real al
            navegador — manda este hash, que también queda en los logs del servidor. Sin él, un
            "se me rompió" del vet es irrastreable. */}
        {codigo && (
          <p className="text-xs text-fg-faint">
            Si vuelve a pasar, pasá este código:{" "}
            <code className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono">{codigo}</code>
          </p>
        )}
      </div>
    </div>
  )
}
