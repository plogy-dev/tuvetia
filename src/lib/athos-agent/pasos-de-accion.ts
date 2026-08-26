// Qué VA A HACER una propuesta de Athos, y qué HIZO — desglosado en pasos.
//
// POR QUÉ. Una acción de Athos casi nunca es una sola cosa. "Agendar la cita" son dos: crear la
// cita en la agenda y copiarla al Google Calendar del administrador. "Crear titular + paciente" son
// dos RPC distintas, y la segunda puede fallar con la primera ya hecha. "Actualizar la ficha"
// pueden ser tres (peso, nota, alergia). La tarjeta mostraba un spinner y después "✓ Ejecutada",
// así que todo eso era una caja negra: el vet no sabía qué iba a pasar antes de aprobar, ni qué
// pasó realmente después.
//
// El mockup del cliente dibuja las dos mitades — la lista de pasos y el estado "hecha" con
// "[Ver en la agenda]". Esto es lo que las alimenta.
//
// DOS FUENTES DISTINTAS, Y ES LA CLAVE DE QUE NO MIENTA:
//
//   · `pasosPrevistos` sale del PAYLOAD. Es una promesa: "al aprobar va a pasar esto". Se muestra
//     antes de aprobar, que es cuando sirve.
//   · `pasosEjecutados` sale del RESULTADO REAL que devolvió la ruta de ejecución. No es la misma
//     lista dada por buena: si Google Calendar no estaba conectado, `google_event_id` viene en null
//     y ese paso se muestra como NO hecho. Nada acá adivina.
//
// LO QUE NO SE HACE, A PROPÓSITO:
//
//   · **No hay "Detener".** El mockup lo dibuja. La ejecución es un solo POST que corre entero en
//     el servidor; no hay nada que cortar desde el navegador. Un botón que no detiene nada es peor
//     que ninguno, sobre todo en la pantalla donde se mandan WhatsApps de verdad.
//   · **No hay "Deshacer"** por lo mismo: la operación inversa no existe en la app.
//   · **Los pasos no se van marcando en vivo.** Eso pediría convertir la ruta de ejecución en un
//     stream, y esa ruta es la que hace la reserva atómica, la auditoría y los envíos reales — hoy
//     sin un solo test que la cubra. El paso a paso en vivo no vale ese riesgo; el desglose de acá
//     da la misma legibilidad sin tocarla.

export type EstadoPaso = "ok" | "no"

export type PasoEjecutado = { texto: string; estado: EstadoPaso }

export type DestinoDeAccion = { texto: string; href: string }

