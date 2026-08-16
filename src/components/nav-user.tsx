"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { EllipsisVerticalIcon, LogOutIcon, SettingsIcon } from "lucide-react"
import { rolLegible } from "@/lib/roles"

// Este menú traía "Account", "Billing" y "Notifications" de la plantilla `dashboard-01` de shadcn:
// tres ítems en inglés, sin `onClick` y sin destino, visibles en las 30+ pantallas del dashboard.
// Se van. Queda lo que existe de verdad: Configuración (que ya es una ruta) y cerrar sesión.

export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    avatar: string
    /** `profiles.role`. Puede faltar: el layout lo lee del mismo perfil, que puede no existir. */
    role: string | null
  }
}) {
  const { isMobile } = useSidebar()
  const router = useRouter()
  // El mockup pone el ROL bajo el nombre, no el correo. Es mejor dato para ese lugar: el correo ya
  // se sabe (es con lo que se entró) y no dice nada de lo que se puede hacer; el rol sí — es la
  // diferencia entre poder invitar al equipo o no. El correo no se pierde: queda en el desplegable,
  // que es donde se lo busca cuando hace falta ("¿con cuál cuenta estoy?").
  //
  // Si el rol no se reconoce cae al correo en vez de dejar la línea vacía, que descuadraría el alto
  // de la fila contra el resto de la barra.
  const rol = rolLegible(user.role)

  async function handleLogOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />
            }
          >
            {/* CIRCULAR, las dos veces. Antes este avatar era `rounded-lg` y el del desplegable
                —once líneas más abajo— circular: dos formas para la misma persona. Y adentro del
                segundo era peor todavía, la imagen circular y su fallback cuadrado.

                Se unifican en círculo y no en cuadrado redondeado porque es una PERSONA, y porque
                el cliente pidió expresamente elementos más circulares. El logo de la clínica
                (`nav-clinic.tsx`) sí se queda cuadrado-redondeado: un logo metido en un círculo se
                recorta mal. */}
            <Avatar className="size-8 grayscale">
              <AvatarImage src={user.avatar} alt={user.name} />
              <AvatarFallback>CN</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-xs text-foreground/70">
                {rol ?? user.email}
              </span>
            </div>
            <EllipsisVerticalIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="size-8">
                    <AvatarImage src={user.avatar} alt={user.name} />
                    <AvatarFallback>CN</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/dashboard/settings" />}>
              <SettingsIcon />
              Configuración
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogOut}>
              <LogOutIcon />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
