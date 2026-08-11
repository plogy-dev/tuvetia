"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { CreatePatientDrawer } from "@/components/create-patient-drawer"
import { NewConsultationDrawer } from "@/components/new-consultation-drawer"
import { createClient } from "@/lib/supabase/client"
import { isNavActive } from "@/lib/nav-active"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { SparklesIcon } from "lucide-react"

export type NavItem = {
  title: string
  url: string
  icon?: React.ReactNode
}

export type NavGroup = {
  /** El rótulo del mockup: CONSULTORIO / CRM. */
  label: string
  items: NavItem[]
}

// Badge de propuestas de Athos pendientes de aprobación (athos_actions status=proposed, RLS).
function PendingProposalsButton() {
  const [supabase] = useState(() => createClient())
  const [count, setCount] = useState(0)
  useEffect(() => {
    let alive = true
    async function load() {
      const { count: c } = await supabase
        .from("athos_actions")
        .select("id", { count: "exact", head: true })
        .eq("status", "proposed")
      if (alive) setCount(c ?? 0)
    }
    void load()
    const t = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [supabase])

  return (
    // `hidden`, no `opacity-0`: con opacidad cero el botón seguía ocupando su hueco y seguía
    // siendo clicable — un enlace invisible a Comunicaciones en la barra angosta.
    <Button
      size="icon"
      className="relative size-8 group-data-[collapsible=icon]:hidden"
      variant="outline"
      title={count > 0 ? `${count} propuesta(s) de Athos pendientes` : "Propuestas de Athos"}
      render={<Link href="/dashboard/comunicaciones" />}
    >
      <SparklesIcon />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-brand text-[9px] font-bold text-on-brand">
          {count > 9 ? "9+" : count}
        </span>
      )}
      <span className="sr-only">Propuestas de Athos</span>
    </Button>
  )
}

/** El rótulo de grupo, con la forma que pide el mockup: 11px, 600, tracking abierto, versalitas. */
function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
      {children}
    </SidebarGroupLabel>
  )
}

function Items({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.title}>
          {/* OJO: `onboarding-tour.tsx` engancha sus pasos con selectores CSS sobre
              `a[href="/dashboard/..."]`, y hay un test que lo cubre
              (`__tests__/onboarding-tour-anclas.test.ts`). Estos ítems tienen que seguir
              renderizando un <a href> de verdad y visible. */}
          <SidebarMenuButton
            tooltip={item.title}
            isActive={isNavActive(pathname, item.url)}
            render={<a href={item.url} />}
          >
            {item.icon}
            <span>{item.title}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

/**
 * La navegación partida en dos, que es lo que pidió el cliente: "en la barra lateral tiene la
 * división de consultorio y crm. En el consultorio tiene el athos y el phantom, es decir todo lo
 * necesario para la consulta y en el CRM tiene lo demás."
 *
 * Antes era una sola lista plana de nueve ítems donde Athos encabezaba sin ningún rótulo. La
 * división no es cosmética: separa lo que se usa CON UN PACIENTE DELANTE de lo que se usa entre
 * consultas, que son dos modos de trabajo distintos y con urgencias distintas.
 *
 * LOS ICONOS SE QUEDAN, AUNQUE EL MOCKUP USE PUNTITOS. La barra es `collapsible="icon"`: colapsada
 * muestra ÚNICAMENTE el icono de cada ítem. Cambiarlos por los indicadores del mockup dejaría siete
 * puntos idénticos e indistinguibles, o sea una barra colapsada inutilizable.
 */
export function NavMain({ consultorio, crm }: { consultorio: NavItem[]; crm: NavItem[] }) {
  return (
    <>
      <SidebarGroup>
        <Rotulo>Consultorio</Rotulo>
        <SidebarGroupContent className="flex flex-col gap-2">
          <Items items={consultorio} />
          {/* "Iniciar consulta" vive DENTRO del consultorio, no suelta al final de la barra: es la
              acción del grupo que la contiene. Reusa el drawer de la página de Consultas — sólo
              cambia dónde se monta. */}
          <SidebarMenu>
            <SidebarMenuItem>
              <NewConsultationDrawer
                label="Iniciar consulta"
                trigger={
                  <SidebarMenuButton
                    tooltip="Iniciar consulta"
                    className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  />
                }
              />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {/* El divisor del mockup: la línea es lo que hace legible que son dos mundos, no dos rótulos. */}
      <SidebarGroup className="mt-1 border-t border-line-soft pt-3">
        <Rotulo>CRM</Rotulo>
        <SidebarGroupContent className="flex flex-col gap-2">
          <Items items={crm} />
          <SidebarMenu>
            <SidebarMenuItem className="flex items-center gap-2">
              <CreatePatientDrawer
                label="Nuevo paciente"
                trigger={<SidebarMenuButton variant="outline" tooltip="Nuevo paciente" />}
              />
              <PendingProposalsButton />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  )
}
