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
        <div
          title={`Veterinaria ${name}`}
          className="flex items-center gap-2 rounded-lg border bg-card px-2 py-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0"
        >
          <Avatar className="size-8 rounded-lg group-data-[collapsible=icon]:size-7">
            <AvatarImage src={logoUrl ?? undefined} alt={name} />
            <AvatarFallback className="rounded-lg">
              <Building2Icon className="size-4" />
            </AvatarFallback>
          </Avatar>
          {/* El texto se va con la barra angosta; el logo se queda. */}
          <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-xs text-muted-foreground">Veterinaria</span>
            <span className="truncate font-medium">{name}</span>
          </div>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
