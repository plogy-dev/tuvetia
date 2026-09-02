// Envío de WhatsApp + registro del saliente — el ÚNICO camino de salida de mensajes.
// Lo usan: /api/whatsapp/send (bandeja), la ejecución de acciones de Athos (aprobadas por el vet)
// y el modo auto. SOLO servidor (usa service_role).

import { createAdminClient } from "@/lib/supabase/admin"
import { DestinoNoRegistrado, athosPuedeEscribirA, type OrigenDelEnvio } from "./destino-permitido"
import { ErrorQueElVetPuedeResolver } from "./error-de-envio"
import { normalizarTelefono } from "./telefono"
import { providerFor, type WhatsAppIntegrationRow, type WhatsAppProvider } from "./provider"

/**
 * ¿El proveedor confirma que esta línea ya no está conectada?
 *
 * `false` ante la duda, y es lo importante: si la consulta de estado también falla —el proveedor
 * caído, la red— NO se baja la bandera. Marcar «desconectado» por un hipo mandaría al vet a
 * escanear un QR que no necesita, y perder una conexión sana es peor que tardar un rato más en
 * enterarse de una rota. La corrección optimista se paga cuando se equivoca.
 */
export async function laLineaSeCayo(
  proveedor: WhatsAppProvider,
  integ: WhatsAppIntegrationRow,
): Promise<boolean> {
  try {
    const fresco = await proveedor.refreshStatus(integ)
    return fresco.status === "disconnected"
  } catch (e) {
    console.warn("whatsapp/send: no se pudo confirmar el estado tras el fallo:", (e as Error).message)
    return false
  }
}

export type SendWhatsAppOptions = {
  ownerId?: string | null
  sentBy?: string | null // null en modo auto (lo envió Athos, no un humano)
  agentMode?: "auto" | "review" | "paused" | "intervene"
  /**
   * Quién eligió el número. Ver `destino-permitido`.
   *
   * POR DEFECTO `"athos"`, y a propósito: quien agregue un camino de salida nuevo y se olvide del
   * parámetro se lo encuentra restringido, no abierto. Un olvido tiene que fallar del lado seguro.
   *
   * NO se deduce de `sentBy`: la ejecución de una acción aprobada manda el id del vet que apretó
   * aprobar aunque el número lo haya puesto Athos.
   */
  origen?: OrigenDelEnvio
}

export type SendWhatsAppResult = {
  waMessageId: string
  message: { id: string; created_at: string } | null // null si el registro en BD falló (el mensaje SÍ salió)
}

const INTEGRATION_COLUMNS =
  "clinic_id, provider, status, phone_number, kapso_customer_id, kapso_phone_number_id, waba_id, meta_phone_number_id, access_token_enc, token_expires_at, evolution_instance"

export async function loadIntegration(clinicId: string): Promise<WhatsAppIntegrationRow | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("whatsapp_integrations")
    .select(INTEGRATION_COLUMNS)
    .eq("clinic_id", clinicId)
    .maybeSingle()
  return (data as WhatsAppIntegrationRow | null) ?? null
}

