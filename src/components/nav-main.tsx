"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { CreatePatientDrawer } from "@/components/create-patient-drawer"
import { createClient } from "@/lib/supabase/client"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { SparklesIcon } from "lucide-react"

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
    <Button
      size="icon"
      className="relative size-8 group-data-[collapsible=icon]:opacity-0"
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

export function NavMain({
  items,
}: {
  items: {
    title: string
    url: string
    icon?: React.ReactNode
  }[]
}) {
  const pathname = usePathname()

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
            <CreatePatientDrawer />
            <PendingProposalsButton />
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={item.url !== "#" && pathname === item.url}
                render={<a href={item.url} />}
              >
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
