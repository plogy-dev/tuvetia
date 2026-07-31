"use client"

import { usePathname } from "next/navigation"
import { SearchIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/theme-toggle"

// `/dashboard/facturacion` faltaba acá, así que sus DIECISÉIS páginas se titulaban "Dashboard":
// `titleFor` caía al valor por defecto. Cada sección que aparece en el sidebar tiene que tener su
// entrada, y las rutas anidadas se resuelven por prefijo más largo.
const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/asistente": "Athos",
  "/dashboard/consultas": "Modo Fantasma",
  "/dashboard/patients": "Pacientes",
  "/dashboard/owners": "Titulares",
  "/dashboard/calendario": "Calendario",
  "/dashboard/facturacion": "Facturación",
  "/dashboard/comunicaciones": "Comunicaciones",
  "/dashboard/conexiones": "Conexiones",
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
        <h1 className="text-base font-medium">{title}</h1>

        {/* Buscador global, igual que el del cliente: un <form> GET, sin estado ni JS. Escribir no
            dispara nada; sólo al enviar se navega. El destino es Pacientes porque su explorador ya
            filtra por mascota, titular y teléfono — es decir, por lo que promete el placeholder. */}
        <form action="/dashboard/patients" method="get" className="ml-auto hidden md:block">
          <div className="relative w-[260px] lg:w-[300px]">
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
        </form>

        <ThemeToggle className="ml-auto size-8 md:ml-0" />
      </div>
    </header>
  )
}
