import "server-only"

import { direccionDeLaClinica } from "@/lib/agenda/destinatarios"
import { bloqueDeLinks } from "@/lib/citas/links"

// La confirmación que sale EN EL MOMENTO de agendar la cita.
//
// ── QUÉ ES Y QUÉ NO ES ─────────────────────────────────────────────────────────────────────────
//
// No es el recordatorio. El recordatorio (`barrido.ts`, migración 0085) lo dispara un cron la
// mañana anterior. Esto lo dispara UNA PERSONA al guardar la cita, y por eso todo lo demás cambia:
//
//   · No hay sello en `appointments` ni idempotencia que cuidar — un cron puede correr dos veces,
//     un clic en «Guardar» no.
//   · No se calla cuando falla: el resultado se le muestra al vet en la ventana de confirmación,
//     porque él está ahí mirando y puede hacer algo al respecto.
//   · No barre nada: es una cita, la que se acaba de guardar.
//
// ── LO QUE SÍ COMPARTE CON EL RECORDATORIO ─────────────────────────────────────────────────────
//
// La PLANTILLA y el PUERTO DE SALIDA. Los mismos huecos (`{paciente}`, `{fecha}`, `{hora}`,
// `{clinica}`), el mismo `llenarTexto`, el mismo `fechaYHora` y el mismo `sendWhatsAppText`.
//
// Es a propósito: son dos mensajes de la misma clínica al mismo titular sobre la misma cita, y si
// cada uno formateara la fecha por su cuenta, el titular recibiría «26 de agosto» en uno y
// «26/08/2026» en el otro. Un sistema de plantillas por mensaje es como se termina con cinco.

import { createAdminClient } from "@/lib/supabase/admin"
import { sendWhatsAppText } from "@/lib/whatsapp/send-message"

import { fechaYHora, llenarTexto, revisarTexto } from "./recordatorio"
import { TEXTO_POR_DEFECTO_CONFIRMACION } from "./textos"

export type ResultadoDeConfirmacion = {
  ok: boolean
  /** El teléfono al que salió, para que el vet pueda verificar que era el correcto. */
  destino: string | null
  /**
   * Por qué no salió, dicho para el vet y no para el log.
   *
   * Cada motivo se arregla en un lugar distinto —la ficha del titular, Ajustes, Integraciones— así
   * que un genérico obliga a adivinar cuál de los cuatro fue.
   */
  motivo: string | null
}

type CitaParaConfirmar = {
  clinic_id: string
  starts_at: string
  ends_at: string | null
  patient: { name: string } | null
  owner: { full_name: string; phone: string | null } | null
}

/**
 * Manda la confirmación de una cita ya guardada.
 *
 * NUNCA LANZA. La cita existe cuando esto corre: que el aviso no salga es información para el vet,
 * no un error que deba deshacer nada.
 *
 * El `appointmentId` se valida CONTRA LA CLÍNICA de quien pide. Esto corre con `service_role` para
 * poder leer el teléfono del titular, así que sin ese chequeo cualquiera con sesión podría pedir la
 * confirmación de una cita ajena y, con ella, ver a qué número salió.
 */
export async function confirmarCita(
  appointmentId: string,
  clinicId: string,
): Promise<ResultadoDeConfirmacion> {
  const admin = createAdminClient()

  const [{ data: citaCruda }, { data: clinicaCruda }] = await Promise.all([
    admin
      .from("appointments")
      .select(
        // `ends_at` para el link de Calendar (el template de Google exige inicio Y fin).
        "clinic_id, starts_at, ends_at, patient:patients!appointments_patient_id_fkey(name), owner:owners!appointments_owner_id_fkey(full_name, phone)",
      )
      .eq("id", appointmentId)
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    admin
      .from("clinics")
      // `address, city` para los links de Maps y Calendar del aviso (28-ago).
      .select("name, address, city, confirmacion_citas_activo, confirmacion_citas_texto")
      .eq("id", clinicId)
      .maybeSingle(),
  ])

  const cita = citaCruda as unknown as CitaParaConfirmar | null
  const clinica = clinicaCruda as {
    name: string
    address: string | null
    city: string | null
    confirmacion_citas_activo: boolean | null
    confirmacion_citas_texto: string | null
  } | null

  if (!cita) return { ok: false, destino: null, motivo: "No se encontró la cita." }

  if (!clinica?.confirmacion_citas_activo) {
    return {
      ok: false,
      destino: null,
      motivo: "El aviso al agendar está apagado. Se enciende en Ajustes → Avisos de citas.",
    }
  }

  const telefono = cita.owner?.phone?.trim()
  if (!cita.owner) {
    return { ok: false, destino: null, motivo: "La cita no tiene titular asignado." }
  }
  if (!telefono) {
    return {
      ok: false,
      destino: null,
      motivo: "El titular no tiene teléfono cargado en su ficha.",
    }
  }

  // Una plantilla rota se cae al texto por defecto en vez de mandar `{paciente}` literal al cliente.
  // El error ya se le mostró a quien la editó, en Ajustes; acá lo que importa es que el mensaje
  // salga entendible.
  const plantilla = clinica.confirmacion_citas_texto?.trim()
  const texto =
    plantilla && !revisarTexto(plantilla) ? plantilla : TEXTO_POR_DEFECTO_CONFIRMACION

  const { fecha, hora } = fechaYHora(cita.starts_at)
  // EL BLOQUE DE LINKS VA DESPUÉS DE LA PLANTILLA, anexado por la app (28-ago: «con este link de
  // Google Maps, Google Calendar»). La confirmación es EL momento «agendar», así que lleva los
  // dos; el largo de la plantilla del vet (LARGO_MAXIMO) no lo cuenta — no es texto suyo.
  const mensaje =
    llenarTexto(texto, {
      paciente: cita.patient?.name ?? "su mascota",
      fecha,
      hora,
      clinica: clinica.name,
    }) +
    bloqueDeLinks({
      conCalendario: true,
      titulo: `Cita de ${cita.patient?.name ?? "su mascota"} en ${clinica.name}`,
      inicio: cita.starts_at,
      fin: cita.ends_at,
      direccion: direccionDeLaClinica(clinica),
    })

  try {
    await sendWhatsAppText(clinicId, telefono, mensaje)
    return { ok: true, destino: telefono, motivo: null }
  } catch (e) {
    // El mensaje del proveedor viaja tal cual: es accionable —«el número no tiene WhatsApp», «la
    // sesión se cerró»— y esconderlo detrás de un genérico deja al vet sin nada que hacer.
    return { ok: false, destino: null, motivo: (e as Error).message }
  }
}
