import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { AppSidebar } from "@/components/app-sidebar"
import { CuentaDesactivada } from "@/components/cuenta-desactivada"
import { estadoDeAcceso } from "@/lib/acceso"
import { SiteHeader } from "@/components/site-header"
import { TabBarMovil } from "@/components/tab-bar-movil"
import { OnboardingTour } from "@/components/onboarding-tour"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { createClient } from "@/lib/supabase/server"
import { progresoDeConfiguracion } from "@/lib/onboarding/consultar"
import { AthosProvider } from "@/components/athos/athos-provider"
import { AthosDock } from "@/components/athos/athos-dock"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const profile = user
    ? (
        await supabase
          .from("profiles")
          // `role` es para el pie de la barra lateral e `is_active` para el gate de cuenta
          // desactivada. Van en ESTE select y no en consultas aparte: el perfil ya se estaba
          // trayendo, así que las dos columnas salen gratis.
          .select("full_name, onboarded_at, clinic_id, setup_completed_at, role, is_active")
          .eq("id", user.id)
          .single()
      ).data
    : null

  // Vet nuevo (creador de clínica) sin el wizard completado -> a /bienvenida. Los invitados nunca
  // caen aquí (accept_invitation marca setup_completed_at) ni los usuarios preexistentes (backfill 0017).
  const p = profile as {
    full_name: string | null
    onboarded_at: string | null
    clinic_id: string | null
    setup_completed_at: string | null
    role: string | null
    is_active: boolean | null
  } | null
  // Adónde va este usuario. El orden vive en `lib/acceso.ts` y está probado ahí — se toma la misma
  // decisión en `/bienvenida`, y las dos ya se desincronizaron una vez con un lazo de redirecciones.
  const acceso = estadoDeAcceso(p)

  // CUENTA DESACTIVADA. Se atiende ANTES de cualquier redirección: con el gate de la migración 0059
  // la RLS deja de mostrarle su clínica, así que sin esto caería en /bienvenida y la app le diría
  // «no tienes clínica» — que se lee como «tus datos se perdieron».
  if (user && acceso === "desactivada") return <CuentaDesactivada correo={user.email} />

  // Falta terminar el onboarding **o** no hay clínica -> a /bienvenida, que atiende los dos casos.
  // Antes la condición exigía `p?.clinic_id &&`, así que un usuario sin clínica (invitación
  // pendiente sin aceptar, o trigger que no corrió) caía en un dashboard vacío con todo en cero y
  // sin ninguna pista. No hay lazo: /bienvenida ya NO rebota acá cuando falta la clínica.
  if (user && acceso !== "activo") redirect("/bienvenida")

  const { data: clinic } = p?.clinic_id
    ? await supabase.from("clinics").select("name, logo_url").eq("id", p.clinic_id).maybeSingle()
    : { data: null }
  const c = clinic as { name: string; logo_url: string | null } | null

  const sidebarUser = {
    name: profile?.full_name || user?.email || "Usuario",
    email: user?.email ?? "",
    avatar: "",
    role: p?.role ?? null,
  }
  const sidebarClinic = { name: c?.name ?? "Tuvetia", logoUrl: c?.logo_url ?? null }

  // `ui/sidebar.tsx` guarda el colapso en la cookie `sidebar_state` desde siempre, pero nadie la
  // leía: `SidebarProvider` se montaba con su `defaultOpen = true` y la barra volvía a abrirse en
  // cada recarga. El nombre tiene que seguir a `SIDEBAR_COOKIE_NAME`. Por defecto abierta: sólo un
  // "false" explícito la colapsa.
  //
  // No cambia el renderizado: este layout ya era dinámico porque `createClient()` lee cookies.
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false"

  return (
    <SidebarProvider
      className="app-theme"
      defaultOpen={sidebarOpen}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      {/* `AthosProvider` envuelve el panel entero porque el widget necesita saber en qué pantalla
          está el vet. Sólo expone lo que se deriva de la RUTA, que cambia cuando el árbol se
          re-renderiza igual — nada mutable vive acá. El estado del widget vive en `AthosDock`, que
          es HERMANO de `{children}` y por eso abrirlo no re-renderiza ninguna pantalla.
          `clinic_id` y el nombre ya están resueltos arriba: el widget arranca sin una sola query. */}
      <AthosProvider clinicId={p?.clinic_id ?? null} clinicName={sidebarClinic.name}>
        {/* `progresoDeConfiguracion()` está envuelto en `cache()` de React: el dashboard lo vuelve
            a llamar para pintar el riel completo y comparten el mismo round-trip, en vez de correr
            la tanda de conteos dos veces por carga. */}
        <AppSidebar
          variant="inset"
          user={sidebarUser}
          clinic={sidebarClinic}
          progresoConfiguracion={(await progresoDeConfiguracion()).porcentaje}
        />
        <OnboardingTour onboarded={Boolean((profile as { onboarded_at?: string | null } | null)?.onboarded_at)} />
        <SidebarInset>
          <SiteHeader />
          <div className="flex flex-1 flex-col">
            <div className="@container/main flex flex-1 flex-col gap-2">
              {children}
            </div>
          </div>
          {/* Va DENTRO del `SidebarInset` y no como hermano: así queda pegada al área de contenido
              y no compite por espacio con el cajón del sidebar cuando está abierto. */}
          <TabBarMovil />
        </SidebarInset>
        <AthosDock />
      </AthosProvider>
    </SidebarProvider>
  )
}
