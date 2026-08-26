import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import { AppSidebar } from "@/components/app-sidebar"
import { CuentaDesactivada } from "@/components/cuenta-desactivada"
import { estadoDeAcceso } from "@/lib/acceso"
import { SiteHeader } from "@/components/site-header"
import { TabBarMovil } from "@/components/tab-bar-movil"
import { OnboardingTour } from "@/components/onboarding-tour"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { sesionDelServidor } from "@/lib/supabase/sesion"
import { crearMarcas } from "@/lib/perf/marcas"
import { progresoDeConfiguracion } from "@/lib/onboarding/consultar"
import { AthosProvider } from "@/components/athos/athos-provider"
import { AthosDock } from "@/components/athos/athos-dock"
import { NotchDeConsulta } from "@/components/athos/notch-de-consulta"
import { ProveedorDeInteligenciaViva } from "@/lib/consulta-viva/proveedor"
import { PlanProvider } from "@/components/planes/plan-provider"
import { comoPlan } from "@/lib/planes"
import { precioProCentavos } from "@/lib/planes/precio"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // ── INSTRUMENTACIÓN, temporal y sin costo para nadie ────────────────────────────────────────
  //
  // Mide en qué se van los ~800 ms de piso que tiene toda navegación del dashboard. Se activa SÓLO
  // con la cabecera `x-perf: 1`, que ningún navegador manda solo: un usuario real nunca entra por
  // este camino y no paga ni una comparación de más. Los números salen en un `data-perf` del nodo
  // raíz, que aparece en el payload RSC y se puede leer con un `fetch` desde el navegador.
  //
  // Existe porque la tanda anterior estimó la mejora en 300-400 ms y midió 100: el modelo mental de
  // dónde estaba el costo era incorrecto, y adivinar dos veces seguidas no es un método.
  const midiendo = (await headers()).get("x-perf") === "1"
  const { marcar, ahora, texto: marcasTexto } = crearMarcas(midiendo)
  const t0 = ahora()

  // UNA sola validación de sesión por request: `sesionDelServidor` está memoizada con `cache()`, así
  // que este `getUser()` y el de la página que se esté cargando son el mismo viaje de red. Antes
  // eran dos (tres con el middleware), encadenados.
  const tSesion = ahora()
  const { supabase, user } = await sesionDelServidor()
  marcar("sesion", tSesion)

  const tPerfil = ahora()
  const profile = user
    ? (
        await supabase
          .from("profiles")
          // `role` es para el pie de la barra lateral e `is_active` para el gate de cuenta
          // desactivada. Van en ESTE select y no en consultas aparte: el perfil ya se estaba
          // trayendo, así que las dos columnas salen gratis.
          //
          // LA CLÍNICA VIENE EMBEBIDA, y ése es el segundo viaje que se elimina. Antes se consultaba
          // aparte y NO podía empezar hasta tener el `clinic_id` de acá: dos round-trips en cadena
          // donde Postgres resuelve el join en uno.
          //
          // ⚠️ `!profiles_clinic_id_fkey` NO ES OPCIONAL. Hay DOS claves foráneas entre `profiles` y
          // `clinics` —`profiles.clinic_id` y `clinics.owner_id`— así que sin nombrar cuál se usa,
          // PostgREST no puede resolver el embed y falla. Con `.single()` eso devuelve `data: null`,
          // el perfil queda vacío, `estadoDeAcceso` lo lee como "sin onboarding" y el layout manda a
          // /bienvenida: la app entera deja de abrir. Pasó en producción el 23-ago por omitir esta
          // pista. `clinica-de-la-sesion.ts` ya la traía; acá se había perdido al copiar el patrón.
          .select(
            "full_name, onboarded_at, clinic_id, setup_completed_at, role, is_active, clinic:clinics!profiles_clinic_id_fkey(name, logo_url, plan)",
          )
          .eq("id", user.id)
          .single()
      ).data
    : null
  marcar("perfil", tPerfil)

  // Vet nuevo (creador de clínica) sin el wizard completado -> a /bienvenida. Los invitados nunca
  // caen aquí (accept_invitation marca setup_completed_at) ni los usuarios preexistentes (backfill 0017).
  const p = profile as {
    full_name: string | null
    onboarded_at: string | null
    clinic_id: string | null
    setup_completed_at: string | null
    role: string | null
    is_active: boolean | null
    clinic: { name: string; logo_url: string | null; plan: string | null } | null
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

  // Ya vino con el perfil, en el mismo viaje. `plan` viaja ahí también: la barra lateral y el widget
  // de Athos lo necesitan en cada carga, y una consulta aparte por algo que ya se está trayendo es
  // un round-trip regalado en la ruta más caliente de la app.
  const c = (p as unknown as { clinic: { name: string; logo_url: string | null; plan: string | null } | null } | null)
    ?.clinic ?? null

  const sidebarUser = {
    name: profile?.full_name || user?.email || "Usuario",
    email: user?.email ?? "",
    avatar: "",
    role: p?.role ?? null,
  }
  const sidebarClinic = { name: c?.name ?? "Tuvetia", logoUrl: c?.logo_url ?? null }

  // `ui/sidebar.tsx` guarda el colapso en la cookie `sidebar_state`, y acá se lee para que la barra
  // respete lo que cada quien dejó. El nombre tiene que seguir a `SIDEBAR_COOKIE_NAME`.
  //
  // POR DEFECTO CERRADA (19-ago). Antes abría desplegada y sólo un `"false"` explícito la colapsaba.
  // Se invierte: quien nunca la tocó entra con la barra en modo icono. La razón es el ruido — son
  // once entradas con sus rótulos ocupando 288px de ancho permanente frente a una pantalla que
  // existe para leer el día de la clínica, y el nombre de cada sección no es algo que haga falta
  // tener a la vista todo el tiempo.
  //
  // NO SE PIERDE NADA NI SE ESCONDE NADA: los iconos siguen ahí con su tooltip, el botón de la
  // cabecera la despliega, y en cuanto alguien la abre la cookie recuerda esa decisión para
  // siempre. El default sólo decide con qué arranca quien todavía no eligió.
  //
  // No cambia el renderizado: este layout ya era dinámico porque `createClient()` lee cookies.
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value === "true"

  // ── EL PROGRESO YA NO SE ESPERA ─────────────────────────────────────────────────────────────
  //
  // Medido el 23-ago: `progresoDeConfiguracion()` costaba 443 ms —el 43 % del layout— y era una
  // barra de onboarding que en una clínica configurada dice 100 % y ni se pinta. Pagar casi medio
  // segundo EN CADA navegación por eso era el hueco más grande del reparto.
  //
  // La promesa baja SIN await: el chip de la barra la resuelve con `use()` dentro de su propio
  // `<Suspense>`, así que el shell pinta ya y el porcentaje aparece cuando llega. El `.catch(0)`
  // no es cosmético — una promesa rechazada sin dueño tumba el render en el servidor, y 0 es la
  // MISMA política de fallo que `progresoDeConfiguracion` ya tiene por dentro: hacia "pendiente",
  // nunca hacia "completo" (ver lib/onboarding/consultar.ts).
  const progreso = progresoDeConfiguracion()
    .then((pr) => pr.porcentaje)
    .catch(() => 0)
  marcar("total", t0)

  return (
    <SidebarProvider
      className="app-theme"
      defaultOpen={sidebarOpen}
      // SIN `--sidebar-width`: lo definía en `calc(var(--spacing) * 72)` = 288 px, pisando los
      // 232 px que `ui/sidebar.tsx` midió del prototipo del cliente — el spread `...style` del
      // provider va último y el inline ganaba. Eran 56 px robados al área de trabajo en TODAS las
      // pantallas, y parte de «el ancho corta letras y encabezados» (David, 25-ago). Al no
      // declararlo, manda el default medido.
      style={
        {
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      {midiendo && <span hidden data-perf={marcasTexto()} />}
      {/* `AthosProvider` envuelve el panel entero porque el widget necesita saber en qué pantalla
          está el vet. Sólo expone lo que se deriva de la RUTA, que cambia cuando el árbol se
          re-renderiza igual — nada mutable vive acá. El estado del widget vive en `AthosDock`, que
          es HERMANO de `{children}` y por eso abrirlo no re-renderiza ninguna pantalla.
          `clinic_id` y el nombre ya están resueltos arriba: el widget arranca sin una sola query. */}
      {/* El plan baja como dato desde acá y no lo consulta nadie más: el compositor de Athos y el
          botón de iniciar consulta están hundidos en el árbol y son de cliente. Sin esto, cada uno
          haría su propia consulta y tendría un instante de "todavía no sé" en el que dejaría pasar.

          `precioCentavos` es sólo para PINTAR. El monto que se le manda a Wompi lo vuelve a
          resolver el servidor cuando cobra; la interfaz nunca elige cuánto se cobra. */}
      <PlanProvider
        plan={comoPlan(c?.plan)}
        precioCentavos={precioProCentavos()}
        esAdmin={p?.role === "admin"}
      >
      <AthosProvider clinicId={p?.clinic_id ?? null} clinicName={sidebarClinic.name}>
        {/* `progresoDeConfiguracion()` está envuelto en `cache()` de React: el dashboard lo vuelve
            a llamar para pintar el riel completo y comparten el mismo round-trip, en vez de correr
            la tanda de conteos dos veces por carga. */}
        <AppSidebar
          variant="inset"
          user={sidebarUser}
          clinic={sidebarClinic}
          progresoConfiguracion={progreso}
        />
        <OnboardingTour onboarded={Boolean((profile as { onboarded_at?: string | null } | null)?.onboarded_at)} />
        {/* UN SOLO ESTADO DE LA CONSULTA VIVA para las dos superficies que la muestran: el notch,
            que flota sobre cualquier pantalla, y el cockpit, que ocupa la pantalla de la consulta.
            Con un gancho en cada una habría dos relojes disparando contra el mismo presupuesto.
            Ver `lib/consulta-viva/proveedor.tsx`. */}
        <ProveedorDeInteligenciaViva>
        <SidebarInset>
          <SiteHeader />
          {/* EL NOTCH DE LA CONSULTA VA ACÁ DENTRO, y no suelto como el dock. `SidebarInset` es
              `relative`, así que el notch se posiciona contra el ÁREA DE CONTENIDO: se centra sobre
              ella —no sobre el viewport, que con el sidebar abierto está 144px corrido— y queda
              debajo de la cabecera en vez de taparle el título y el buscador. */}
          <NotchDeConsulta />
          {/* `min-h-0` EN LOS DOS. En una columna flex, un hijo con `flex-1` no se encoge por
              debajo de su contenido salvo que se le diga — y sin eso, una pantalla que quiera
              ocupar exactamente el alto disponible no tiene forma de saber cuál es.

              No cambia nada para las pantallas que scrollean: `min-h-0` PERMITE encogerse, no
              obliga. Una tabla larga sigue creciendo y sigue empujando el scroll de la página,
              porque nada dentro de ella acota el alto. Lo que habilita es que una pantalla que SÍ
              se acota —el chat— pueda decir `flex-1` en vez de calcular píxeles de viewport. */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
              {children}
            </div>
          </div>
          {/* Va DENTRO del `SidebarInset` y no como hermano: así queda pegada al área de contenido
              y no compite por espacio con el cajón del sidebar cuando está abierto. */}
          <TabBarMovil />
        </SidebarInset>
        </ProveedorDeInteligenciaViva>
        <AthosDock />
      </AthosProvider>
      </PlanProvider>
    </SidebarProvider>
  )
}
