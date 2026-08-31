// De qué va esta conversación: información general, una cita, o algo clínico.
//
// SIN IMPORTACIONES, igual que `datos-de-la-cita.ts` — y sin una segunda llamada al modelo, que es
// la decisión que más importa de este archivo. El comentario de `auto-reply.ts` es explícito en que
// el modo automático es, junto con cartera, la superficie que gasta IA sin que nadie mire; agregar
// un clasificador con modelo duplicaría el costo de CADA entrante para decidir algo que dos señales
// baratas ya resuelven.
//
// ── LAS DOS SEÑALES ───────────────────────────────────────────────────────────────────────────
//
//   1. Este archivo: palabras sobre el último mensaje. Acierta en el mensaje exacto que arrancó el
//      bug del 30-ago («Quiero agendar una cita»).
//   2. La conducta observada, que se aplica en `auto-reply.ts`: si el modelo llamó una herramienta
//      de agenda, es una cita. Ésa es la señal fuerte, porque el modelo no la puede fingir — para
//      decir «es una cita» tiene que actuar como si lo fuera.
//
// Las palabras se equivocan; la conducta no. Por eso esto es un PRIOR y no un veredicto.

export type Intencion = "general" | "cita" | "clinico"

/**
 * Lo clínico se mira PRIMERO y gana siempre.
 *
 * «Milo está vomitando, ¿me dan cita?» es las dos cosas, y tiene que clasificar como clínico: el
 * riesgo de tratar un síntoma como un trámite es de otro orden que el de mandar una cita a la
 * bandeja. La regla de la casa —«ante la mínima duda, silencio»— se apoya en que esta lista sea
 * generosa, no exacta.
 */
const CLINICO =
  /\b(vomit|diarrea|sangr|convuls|desmay|intoxic|veneno|dolor|cojea|fiebre|decaíd|decaid|no come|no quiere comer|urgenci|emergenci|grave|dosis|medicament|pastilla|antibiótic|antibiotic|vacun[ao]s? (?:que|cuál|cual)|síntoma|sintoma|le pasa|está mal|esta mal)/i

/** Pedir, mover o preguntar por una cita. */
const CITA =
  /\b(cita|citas|agendar|agenda|turno|reservar|reserva|separar|cupo|cupos|disponibilidad|horario para|cuándo pueden|cuando pueden|puedo llevar|puedo ir|atienden a|reprogram|cambiar la hora)\b/i

/**
 * Qué dice ESTE mensaje, sin memoria.
 *
 * Devuelve `null` cuando el mensaje no dice nada por sí solo — «Mañana», «?», «Santiago Tellez» —
 * y ese `null` es la parte que importa: es el caso del 30-ago. Un clasificador que devolviera
 * `general` para «Mañana» borraría la cita que ya estaba en curso y mandaría al agente a tratar la
 * respuesta como una consulta suelta.
 */
function loQueDiceElMensaje(texto: string): Intencion | null {
  const t = (texto ?? "").trim()
  if (!t) return null
  if (CLINICO.test(t)) return "clinico"
  if (CITA.test(t)) return "cita"
  return null
}

/**
 * La intención de la conversación después de este mensaje.
 *
 * `previa` es lo que ya se sabía. Las reglas, en orden:
 *
 *   · Lo clínico gana siempre, incluso sobre una cita en curso: el silencio protege más que el
 *     trámite. La cita no se pierde —los datos siguen guardados— pero este turno no se contesta.
 *   · `general → cita` es una PROMOCIÓN y no vuelve: una vez que alguien pidió cita, seguir
 *     tratándolo como una consulta suelta es lo que produce el chat cortado.
 *   · Un mensaje que no dice nada CONSERVA lo que había. «Mañana» dentro de un agendamiento sigue
 *     siendo el agendamiento; ésa es toda la diferencia entre el chat que funcionó y el que no.
 */
export function intencionDeLaConversacion(texto: string, previa: Intencion = "general"): Intencion {
  const dice = loQueDiceElMensaje(texto)
  if (dice === "clinico") return "clinico"
  if (dice === "cita") return "cita"
  // Sin señal propia: manda lo que ya había, salvo `clinico`, que es de un solo turno — el titular
  // que contó un síntoma y después pregunta el horario merece que le contesten el horario.
  return previa === "clinico" ? "general" : previa
}

/** ¿Hay un agendamiento en curso que no se puede dejar sin respuesta? */
export function hayCitaEnCurso(intencion: Intencion): boolean {
  return intencion === "cita"
}
