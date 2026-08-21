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

/**
 * El indicador del ítem: un punto, no un icono.
 *
 * Es lo que pidió el cliente el 12-ago —«quitar los iconos y reemplazarlo por los circulitos verdes
 * que hiciste»— y lo que el mockup ya dibujaba: punto menta relleno para lo de la CONSULTA, aro sin
 * relleno para lo del CRM. La diferencia no es decorativa: distingue de un vistazo lo que se usa con
 * un paciente delante de lo que se usa entre consultas, que es el corte que el propio cliente pidió
 * para la barra.
 *
 * Ocupa una caja de 16px, la misma que ocupaba el icono, para que el texto de todos los ítems siga
 * alineado y para que pasar a la barra colapsada no mueva nada.
 */
function Indicador({ grupo }: { grupo: "consulta" | "crm" }) {
  return (
    <span
      aria-hidden
      // Se esconde al colapsar: ahí manda el icono. Ver el comentario de `NavMain`.
      className="grid size-4 shrink-0 place-items-center group-data-[collapsible=icon]:hidden"
    >
      <span
        className={
          grupo === "consulta"
            ? "size-2 rounded-full bg-brand"
            : "size-2 rounded-full border border-line-strong"
        }
      />
    </span>
  )
}

function Items({ items, grupo }: { items: NavItem[]; grupo: "consulta" | "crm" }) {
  const pathname = usePathname()
  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.title}>
          {/* `<Link>` Y NO `<a href>`, Y NO ES COSMÉTICO — ver el comentario largo de `NavMain`.
              Un ancla cruda a una ruta interna recarga el documento entero y mata la grabación
              en curso.

              OJO: `onboarding-tour.tsx` engancha sus pasos con selectores CSS sobre
              `a[href="/dashboard/..."]`, y hay un test que lo cubre
              (`__tests__/onboarding-tour-anclas.test.ts`). `<Link>` renderiza un `<a href>` de
              verdad en el DOM, así que el selector sigue valiendo. */}
          <SidebarMenuButton
            tooltip={item.title}
            isActive={isNavActive(pathname, item.url)}
            render={<Link href={item.url} />}
          >
            <Indicador grupo={grupo} />
            {/* El icono SÓLO existe en la barra colapsada. Ahí el punto no sirve —serían siete
                puntos idénticos en una columna de 48px— y el icono es lo único que distingue un
                ítem de otro. */}
            <span className="hidden group-data-[collapsible=icon]:contents">{item.icon}</span>
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
 * PUNTOS EXPANDIDA, ICONOS COLAPSADA — y las dos cosas a la vez, que es lo que destraba el problema.
 *
 * El cliente pidió el 12-ago «quitar los iconos y reemplazarlo por los circulitos verdes», y el
 * mockup ya los dibujaba. La objeción que este archivo tenía escrita era real pero PARCIAL: la barra
 * es `collapsible="icon"` y colapsada mide 48px, así que ahí siete puntos idénticos serían
 * inutilizables. Sólo que eso vale para el modo colapsado, no para el expandido.
 *
 * Así que se renderizan los dos y se alternan por estado de la barra: el punto lleva
 * `group-data-[collapsible=icon]:hidden` y el icono `hidden group-data-[collapsible=icon]:contents`.
 * El pedido se cumple donde el vet mira, y la barra angosta conserva lo único que la hace usable.
 *
 * `contents` y no `block` en el icono: `SidebarMenuButton` es un flex con `gap-2` y estilos que
 * apuntan al `svg` como hijo. Un `<span>` de por medio con display propio agregaría una caja al
 * flex y descuadraría el centrado de 32×32 de la barra colapsada; con `contents` el envoltorio no
 * genera caja y el svg queda como hijo directo a efectos de layout.
 *
 * SE NAVEGA CON `<Link>`, NUNCA CON `<a href>`. Es la causa raíz de que el notch de grabación
 * desapareciera, reportada en vivo en la reunión del 17-ago: se empezaba a grabar, se tocaba
 * cualquier ítem de esta barra, el navegador preguntaba «¿salir del sitio?» y la sesión moría.
 *
 * En Next, un `<a href>` a una ruta interna NO navega por el cliente: descarga el documento de
 * nuevo. Y una grabación no sobrevive a eso —`MediaRecorder` y los blobs mueren con el documento,
 * y `getUserMedia` no se re-adquiere sin un gesto del usuario; está escrito en `sesion.ts`—. El
 * diálogo que veía el cliente era el `beforeunload` que la propia sesión engancha para avisar.
 *
 * El store de `consulta-viva` YA estaba hecho para sobrevivir a la navegación: su cerrojo de sesión
 * única existe porque «antes navegar cortaba la grabación, así que no podía haber dos». Esa
 * persistencia nunca llegó a funcionar porque esta barra recargaba la página. Con `<Link>` la
 * navegación es del cliente, el módulo no se reinicia y la sesión sigue viva.
 *
 * De paso deja de recargarse la app entera en cada clic del menú, que era el costo que esto tenía
 * incluso sin grabar.
 */
