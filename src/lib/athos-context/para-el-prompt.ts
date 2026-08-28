// Traduce "qué está mirando el vet" a una línea del prompt del agente.
//
// EL HUECO QUE CIERRA. `derivarContexto` distingue OCHO contextos —paciente, consulta, agenda,
// facturación con su `facturaId`, comunicaciones, titulares…— y el widget hasta pinta la frase en
// pantalla ("Estás en la ficha de un paciente"). Pero al modelo sólo le llegaba el `patientId`, y
// sólo para dos de los ocho: para consulta, agenda, factura y comunicaciones llegaba `null`.
//
// El comentario de `describirContexto` decía que la frase va "en la etiqueta del widget y en el
// prompt del agente". Al prompt nunca llegó. Esto lo cumple.
//
// LA REGLA QUE ORDENA ESTE ARCHIVO: sólo se nombra una herramienta cuando EXISTE y cuando el
// contexto trae lo que esa herramienta necesita. Decirle al modelo "usá get_invoice" cuando no hay
// ninguna herramienta de facturas no lo vuelve más capaz: lo vuelve más propenso a inventar la
// respuesta. Por eso el caso `facturacion` dice dónde está el vet y admite que no puede leerla.
//
// Función pura, sin React ni Next, para probarla con una tabla de casos.

import type { AthosContexto } from "@/lib/athos-context/derivar"

/**
 * Los seis pasos del alta, con el mismo texto que ve el vet en la barra de progreso.
 *
 * Copiado a mano de `PASOS` en `welcome-wizard.tsx` y no importado: ese archivo es un componente de
 * cliente con `useState`, `toast` y Supabase, y este módulo es puro a propósito —se prueba con una
 * tabla de casos, sin montar nada—. Un cerrojo comprueba que las dos listas no se separen.
 */
const PASOS_DEL_ALTA = [
  "Clínica",
  "Horarios",
  "Servicios",
  "Primer paciente",
  "Ejemplo",
  "Equipo",
] as const

/**
 * La línea que se agrega al bloque «Contexto runtime» del system prompt.
 *
 * Devuelve `null` cuando no hay nada útil que decir — el chat de Athos a pantalla completa y la
 * navegación general no aportan contexto, y una línea que dice "estás en la plataforma" sólo gasta
 * tokens.
 */
export function contextoParaElPrompt(c: AthosContexto): string | null {
  switch (c.tipo) {
    case "paciente":
      return (
        `El vet está viendo la FICHA de un paciente (id interno: ${c.patientId}). ` +
        `Si la pregunta es sobre "este paciente" o no nombra a nadie, es éste: usá get_patient_summary.`
      )

    case "consulta":
      return (
        `El vet está en una CONSULTA abierta (id interno: ${c.consultaId}). ` +
        `Usá get_consultation_details para saber de qué paciente es, qué se transcribió y qué dice la nota.`
      )

    // El chat a pantalla completa: el paciente del selector ya viaja aparte, en `patientId`, y
    // repetir "estás en el chat" no le dice nada al modelo que no sepa.
    case "asistente":
      return null

    case "agenda":
      return (
        "El vet está en la AGENDA. Si pregunta por citas sin decir de qué día, se refiere a hoy: " +
        "usá list_appointments_on_day, y list_available_slots si busca un espacio libre."
      )

    case "comunicaciones":
      return (
        "El vet está en la BANDEJA de conversaciones con titulares. Si pide responderle a alguien " +
        "sin decir a quién, preguntale de qué conversación habla antes de proponer un mensaje."
      )

    case "titulares":
      return (
        "El vet está en el listado de TITULARES. Ojo: la única herramienta de titulares busca por " +
        "TELÉFONO (get_owner_by_phone), así que si te nombra a alguien sin dar el número, pediselo."
      )

    // NO SE NOMBRA NINGUNA HERRAMIENTA acá, y es a propósito: no existe ninguna que lea facturas.
    // Decir que el vet está viendo la factura X e insinuar que se puede consultar terminaría en un
    // saldo inventado, que en una pantalla de cobranza es peor que no responder.
    case "facturacion":
      return c.facturaId
        ? `El vet está viendo una FACTURA (id interno: ${c.facturaId}). No tenés ninguna herramienta ` +
            "para leer facturas: si necesitás su contenido —saldo, vencimiento, ítems— pedíselo al vet " +
            "en vez de suponerlo."
        : "El vet está en VENTAS (facturación). No tenés herramientas de facturación: si la pregunta " +
            "es sobre una factura concreta, pedile los datos."

    // ── EL ALTA, PEDIDO DE LUCIANO: «que sepa también dónde estás parado» ──────────────────────
    //
    // Es el contexto donde saberlo cambia MÁS la respuesta, y es justo donde no llegaba: el chat del
    // alta ya recibía el paso, pero sólo para mover una tarjeta de texto fijo — «el chat no lo usa»,
    // decía su propio comentario.
    //
    // Y lo que más importa no es el nombre del paso: es que DURANTE EL ALTA LA CLÍNICA ESTÁ VACÍA.
    // Sin eso, el modelo llama a `list_appointments_on_day` o a `get_patient_summary`, le vuelve
    // nada, y contesta que no encontró información — la primera impresión del producto es un
    // asistente que no sabe nada de una clínica que todavía no existe. Con la advertencia puede
    // decir «todavía no hay, se cargan en este paso», que es la respuesta correcta.
    case "onboarding": {
      const paso = PASOS_DEL_ALTA[c.paso] ?? "la configuración"
      return (
        `El vet está CONFIGURANDO su clínica por primera vez, en el paso «${paso}» ` +
        `(${c.paso + 1} de ${PASOS_DEL_ALTA.length}). ` +
        "Si pregunta «esto para qué sirve» o «qué pongo acá» sin decir dónde, habla de ESE paso. " +
        "OJO: la clínica está recién creada, así que casi todo está vacío — si una herramienta te " +
        "devuelve cero pacientes, cero citas o cero servicios, eso NO es un error ni un dato que " +
        "reportar: es que todavía no se cargaron. Decilo así y explicá en qué paso se cargan. " +
        "No lo mandes a pantallas del panel que todavía no puede abrir: se sale del alta al terminar."
      )
    }

    case "general":
      return null
  }
}
