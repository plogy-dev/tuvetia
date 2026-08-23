"use client"

// Un formulario de filtros que navega por el cliente, no recargando la página.
//
// POR QUÉ EXISTE. Ver `lib/busqueda-en-la-url.ts`: un `<form method="get">` nativo descarga el
// documento entero, y con una grabación en curso eso dispara el aviso de «¿salir del sitio?» y mata
// la consulta. Es el mismo bug que las anclas crudas del menú, por otro camino — y estaba en el
// buscador de la pantalla del Modo Fantasma, o sea justo donde más duele.
//
// MEJORA PROGRESIVA, NO REEMPLAZO. El `action` y el `method="get"` se conservan: sin JavaScript el
// navegador hace lo de siempre y el filtro funciona igual. Con JavaScript se intercepta y navega el
// router. Quitar el `action` habría dejado un formulario que no hace nada sin JS.
//
// SE QUEDA EN `ui/` porque lo usan cuatro pantallas —consultas, factura nueva, movimientos de
// inventario y finanzas— y las cuatro tenían el mismo formulario copiado.

import { useRouter } from "next/navigation"

import { rutaConBusqueda } from "@/lib/busqueda-en-la-url"

export function FormularioDeFiltros({
  /** A dónde navega. Normalmente la ruta de la propia pantalla. */
  action,
  className,
  children,
}: {
  action: string
  className?: string
  children: React.ReactNode
}) {
  const router = useRouter()

  return (
    <form
      action={action}
      method="get"
      className={className}
      onSubmit={(e) => {
        e.preventDefault()
        router.push(rutaConBusqueda(action, new FormData(e.currentTarget)))
      }}
    >
      {children}
    </form>
  )
}
