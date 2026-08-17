import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { WelcomeWizard } from "@/components/onboarding/welcome-wizard"
import { OnboardingAthos } from "@/components/onboarding/onboarding-athos"
import { SinClinica } from "@/components/onboarding/sin-clinica"
import { CuentaDesactivada } from "@/components/cuenta-desactivada"
import { estadoDeAcceso } from "@/lib/acceso"
import { progresoDeConfiguracion } from "@/lib/onboarding/consultar"

export const metadata = { title: "Configura tu clínica · Tuvetia" }

// Onboarding: wizard de 4 pasos (clínica → primer paciente → ejemplo → equipo) con Athos al lado.
// Sólo el primero es obligatorio; el resto se salta con un clic.
//
// La clínica ya existe cuando se llega acá: la crea el trigger `on_auth_user_confirmed` con un
// nombre placeholder. Por eso Athos puede operar desde la primera pantalla — necesita `clinic_id`
// y ya lo hay.
export default async function BienvenidaPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: prof } = await supabase
    .from("profiles")
    .select("clinic_id, setup_completed_at, is_active")
    .eq("id", user.id)
    .maybeSingle()
  const p = prof as {
    clinic_id: string | null
    setup_completed_at: string | null
    is_active: boolean | null
  } | null

  // CUENTA DESACTIVADA, antes que nada. Sin esto, el gate de la 0059 hace que un perfil inactivo
  // llegue sin clínica y esta pantalla le ofrezca CREAR UNA NUEVA — exactamente lo que desactivar
  // una cuenta existe para impedir.
  if (estadoDeAcceso(p) === "desactivada") return <CuentaDesactivada correo={user.email} />

  // SIN CLÍNICA se evalúa PRIMERO, antes que `setup_completed_at`. El orden importa y no es
  // cosmético: el layout manda acá cuando falta la clínica, así que si este archivo rebotara al
  // dashboard por tener el flag de setup puesto, los dos se redirigirían mutuamente para siempre.
  // El caso existe de verdad — el backfill de la migración 0017 puso `setup_completed_at` a TODOS
  // los perfiles, incluido cualquiera que no tuviera clínica.
  //
  // Antes esto rebotaba a /dashboard y allá tampoco lo atendía nadie: el usuario aterrizaba en un
  // dashboard vacío, sin onboarding y sin explicación.
  if (!p?.clinic_id) {
    const { data: pendiente } = await supabase.rpc("has_pending_invitation")
    return <SinClinica tieneInvitacionPendiente={Boolean(pendiente)} />
  }

  // Ya lo completó -> al dashboard.
  if (p.setup_completed_at) redirect("/dashboard")

  const { data: clinic } = await supabase
    .from("clinics")
    .select("name, logo_url")
    .eq("id", p.clinic_id)
    .maybeSingle()
  const c = clinic as { name: string; logo_url: string | null } | null

  // QUÉ TIENE YA LA CLÍNICA, para que el wizard no vuelva a pedir lo que ya está.
  //
  // El onboarding SE PUEDE REPETIR (`RepetirOnboarding`, en Ayuda) y ese botón promete "no borra
  // nada de lo que ya cargaste". Es verdad — pero sin esto, volver a pasar por los pasos crearía un
  // SEGUNDO titular con su paciente y un catálogo de servicios duplicado, porque ni `create_owner`
  // ni `catalog_items` tienen guarda de unicidad. Prometer que no se borra nada y a cambio duplicar
  // todo es la misma clase de sorpresa.
  //
  // Se reusa `progresoDeConfiguracion` en vez de contar acá: define "tiene servicios" con su
  // sutileza (`item_type='SERVICIO'` y `active`), y dos sitios que interpreten eso distinto
  // terminarían discrepando — que es el defecto que esta auditoría ya encontró dos veces.
  const progreso = await progresoDeConfiguracion()
  const hecho = (id: string) => progreso.pasos.some((paso) => paso.id === id && paso.hecho)

  return (
    <main className="mx-auto grid min-h-svh w-full max-w-6xl gap-6 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex w-full max-w-md flex-col justify-center justify-self-center">
        <WelcomeWizard
          clinicId={p.clinic_id}
          initialClinicName={c?.name ?? ""}
          initialLogoUrl={c?.logo_url ?? null}
          yaHecho={{
            horarios: hecho("horarios"),
            servicios: hecho("servicios"),
            paciente: hecho("paciente"),
          }}
        />
      </div>
      {/* El panel de Athos es acompañamiento, no camino crítico: en pantallas chicas se oculta y el
          wizard funciona igual. Si Athos falla o tarda, el onboarding no se bloquea. */}
      <div className="hidden min-h-0 lg:block">
        <OnboardingAthos clinicName={c?.name ?? ""} />
      </div>
    </main>
  )
}
