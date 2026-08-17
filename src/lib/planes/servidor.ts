import "server-only"

// El plan de una clínica, para los caminos que NO tienen sesión.
//
// POR QUÉ HACE FALTA ADEMÁS DE `clinicaDeLaSesion`. Ese resuelve el plan de quien está llamando, y
// sirve para las rutas que un veterinario dispara. Pero las superficies de IA más caras corren
// SIN NADIE MIRANDO y sin sesión:
//
//   · el modo automático de WhatsApp, que arranca desde el webhook del proveedor;
//   · el barrido de cartera, que lee y clasifica respuestas de clientes;
//   · el briefing diario.
//
// Ésas son justamente las que gastan sin que el vet lo note, así que son las que más necesitan el
// gate. Acá el `clinic_id` viene del mensaje o del barrido, no de un JWT, y la lectura va con la
// llave de servicio.
//
// FALLA CERRADA. Ante un error de lectura devuelve `free`. Es lo contrario del presupuesto de IA
// —que falla abierto para no dejar a un veterinario sin Athos en medio de una consulta— y la
// diferencia es a qué apunta cada uno: el tope protege un costo, esto protege el cobro. Un fallo
// que regalara Pro sería explotable a voluntad. Y en estos tres caminos no hay nadie esperando
// delante de una pantalla: que un briefing no se redacte no interrumpe a nadie.

import { createAdminClient } from "@/lib/supabase/admin"
import { comoPlan, tieneAcceso, type Capacidad, type Plan } from "@/lib/planes"

/** El plan de una clínica, leído con la llave de servicio. */
export async function planDeClinica(clinicId: string): Promise<Plan> {
  try {
    const db = createAdminClient()
    const { data, error } = await db.from("clinics").select("plan").eq("id", clinicId).maybeSingle()
    if (error || !data) {
      console.error(`planes/servidor: no se pudo leer el plan de ${clinicId}`, error)
      return "free"
    }
    return comoPlan((data as { plan: string | null }).plan)
  } catch (e) {
    console.error(`planes/servidor: excepción leyendo el plan de ${clinicId}`, e)
    return "free"
  }
}

/**
 * ¿Esta clínica puede gastar en esta capacidad?
 *
 * Se llama ANTES de armar el pedido al modelo, no después de recibirlo. La diferencia es una
 * llamada pagada por clínica y por disparo — que en el modo automático de WhatsApp es por mensaje
 * entrante.
 */
export async function clinicaPuede(clinicId: string, capacidad: Capacidad): Promise<boolean> {
  return tieneAcceso(await planDeClinica(clinicId), capacidad)
}
