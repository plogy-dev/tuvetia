"use client"

// El marco del modal de «Registrar venta».
//
// ── CERRAR ES VOLVER ──────────────────────────────────────────────────────────────────────────
//
// El modal ES una ruta (ranura paralela + ruta interceptora), así que cerrarlo es `router.back()` y
// no apagar un booleano. Eso hace que el botón «atrás» del navegador cierre el modal en vez de
// sacar al vet del módulo — que es el defecto clásico de los modales que viven en `useState`.
//
// ── LO QUE UN MODAL TIENE QUE HACER Y CASI NADIE HACE ─────────────────────────────────────────
//
// · CERRAR CON ESCAPE. Es lo primero que prueba cualquiera.
// · CERRAR AL TOCAR AFUERA — pero SÓLO si el gesto empezó afuera. Sin esa comprobación, seleccionar
//   texto dentro del formulario y soltar el mouse sobre el fondo cierra el modal y se pierde la
//   cuenta a medio armar. Es un defecto real y molesto, y se evita mirando dónde empezó el clic.
// · NO DEJAR QUE EL FONDO SE DESPLACE detrás del modal.
// · DEVOLVER EL FOCO Y ANUNCIARSE: `role="dialog"` + `aria-modal` + un título asociado, o para un
//   lector de pantalla esto es un montón de texto que apareció de la nada.
//
// ── LO QUE NO HACE ────────────────────────────────────────────────────────────────────────────
//
// No atrapa el foco dentro del diálogo (focus trap). Con `aria-modal` los lectores de pantalla ya
// lo tratan como una capa aparte, y meter una trampa de foco a mano suele salir peor que no
// ponerla. Si algún día entra un componente de diálogo de la librería, esto se reemplaza por él.

import { useCallback, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { X } from "lucide-react"

export function ModalDeVenta({
  titulo = "Nueva cuenta",
  children,
}: {
  titulo?: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const fondo = useRef<HTMLDivElement | null>(null)
  /** Dónde empezó el gesto. Sin esto, arrastrar una selección hasta el fondo cerraría el modal. */
  const empezoEnElFondo = useRef(false)

  const cerrar = useCallback(() => router.back(), [router])

  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key === "Escape") cerrar()
    }
    document.addEventListener("keydown", alTeclear)
    // El fondo no se desplaza mientras el modal está abierto: perder el sitio del libro de ventas
    // es justamente lo que este modal viene a evitar.
    const overflowPrevio = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", alTeclear)
      document.body.style.overflow = overflowPrevio
    }
  }, [cerrar])

  return (
    <div
      ref={fondo}
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-del-modal-de-venta"
      onMouseDown={(e) => {
        empezoEnElFondo.current = e.target === fondo.current
      }}
      onMouseUp={(e) => {
        if (empezoEnElFondo.current && e.target === fondo.current) cerrar()
        empezoEnElFondo.current = false
      }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-[2px] sm:p-8"
    >
      <div className="w-full max-w-4xl rounded-2xl border border-line bg-surface shadow-xl">
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 id="titulo-del-modal-de-venta" className="text-lg font-semibold text-fg">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={cerrar}
            aria-label="Cerrar"
            className="rounded-md p-1 text-fg-faint transition hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  )
}
