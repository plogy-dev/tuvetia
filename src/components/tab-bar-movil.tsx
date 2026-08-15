"use client"

// La barra inferior del mockup, en móvil.
//
// POR QUÉ NO ALCANZABA CON EL DRAWER. La barra lateral en móvil vive detrás de un botón de menú:
// para llegar a cualquier lado hay que abrir el cajón, buscar el ítem y tocarlo. Tres gestos para
// algo que se hace veinte veces al día, y con la mano que además sostiene un perro.
//
// El mockup pone las cuatro pantallas que se usan en consultorio a un pulgar de distancia, y
// TOMANOTAS AL CENTRO Y ELEVADO — que es la decisión que importa: grabar una consulta es la acción
// del producto, no una opción de menú.
//
// El cajón no desaparece: "Menú" lo abre, y ahí siguen las secciones que no caben acá.

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BotIcon,
  CalendarIcon,
  GhostIcon,
  MenuIcon,
  UsersIcon,
} from "lucide-react"

import { useSidebar } from "@/components/ui/sidebar"
import { isNavActive } from "@/lib/nav-active"

const DESTINOS = [
  { titulo: "Athos", url: "/dashboard/asistente", icono: BotIcon },
  { titulo: "Pacientes", url: "/dashboard/patients", icono: UsersIcon },
] as const

const DESTINOS_DERECHA = [
  { titulo: "Agenda", url: "/dashboard/calendario", icono: CalendarIcon },
] as const

function Item({
  titulo,
  url,
  Icono,
  activo,
}: {
  titulo: string
  url: string
  Icono: typeof BotIcon
  activo: boolean
}) {
  return (
    <Link
      href={url}
      // 56×48 es el mínimo del mockup y también el mínimo táctil razonable: por debajo de eso se
      // falla el toque y se navega a otro lado.
      className={`flex min-h-12 min-w-14 flex-col items-center gap-1 text-[10px] ${
        activo ? "text-brand-text" : "text-fg-muted"
      }`}
    >
      <Icono aria-hidden className="size-[22px]" strokeWidth={1.4} />
      {titulo}
    </Link>
  )
}

export function TabBarMovil() {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()

  return (
    // `md:hidden`: en escritorio manda la barra lateral. `pb-[env(safe-area-inset-bottom)]` para que
    // en un iPhone los ítems no queden bajo la barra de gestos del sistema.
    <nav
      aria-label="Navegación principal"
      className="sticky bottom-0 z-50 flex items-center justify-around border-t border-line bg-surface px-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 md:hidden"
    >
      {DESTINOS.map((d) => (
        <Item
          key={d.url}
          titulo={d.titulo}
          url={d.url}
          Icono={d.icono}
          activo={isNavActive(pathname, d.url)}
        />
      ))}

      {/* TOMANOTAS AL CENTRO Y ELEVADO. El círculo sale de la barra con `-mt-3.5` y lleva un borde
          del color de la superficie, que es lo que produce el efecto de estar por encima en vez de
          pegado. Es el único menta relleno de esta barra: la acción del producto. */}
      <Link
        href="/dashboard/consultas"
        className={`flex min-h-12 min-w-16 flex-col items-center gap-1 text-[10px] ${
          isNavActive(pathname, "/dashboard/consultas") ? "text-brand-text" : "text-fg-muted"
        }`}
      >
        <span className="-mt-3.5 grid size-11 place-items-center rounded-full border-[3px] border-surface bg-brand text-on-brand">
          <GhostIcon aria-hidden className="size-[22px]" strokeWidth={1.5} />
        </span>
        {/* "Fantasma" y no "Modo Fantasma": son 64px de ancho a 10px y el nombre completo se
            parte en dos líneas. Es una ABREVIATURA de la marca, no un segundo nombre — que es
            justo lo que decía "Tomanotas" y lo que el cliente pidió corregir. */}
        Fantasma
      </Link>

      {DESTINOS_DERECHA.map((d) => (
        <Item
          key={d.url}
          titulo={d.titulo}
          url={d.url}
          Icono={d.icono}
          activo={isNavActive(pathname, d.url)}
        />
      ))}

      {/* "Menú" abre el cajón que ya existe. No se duplica la navegación: lo que no cabe en cinco
          ítems sigue viviendo en un solo lugar. */}
      <button
        type="button"
        onClick={() => setOpenMobile(true)}
        className="flex min-h-12 min-w-14 flex-col items-center gap-1 text-[10px] text-fg-muted"
      >
        <MenuIcon aria-hidden className="size-[22px]" strokeWidth={1.4} />
        Menú
      </button>
    </nav>
  )
}
