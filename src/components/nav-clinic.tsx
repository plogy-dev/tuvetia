import { Building2Icon } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"

export function NavClinic({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return (
    <SidebarMenu className="group-data-[collapsible=icon]:hidden">
      <SidebarMenuItem>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-2 py-2">
          <Avatar className="size-8 rounded-lg">
            <AvatarImage src={logoUrl ?? undefined} alt={name} />
            <AvatarFallback className="rounded-lg">
              <Building2Icon className="size-4" />
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate text-xs text-muted-foreground">Veterinaria</span>
            <span className="truncate font-medium">{name}</span>
          </div>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