export function NavMain({ consultorio, crm }: { consultorio: NavItem[]; crm: NavItem[] }) {
  return (
    <>
      {/* CLÍNICA ARRIBA, CONSULTA ABAJO. Lo invirtió Luciano el 19-ago: "yo lo que haría es
          intercambiar clínica por consulta y consulta abajo".
          Tiene sentido con el orden nuevo: la jornada empieza mirando cómo está la clínica —
          dashboard, pacientes, agenda— y la consulta es lo que se abre cuando llega el animal. */}
      <SidebarGroup>
        <Rotulo>Clínica</Rotulo>
        <SidebarGroupContent className="flex flex-col gap-2">
          <Items items={crm} grupo="crm" />
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

      {/* El divisor: la línea es lo que hace legible que son dos mundos, no dos rótulos. */}
      <SidebarGroup className="mt-1 border-t border-line-soft pt-3">
        <Rotulo>Consulta</Rotulo>
        <SidebarGroupContent className="flex flex-col gap-2">
          <Items items={consultorio} grupo="consulta" />
          {/* "Iniciar consulta" vive DENTRO del grupo de la consulta: es la acción del grupo que la
              contiene. Reusa el drawer de la página de Consultas — sólo cambia dónde se monta.

              MENTA RELLENO, y es un cambio del 19-ago: "esto siempre mantenerlo como un botón que
              sobresalga con el color que teníamos antes, un verdecito" (Luciano).
              Estaba en `outline` con el argumento de que el menta se reserva para la acción de la
              PANTALLA en la que estás, y que un botón menta permanente compite con todas. El
              cliente decidió lo contrario, y su razón es mejor: iniciar una consulta no compite con
              las acciones de las pantallas, es LA acción del producto — todo lo demás existe
              alrededor de ella. */}
          <SidebarMenu>
            <SidebarMenuItem>
              <NewConsultationDrawer
                label="Iniciar consulta"
                trigger={
                  /* `[&>span]:hidden` EN MODO ICONO, Y NO ES COSMÉTICO: es lo que centra el `+`.

                     Colapsada, la barra fuerza el botón a `size-8` con `p-2` y `overflow-hidden`
                     (ver `sidebarMenuButtonVariants`), pero la ETIQUETA SIGUE OCUPANDO ESPACIO en el
                     flex. Con `justify-center`, el centrado se calcula sobre `icono + gap + texto`
                     —bastante más ancho que los 32px de la caja— y el desborde recorta la derecha:
                     el icono termina corrido a la izquierda.

                     Los demás ítems no sufren esto porque NO llevan `justify-center`: su icono queda
                     pegado al padding izquierdo, que en `p-2` + `size-8` da centrado por aritmética.
                     Acá el botón sí lo necesita —es el único con relleno menta, y sin centrar de
                     verdad se nota—, así que se resuelve sacando del cálculo lo que no se ve. */
                  <SidebarMenuButton
                    tooltip="Iniciar consulta"
                    className="min-w-8 justify-center bg-brand font-medium text-on-brand group-data-[collapsible=icon]:[&>span]:hidden hover:bg-brand-deep hover:text-on-brand active:bg-brand-deep active:text-on-brand"
                  />
                }
              />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  )
}
