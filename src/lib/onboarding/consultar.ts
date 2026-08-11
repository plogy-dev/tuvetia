import "server-only"

// Los hechos de la clínica para el riel de configuración, en una sola tanda.
//
// `cache()` de React NO es caché entre peticiones: deduplica dentro de UNA. Hace falta porque el
// riel tiene DOS consumidores en el mismo render —el chip de porcentaje en la barra lateral
// (`dashboard/layout.tsx`) y el panel completo (`dashboard/page.tsx`)— y sin esto la misma tanda de
// consultas saldría dos veces por cada carga del dashboard.
//
// Todas son `count: exact, head: true` sobre tablas con RLS por clínica: la base cuenta y no
// devuelve filas. Van en `Promise.all`, así que cuestan un round-trip, no seis.

import { cache } from "react"

import { requireClinicPage } from "@/lib/facturacion/page-auth"
import { calcularProgreso, type HechosDeLaClinica, type Progreso } from "@/lib/onboarding/progreso"

/**
 * Todo pendiente. Es lo que se devuelve cuando no hay sesión o la consulta falla.
 *
 * FALLA HACIA "PENDIENTE" Y NO HACIA "COMPLETO" a propósito: mostrar de más un riel que ya no hacía
 * falta es un panel de sobra que se colapsa de un clic; ocultarlo por un error de red le esconde al
 * vet que le falta configurar la mitad de la clínica, y eso no se descubre hasta que algo no
 * funciona.
 */
const NADA_HECHO: HechosDeLaClinica = {
  tieneLogo: false,
  tieneHorarios: false,
  tienePaciente: false,
  tieneServicios: false,
  whatsappConectado: false,
  tieneEquipo: false,
}

export const progresoDeConfiguracion = cache(async (): Promise<Progreso> => {
  // Se reusa el helper de facturación aunque viva ahí: su propia documentación lo describe como el
  // equivalente server-component de `requireClinic()`, o sea autenticación de página genérica, no
  // lógica fiscal. Hace exactamente esto —`createClient` → `getUser` → `profiles.clinic_id`— y una
  // tercera copia de doce líneas de auth es peor que una ruta de import poco elegante.
  const ctx = await requireClinicPage()
  if (!ctx) return calcularProgreso(NADA_HECHO)
  const { supabase, clinicId } = ctx

  const [clinica, horarios, pacientes, servicios, whatsapp, equipo] = await Promise.all([
    supabase.from("clinics").select("logo_url").eq("id", clinicId).maybeSingle(),
    supabase.from("clinic_hours").select("id", { count: "exact", head: true }),
    supabase.from("patients").select("id", { count: "exact", head: true }),
    // `item_type` y no `kind`: la columna se llama así en `catalog_items`. `active` porque un
    // servicio dado de baja no habilita facturar nada.
    supabase
      .from("catalog_items")
      .select("id", { count: "exact", head: true })
      .eq("item_type", "SERVICIO")
      .eq("active", true),
    supabase.from("whatsapp_integrations").select("status").maybeSingle(),
    // > 1 porque el creador de la clínica ya cuenta como un perfil: con uno solo no hay equipo.
    supabase.from("profiles").select("id", { count: "exact", head: true }),
  ])

  return calcularProgreso({
    tieneLogo: Boolean((clinica.data as { logo_url: string | null } | null)?.logo_url),
    tieneHorarios: (horarios.count ?? 0) > 0,
    tienePaciente: (pacientes.count ?? 0) > 0,
    tieneServicios: (servicios.count ?? 0) > 0,
    whatsappConectado: (whatsapp.data as { status: string } | null)?.status === "connected",
    tieneEquipo: (equipo.count ?? 0) > 1,
  })
})
