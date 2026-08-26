import { Building2Icon } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"

// La clínica en la que estás trabajando.
//
// ── COLAPSADA SIGUE ESTANDO, Y ANTES NO ────────────────────────────────────────────────────────
//
// El bloque entero era `group-data-[collapsible=icon]:hidden`: al angostar la barra, la clínica
// desaparecía. Con varias clínicas por cuenta eso es justamente el dato que no se puede perder —
// quedaba una barra de iconos idéntica para todas, sin nada que dijera en cuál estás.
//
// En la barra angosta se queda SÓLO EL LOGO, centrado y del mismo tamaño que los iconos de
// navegación para que la columna no se quiebre. El nombre pasa al `title`.

export function NavClinic({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* UNA SOLA LÍNEA, y no dos. El rótulo «Veterinaria» encima del nombre costaba 15 px de
            alto para decir algo que el producto entero ya dice — esto es una app veterinaria y el
            nombre de abajo empieza por «Clínica de…». Esos 15 px son alto de barra, que es lo
            escaso: con el rótulo, en un portátil de 768 px el contenido desbordaba y los últimos
            ítems quedaban escondidos tras el scroll (medido, 26-ago). El nombre completo sigue
            entero en el `title` para cuando se trunca. */}
        <div
          title={`Veterinaria ${name}`}
          className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0"
        >
          <Avatar className="size-7 rounded-lg">
            <AvatarImage src={logoUrl ?? undefined} alt={name} />
            <AvatarFallback className="rounded-lg">
              <Building2Icon className="size-4" />
            </AvatarFallback>
          </Avatar>
          {/* El texto se va con la barra angosta; el logo se queda. */}
          <span className="min-w-0 flex-1 truncate text-left text-sm font-medium group-data-[collapsible=icon]:hidden">
            {name}
          </span>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