function objeto(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function textoNoVacio(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null
}

/**
 * Lo que la acción va a hacer si se aprueba. Se lee del payload, así que para `update_patient_record`
 * la lista es exactamente lo que esa propuesta toca — ni un paso de más.
 *
 * Lista vacía = la tarjeta no pinta nada. Un tool nuevo sin entrada acá no rompe: se comporta como
 * antes.
 */
export function pasosPrevistos(toolName: string, payload: unknown): string[] {
  const p = objeto(payload)
  switch (toolName) {
    case "send_whatsapp_message":
      return ["Enviarle el WhatsApp al titular"]

    case "send_email":
      return ["Enviar el correo desde tu cuenta"]

    case "reply_email":
      return [
        // No es relleno: es una verificación real contra el hilo, y la razón por la que una
        // respuesta puede rechazarse después de aprobada.
        "Verificar que el destinatario esté en el hilo",
        "Enviar la respuesta dentro de la conversación",
      ]

    case "create_appointment":
      return ["Crear la cita en la agenda", "Copiarla al Google Calendar de la clínica"]

    // TRES PASOS, y decirlos importa: quien aprueba esto no está confirmando una cita, está
    // creando un titular y un paciente nuevos en la base de la clínica.
    case "solicitar_cita":
      return [
        "Crear el titular con su teléfono",
        "Crear la mascota y asociarla",
        "Crear la cita en la agenda",
      ]

    case "update_appointment":
      return ["Actualizar la cita en la agenda"]

    case "create_owner":
      return ["Crear el titular"]

    case "create_patient":
      return ["Crear el paciente y asociarlo a su titular"]

    case "create_owner_and_patient":
      return ["Crear el titular", "Crear el paciente y asociarlo"]

    case "update_patient_record": {
      const pasos: string[] = []
      if (p.weight_kg !== undefined && p.weight_kg !== null) pasos.push("Actualizar el peso en la ficha")
      if (textoNoVacio(p.notes_append)) pasos.push("Agregar el texto a las notas de la ficha")
      if (textoNoVacio(objeto(p.add_allergy).allergen)) pasos.push("Registrar la alergia en la historia")
      return pasos
    }

    default:
      return []
  }
}

/**
 * Lo que la acción hizo de verdad, leído del `result` que guardó la ruta de ejecución.
 *
 * Un paso en `"no"` no es un error: la acción se ejecutó. Es una parte que no ocurrió y que el vet
 * necesita saber igual — el caso real es la cita que quedó en la plataforma pero no llegó al
 * teléfono porque nadie conectó el calendario.
 */
export function pasosEjecutados(toolName: string, result: unknown): PasoEjecutado[] {
  const r = objeto(result)
  const ok = (texto: string): PasoEjecutado => ({ texto, estado: "ok" })
  const no = (texto: string): PasoEjecutado => ({ texto, estado: "no" })

  switch (toolName) {
    case "send_whatsapp_message":
      return [ok("WhatsApp enviado al titular")]

    case "send_email":
    case "reply_email": {
      const remitente = textoNoVacio(r.remitente)
      return [ok(remitente ? `Correo enviado desde ${remitente}` : "Correo enviado")]
    }

    case "create_appointment":
      return [
        ok("Cita creada en la agenda"),
        textoNoVacio(r.google_event_id)
          ? ok("Copiada al Google Calendar de la clínica")
          : no("No se copió a Google Calendar"),
      ]

    case "update_appointment":
      return [ok("Cita actualizada en la agenda")]

    case "solicitar_cita":
      return [
        ok("Titular creado"),
        ok("Mascota creada y asociada"),
        ok("Cita creada en la agenda"),
        textoNoVacio(r.google_event_id)
          ? ok("Copiada al calendario")
          : no("No se copió a ningún calendario"),
      ]

    case "create_owner":
      return [ok("Titular creado")]

    case "create_patient":
      return [ok("Paciente creado")]

    case "create_owner_and_patient":
      return [ok("Titular creado"), ok("Paciente creado y asociado")]

    case "update_patient_record": {
      // `updated` son las COLUMNAS que se tocaron: si el peso venía igual al que ya estaba, la ruta
      // no lo incluye y acá tampoco aparece.
      const columnas = Array.isArray(r.updated) ? r.updated.map(String) : []
      const pasos: PasoEjecutado[] = []
      if (columnas.includes("weight_kg")) pasos.push(ok("Peso actualizado en la ficha"))
      if (columnas.includes("notes")) pasos.push(ok("Nota agregada a la ficha"))
      if (r.allergy_added === true) pasos.push(ok("Alergia registrada en la historia"))
      return pasos
    }

    default:
      return []
  }
}

/**
 * A dónde ir a ver lo que se hizo. Es el "[Ver en la agenda]" del mockup, que hoy no existe: la
 * tarjeta decía "✓ Ejecutada" y dejaba al vet sin forma de llegar a lo que acababa de aprobar.
 *
 * Sólo rutas que EXISTEN. `/dashboard/owners/[id]` no está construida, así que un titular nuevo
 * lleva al listado y no a un 404.
 */
export function destinosDeAccion(toolName: string, result: unknown): DestinoDeAccion[] {
  const r = objeto(result)
  const patientId = textoNoVacio(r.patient_id)

  switch (toolName) {
    case "create_appointment":
    case "update_appointment":
    case "solicitar_cita":
      return [{ texto: "Ver en la agenda", href: "/dashboard/calendario" }]

    case "create_patient":
    case "create_owner_and_patient":
    case "update_patient_record":
      return patientId ? [{ texto: "Ver la ficha", href: `/dashboard/patients/${patientId}` }] : []

    case "create_owner":
      return [{ texto: "Ver los titulares", href: "/dashboard/owners" }]

    case "send_whatsapp_message":
      return [{ texto: "Ver la conversación", href: "/dashboard/comunicaciones" }]

    case "send_email":
    case "reply_email":
      return [{ texto: "Ver el correo", href: "/dashboard/comunicaciones/correo" }]

    default:
      return []
  }
}