export async function sendWhatsAppText(
  clinicId: string,
  to: string,
  body: string,
  opts: SendWhatsAppOptions = {},
): Promise<SendWhatsAppResult> {
  const admin = createAdminClient()
  const integ = await loadIntegration(clinicId)
  if (!integ || integ.status !== "connected") {
    throw new Error("WhatsApp no está conectado. Verificá la conexión en Configuración → WhatsApp.")
  }

  // Normalizado ACÁ y no en cada llamador: este es el único camino de salida, así que arreglarlo
  // acá cubre la bandeja, las acciones de Athos, el modo auto y la cobranza de una sola vez.
  const destino = normalizarTelefono(to)

  // Mandarse un mensaje al propio número de la clínica no funciona y NUNCA va a funcionar: el chat
  // "mensajes contigo" de WhatsApp es un caso especial y no se direcciona como un contacto normal
  // por la API. El proveedor devuelve un 400 seco, que traducido a la UI queda como "revisá que el
  // número esté bien" — un consejo inútil, porque el número está perfecto.
  //
  // No es rebuscado: es lo primero que hace cualquiera para probar, y basta con que el vet se cargue
  // a sí mismo como titular para que le pase sin darse cuenta. Medido en vivo el 2026-08-03.
  const propio = (integ.phone_number ?? "").replace(/\D/g, "")
  if (propio && destino === propio) {
    throw new ErrorQueElVetPuedeResolver(
      "No se puede enviar un WhatsApp al número de la propia clínica. Para probar, usá otro teléfono.",
      400,
    )
  }

  // EL CERCO ES PARA ATHOS, NO PARA EL VET. El WhatsApp es de la clínica: el veterinario le escribe
  // a quien quiera, incluido alguien que todavía no está en el CRM. Athos sólo a titulares
  // registrados — ver `destino-permitido`.
  //
  // VA ACÁ Y NO EN LA TOOL DEL AGENTE, por lo mismo que la normalización del teléfono: éste es el
  // único camino de salida. En la tool dejaría fuera el modo auto y la cobranza, que también son
  // Athos escribiendo.
  if ((opts.origen ?? "athos") === "athos" && !(await athosPuedeEscribirA(admin, clinicId, destino))) {
    throw new DestinoNoRegistrado(destino)
  }

  // ── SI FALLA EL ENVÍO, PREGUNTAR SI LA LÍNEA SIGUE VIVA (31-ago) ────────────────────────────
  //
  // `whatsapp_integrations.status` es una FOTO, no una verdad: se escribe cuando alguien conecta,
  // cuando llega un `connection.update` del proveedor, o cuando el vet aprieta «Verificar». Si el
  // vet cierra la sesión desde el teléfono y ese evento no llega —o llega y se pierde—, la columna
  // se queda en `connected` para siempre y la pantalla dice «Conectado» sobre una línea muerta.
  //
  // Reportado el 2-sep: WhatsApp desvinculado desde el teléfono, la app seguía mostrando
  // «Conectado · 573107663149», y al escribir salía «El servicio de WhatsApp está fallando (500)» —
  // un mensaje que manda a esperar cuando lo que había que hacer era volver a escanear el QR.
  //
  // Un fallo de envío es la MEJOR evidencia disponible de que algo pasa con la línea, y hasta ahora
  // se tiraba a la basura. No se marca desconectado por el sólo hecho de fallar —un 500 también
  // puede ser el proveedor teniendo un mal minuto, y bajar la bandera por eso mandaría al vet a
  // reconectar una línea sana—: se le PREGUNTA al proveedor, y sólo se corrige si confirma.
  const proveedor = providerFor(integ)
  let waMessageId: string
  try {
    ;({ waMessageId } = await proveedor.sendText(integ, destino, body))
  } catch (e) {
    if (await laLineaSeCayo(proveedor, integ)) {
      await admin
        .from("whatsapp_integrations")
        .update({ status: "disconnected", updated_at: new Date().toISOString() })
        .eq("clinic_id", clinicId)

      // Se reemplaza el error del proveedor por uno que dice qué hacer. «El servicio está fallando
      // (500)» es verdad y es inútil: describe el síntoma y esconde la causa.
      throw new ErrorQueElVetPuedeResolver(
        "WhatsApp se desconectó: el teléfono ya no está vinculado. Andá a Integraciones y volvé a escanear el QR.",
        409,
        `El proveedor confirmó la desconexión tras fallar el envío: ${(e as Error).message}`,
      )
    }
    throw e
  }

  // Registrar el saliente y devolver la fila real (id + created_at de la BD) — el front la usa
  // para no duplicar el hilo. Un retry único: si falla dos veces, el mensaje salió pero no quedó
  // registrado, y el caller decide cómo avisarlo.
  const row = {
    clinic_id: clinicId,
    owner_id: opts.ownerId ?? null,
    wa_message_id: waMessageId,
    wa_phone_from: integ.phone_number ?? "",
    wa_phone_to: destino,
    direction: "outbound" as const,
    body,
    sent_by: opts.sentBy ?? null,
    ...(opts.agentMode ? { agent_mode: opts.agentMode } : {}),
  }
  // `provider_timestamp` se devuelve porque es la clave con la que la bandeja ORDENA el hilo: sin
  // ella la fila recién enviada entra al estado sin criterio de orden y se va al principio.
  // Para un saliente propio no hace falta escribirla — el default `now()` es la hora de envío, que
  // aquí ES la del proveedor.
  let message: { id: string; created_at: string; provider_timestamp: string } | null = null
  for (let attempt = 1; attempt <= 2 && !message; attempt += 1) {
    const { data, error } = await admin
      .from("whatsapp_messages")
      .insert(row)
      .select("id, created_at, provider_timestamp")
      .single()
    if (!error) message = data as { id: string; created_at: string; provider_timestamp: string }
    else if (attempt === 2) console.error("No se pudo registrar el mensaje saliente:", error)
  }
  return { waMessageId, message }
}
