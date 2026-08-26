"use client"

import { usePathname } from "next/navigation"
import { SearchIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { FormularioDeFiltros } from "@/components/ui/formulario-de-filtros"

// `/dashboard/facturacion` faltaba acá, así que sus DIECISÉIS páginas se titulaban "Dashboard":
// `titleFor` caía al valor por defecto. Cada sección que aparece en el sidebar tiene que tener su
// entrada, y las rutas anidadas se resuelven por prefijo más largo.
const TITLES: Record<string, string> = {
  "/dashboard/tablero": "Dashboard",
  "/dashboard/asistente": "Athos",
  "/dashboard/consultas": "Modo Fantasma",
  "/dashboard/patients": "Pacientes",
  "/dashboard/owners": "Titulares",
  "/dashboard/calendario": "Agenda",
  "/dashboard/facturacion": "Ventas",
  "/dashboard/comunicaciones": "Comunicaciones",
  "/dashboard/conexiones": "Integraciones",
  "/dashboard/administracion": "Administración",
  "/dashboard/administracion/clinica": "Configuración",
  "/dashboard/settings": "Configuración",
  "/dashboard/ayuda": "Ayuda",
}

function titleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname]
  // coincidencia por prefijo para rutas anidadas (p.ej. /dashboard/consultas/[id])
  const match = Object.keys(TITLES)
    .filter((p) => p !== "/dashboard" && pathname.startsWith(p + "/"))
    .sort((a, b) => b.length - a.length)[0]
  return match ? TITLES[match] : "Dashboard"
}

export function SiteHeader() {
  const pathname = usePathname()
  const title = titleFor(pathname)

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 h-4 data-vertical:self-auto" />
        {/* ES UN <p>, NO UN <h1>. Esto rotula la SECCIÓN en la que estás —vive al lado del trigger
            de la barra, en la altura de la navegación— y no es el encabezado de la página: ése lo
            pone cada pantalla (`PageShell`, o su propio <h1>).

            Eran dos <h1> visibles a la vez, y en las subpantallas decían cosas distintas: medido en
            producción, `/dashboard/facturacion/cartera` daba `["Ventas", "Cartera"]`. Un lector de
            pantalla anunciaba dos encabezados de nivel 1 para una página con un solo tema. */}
        {/* `min-w-0 truncate`: el título es el único texto flexible de esta fila — sin esto, un
            rótulo largo en una ventana angosta empujaba al buscador fuera y la cabecera entera a
            scroll horizontal. Truncar el rótulo es barato; cortar la página no. */}
        <p className="min-w-0 truncate text-base font-medium">{title}</p>

        {/* Buscador global, igual que el del cliente: un <form> GET, sin estado ni JS. Escribir no
            dispara nada; sólo al enviar se navega. El destino es Pacientes porque su explorador ya
            filtra por mascota, titular y teléfono — es decir, por lo que promete el placeholder. */}
        {/* NAVEGA POR EL CLIENTE, y acá es lo que más importa: este buscador está en la cabecera de
            TODAS las pantallas. Enviándolo de forma nativa recargaba el documento desde cualquier
            sitio — con una grabación en curso, eso es el aviso de «¿salir del sitio?» y la consulta
            perdida. Es el camino que hacía ver el fallo como intermitente después de arreglar el
            menú lateral. Ver `lib/busqueda-en-la-url.ts`. */}
        <FormularioDeFiltros action="/dashboard/patients" className="ml-auto hidden min-w-0 md:block">
          {/* Ancho MÁXIMO, no fijo: `w-[260px]` a secas exigía sus píxeles aunque no los hubiera
              — entre 768 y ~900 px de ventana la cabecera pedía ~510 px donde había ~464, y el
              sobrante desbordaba la página entera. Con max-w el buscador cede antes que la fila. */}
          <div className="relative w-full min-w-[140px] max-w-[260px] lg:max-w-[300px]">
            <SearchIcon
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              name="q"
              placeholder="Buscar paciente, titular, teléfono…"
              aria-label="Buscar paciente, titular o teléfono"
              className="h-8 pl-8"
            />
          </div>
        </FormularioDeFiltros>

        <ThemeToggle className="ml-auto size-8 md:ml-0" />
      </div>
    </header>
  )
}
