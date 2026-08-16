// El 404 de la app.
//
// Hasta hoy no existía, así que una URL mal escrita —`/dashboard/pacientes` en vez de
// `/dashboard/patients`, que es un error fácil porque la etiqueta del menú está en español y el
// segmento no— devolvía la pantalla por defecto de Next: fondo negro, tipografía del sistema y
// "This page could not be found" en inglés. Para un vet colombiano eso no parece un enlace roto,
// parece que la plataforma se cayó.
//
// NO lleva "use client": un `not-found.tsx` no es un boundary de error, es una página normal, y no
// recibe props. Se muestra por `notFound()` o por una ruta que no existe.

import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function NoEncontrado() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="font-mono text-sm tracking-[0.2em] text-fg-faint">404</span>

      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-semibold">Esta página no existe</h1>
        <p className="max-w-sm text-sm text-fg-muted">
          Puede que el enlace esté mal escrito o que la página haya cambiado de lugar.
        </p>
      </div>

      <Button render={<Link href="/dashboard" />}>Volver al inicio</Button>
    </main>
  )
}
