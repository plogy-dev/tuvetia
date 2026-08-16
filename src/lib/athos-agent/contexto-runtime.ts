// El bloque «Contexto runtime» del system prompt: lo que Athos sabe de la situación, no de
// veterinaria.
//
// POR QUÉ ESTÁ ACÁ Y NO EN LA RUTA. Estaba armado con un template literal de once líneas dentro de
// `api/athos/agent/route.ts`, y eso lo volvía imposible de probar sin levantar la ruta entera. Es
// justo lo que hay que poder probar: si una línea deja de llegar al prompt, el modelo pierde una
// capacidad y NADA falla — ni un tipo, ni un lint, ni un test. La respuesta simplemente sale peor,
// y eso no se nota hasta que alguien lo usa.
//
// Mismo criterio que el resto de `lib/`: la lógica en un `.ts` sin React ni Next, testeable con
// vitest en `environment: "node"`.

import { contextoParaElPrompt } from "@/lib/athos-context/para-el-prompt"
import type { AthosContexto } from "@/lib/athos-context/derivar"
import { pendientesParaElPrompt, type Pendiente } from "@/lib/senales/pendientes"

export type InsumosDelContexto = {
  /** Fecha de hoy en Bogotá, YYYY-MM-DD. */
  hoyISO: string
  /** Nombre de la clínica, para que firme los correos con él. */
  clinica?: string | null
  /** Nombre del vet con el que habla. */
  vet?: string | null
  /** Paciente del selector del chat, si hay uno. */
  patientId?: string | null
  /** Qué pantalla tiene delante. `null` fuera del dashboard o si el cliente no lo mandó. */
  contexto?: AthosContexto | null
  /** De dónde vino la petición: la bandeja tiene un objetivo distinto al del chat. */
  source?: string
  /** Aviso de densidad clínica, ya redactado por `densidadClinica`. Vacío si no aplica. */
  avisoDensidad?: string
  /**
   * Qué está esperando en la clínica: notas sin aprobar, titulares sin respuesta, cobros vencidos.
   *
   * Sale de `lib/senales/pendientes.ts` y NO cuesta un token: son consultas a la base. Entra al
   * prompt para que el modelo llegue sabiendo, en vez de tener que salir a buscarlo con
   * herramientas cuando el vet pregunta "¿qué tengo pendiente?".
   */
  pendientes?: Pendiente[]
}

/**
 * Arma el bloque, una línea por hecho.
 *
 * LO QUE NO SE SABE NO SE INVENTA: cada dato ausente simplemente no aporta su línea, en vez de
 * aportar una que diga "sin clínica" o "paciente: ninguno". Un prompt lleno de negaciones le enseña
 * al modelo a hablar de lo que no tiene.
 */
export function bloqueDeContextoRuntime(i: InsumosDelContexto): string {
  const lineas: string[] = [`Fecha de hoy: ${i.hoyISO} (hora de Colombia, UTC-5).`]

  if (i.clinica) {
    lineas.push(
      `Clínica: **${i.clinica}**. Es el nombre con el que firmás los correos y el que va en el ` +
        `asunto cuando ayuda — nunca "Veterinaria" a secas.`,
    )
  }

  if (i.vet) {
    lineas.push(
      `Hablás con ${i.vet}. Los correos salen de SU cuenta: la firma lleva su nombre y debajo el ` +
        `de la clínica.`,
    )
  }

  if (i.patientId) {
    lineas.push(
      `Hay un paciente en contexto (id interno: ${i.patientId}) — usa get_patient_summary si lo necesitas.`,
    )
  }

  // Qué pantalla está mirando. Devuelve `null` cuando no hay nada útil que decir, y entonces no se
  // agrega línea: una que diga "estás en la plataforma" se paga en tokens todos los turnos.
  const pantalla = i.contexto ? contextoParaElPrompt(i.contexto) : null
  if (pantalla) lineas.push(pantalla)

  // QUÉ ESTÁ ESPERANDO EN LA CLÍNICA. Va después de la pantalla y antes del objetivo de la bandeja:
  // primero dónde estás, después qué hay pendiente, después qué se espera de vos acá.
  const pendientes = i.pendientes ? pendientesParaElPrompt(i.pendientes) : null
  if (pendientes) lineas.push(pendientes)

  if (i.source === "inbox") {
    lineas.push(
      "Estás en la bandeja de WhatsApp: el objetivo típico es proponer una respuesta con send_whatsapp_message.",
    )
  }

  const cuerpo = lineas.map((l) => `- ${l}`).join("\n")
  return `# Contexto runtime\n\n${cuerpo}${i.avisoDensidad ?? ""}`
}
