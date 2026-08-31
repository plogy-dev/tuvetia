// Lo que se manda cuando el modelo decidió callarse Y hay una cita a medio armar.
//
// ── LA REGLA QUE ESTE ARCHIVO NO PUEDE ROMPER ─────────────────────────────────────────────────
//
// El silencio del modo automático NO es un defecto: es la garantía de que VetGPT no contesta nada
// clínico. «Ante la mínima duda, silencio» está en el prompt a propósito, y sigue siendo el
// comportamiento por defecto de todo lo que no sea un agendamiento en curso.
//
// Lo que sí era un defecto es que el silencio fuera el comodín TAMBIÉN a mitad de una cita. El
// 30-ago un titular dijo «Mañana», la clínica no tenía horarios cargados, y se comió cuatro
// silencios seguidos: «?», «?», «a qué horas quedó mi cita?». Para una pregunta suelta el silencio
// es correcto —lo contesta el vet—; a mitad de un agendamiento es lo peor que puede pasar.
//
// ── POR QUÉ ESTO NO ES TEXTO DEL MODELO ───────────────────────────────────────────────────────
//
// Todas las respuestas de acá son LITERALES escritos por una persona. No son una segunda pasada del
// modelo con un prompt más suelto, ni un resumen, ni una plantilla que se rellene con algo que el
// modelo haya dicho. Un literal no puede hablar de una dosis porque no la contiene.
//
// Ésa es la única razón por la que se puede romper el silencio sin romper la garantía clínica, y es
// lo que fija `respuestas-de-rescate.test.ts` pasando cada literal por una lista negra. Si algún día
// alguien quiere que esto redacte, la garantía se cae — y hay que discutirlo, no hacerlo.
//
// SIN IMPORTACIONES salvo los tipos, igual que sus dos hermanos.

import { siguientePregunta, type DatosDeLaCita } from "./datos-de-la-cita"

/** Por qué el turno se quedó sin texto. Cada uno lleva a una salida distinta. */
export type MotivoDelSilencio =
  /** El modelo devolvió NO_REPLY o texto vacío teniendo una cita abierta. */
  | "sin_texto"
  /** La clínica no cargó horarios: no hay cupo que ofrecer en ningún día. */
  | "sin_horarios"
  /** Se acabaron los intentos: esto ya es del vet. */
  | "sin_avance"

/** Cuántos turnos sin avanzar antes de entregarle la conversación al vet. */
export const TURNOS_ANTES_DE_ENTREGAR = 3

export type EstadoParaRescate = {
  /** `false` = no hay agendamiento en curso, y entonces acá no se manda NADA. */
  citaEnCurso: boolean
  datos: DatosDeLaCita
  /** Turnos seguidos en los que no se llenó ningún dato nuevo. */
  mensajesSinAvance: number
}

/**
 * El mensaje de rescate, o `null` para dejar el silencio como está.
 *
 * DEVOLVER `null` ES EL CAMINO NORMAL. Todo lo que no sea un agendamiento en curso —lo clínico, los
 * precios, las quejas, una pregunta que el modelo no supo contestar— sale por acá y sigue yendo a la
 * bandeja del vet exactamente como antes.
 */
export function respuestaDeRescate(
  estado: EstadoParaRescate,
  motivo: MotivoDelSilencio,
): string | null {
  if (!estado.citaEnCurso) return null

  // Se rindió: mejor decirle que lo toma una persona que seguir preguntando lo mismo. Y el estado
  // pasa a `entregada_al_vet` en el mismo movimiento (lo hace quien llama), así que esto se manda
  // una sola vez y no queda un bucle de disculpas.
  if (motivo === "sin_avance" || estado.mensajesSinAvance >= TURNOS_ANTES_DE_ENTREGAR) {
    return "Perdoná, no te estoy entendiendo bien. Ya le pasé tu pedido al equipo de la clínica y te escriben en breve para cerrar la cita."
  }

  if (motivo === "sin_horarios") {
    const falta = siguientePregunta(estado.datos)
    return [
      "Estamos terminando de organizar la agenda, así que todavía no te puedo dar una hora exacta.",
      "Te dejo anotado el pedido y el equipo te escribe con el horario.",
      falta ? ` ${falta}` : " ¿Te confirmo así?",
    ]
      .join("")
      .replace(/\s+/g, " ")
      .trim()
  }

  // `sin_texto`: el modelo se calló teniendo la conversación abierta. Se repite la única pregunta
  // pendiente, que sale de la misma función que arma el prompt — así el rescate no puede preguntar
  // algo distinto de lo que el modelo venía preguntando.
  const falta = siguientePregunta(estado.datos)
  if (falta) return `Perdoná, se me cruzaron los cables. ${falta}`

  // No falta nada: estaba en la confirmación. No se re-lee todo acá —eso lo arma el modelo con los
  // datos— pero tampoco se lo deja esperando.
  return "¿Te confirmo la cita con esos datos?"
}
