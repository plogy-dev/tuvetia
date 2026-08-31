// Qué se le pregunta a alguien que pide cita y todavía no es titular, en qué orden, y qué falta.
//
// SIN UNA SOLA IMPORTACIÓN, a propósito — misma forma que `requisitos-del-modo-automatico.ts`. Esto
// lo consumen dos lados que no pueden compartir nada más: la tool que corre en el servidor con
// `service_role` y el bloque de texto que se le inyecta al modelo. Que las dos mitades salgan de
// ACÁ es lo único que garantiza que «lo que ya tengo» y «lo que sigue» no se contradigan — y una
// contradicción entre esas dos cosas se ve, del otro lado, como VetGPT preguntando dos veces el
// nombre de la mascota.
//
// ── POR QUÉ NO SE DERIVA DEL HILO ─────────────────────────────────────────────────────────────
//
// La tentación es leer los últimos mensajes y deducir qué falta. No sirve por tres razones, y las
// tres se midieron en el chat del 30-ago: el hilo que viaja al modelo está truncado en 12 mensajes
// (una recolección de dos días se cae de la ventana), el modelo releyendo sus propias preguntas es
// justamente lo que produce la re-pregunta, y «la conversación está completa» tiene que ser una
// condición que una máquina pueda comprobar — una ventana de mensajes no lo es.

/** Lo que se junta antes de poder pedir la cita. Todo opcional: se llena de a pedazos. */
export type DatosDeLaCita = {
  nombre?: string | null
  mascota?: string | null
  especie?: string | null
  motivo?: string | null
  email?: string | null
  /**
   * La persona dijo que no quiere dar el correo.
   *
   * SIN ESTA BANDERA LA CONVERSACIÓN SE TRABA, que es exactamente el defecto que este trabajo viene
   * a arreglar: «siempre pedir el correo» no puede significar «siempre obtenerlo». `owners.email` es
   * nullable y hay gente que no lo da. Con la bandera puesta, el correo deja de faltar.
   */
  email_rechazado?: boolean
  fecha?: string | null
  hora?: string | null
  /** No había cupos que ofrecer: la hora la pone el equipo. */
  sin_hora?: boolean
  /** Con `sin_hora`, la franja en las palabras de la persona: «en la tarde». */
  preferencia?: string | null
}

export type IdDeDato = "nombre" | "mascota" | "especie" | "motivo" | "cuando" | "email"

/**
 * El orden en que se pregunta, y no es arbitrario:
 *
 *   1. `nombre` y `mascota` — los dos NOT NULL de la base (`owners.full_name`, `patients.name`).
 *      Sin ellos no hay ficha que crear, así que son lo primero.
 *   2. `especie` y `motivo` — el otro NOT NULL (`patients.species`) y lo que convierte el pedido en
 *      una cita. Van juntos porque cada mensaje de ida y vuelta pierde gente.
 *   3. `cuando` — va acá y no antes porque es el único que necesita consultar la agenda.
 *   4. `email` — último a propósito: es el único que se puede rechazar, y ponerlo antes que la
 *      fecha haría que un «no te lo doy» se sienta como el final de la conversación.
 */
const ORDEN: IdDeDato[] = ["nombre", "mascota", "especie", "motivo", "cuando", "email"]

const vacio = (v: unknown): boolean => typeof v !== "string" || v.trim().length === 0

/** ¿Está ese dato ya resuelto? Es la única definición; todo lo demás la usa. */
function resuelto(datos: DatosDeLaCita, id: IdDeDato): boolean {
  switch (id) {
    case "nombre":
      return !vacio(datos.nombre)
    case "mascota":
      return !vacio(datos.mascota)
    case "especie":
      return !vacio(datos.especie)
    case "motivo":
      return !vacio(datos.motivo)
    // Con `sin_hora` la hora la pone el equipo al aprobar: alcanza con saber el día. Sin eso, la
    // conversación no podría cerrar nunca en una clínica que no cargó sus horarios — el caso exacto
    // que dejó a un titular esperando el 30-ago.
    case "cuando":
      return datos.sin_hora === true ? !vacio(datos.fecha) : !vacio(datos.fecha) && !vacio(datos.hora)
    case "email":
      return !vacio(datos.email) || datos.email_rechazado === true
  }
}

/** Lo que falta, en el orden en que se va a preguntar. Vacío = se puede pedir la cita. */
export function faltantes(datos: DatosDeLaCita): IdDeDato[] {
  return ORDEN.filter((id) => !resuelto(datos, id))
}

/** Las preguntas, escritas una sola vez. El modelo las reformula; el rescate las manda tal cual. */
const PREGUNTAS: Record<IdDeDato, string> = {
  nombre: "¿Me decís tu nombre y el de tu mascota?",
  mascota: "¿Cómo se llama tu mascota?",
  especie: "¿Qué es tu mascota — perro, gato, u otro?",
  motivo: "¿Por qué la querés traer?",
  cuando: "¿Qué día te queda bien?",
  email: "¿A qué correo te mando la confirmación?",
}

/**
 * La única pregunta pendiente, o `null` cuando ya no falta nada.
 *
 * `nombre` y `mascota` comparten pregunta a propósito: se piden en un solo mensaje, y si faltan los
 * dos preguntarlos de a uno son dos vueltas donde alcanza una.
 */
export function siguientePregunta(datos: DatosDeLaCita): string | null {
  const faltan = faltantes(datos)
  if (faltan.length === 0) return null
  if (faltan[0] === "nombre") return PREGUNTAS.nombre
  return PREGUNTAS[faltan[0]]
}

/**
 * Lo que se le lee de vuelta a la persona antes de pedir la cita.
 *
 * El teléfono va en la lista aunque nunca se haya preguntado: es el dato con el que se va a crear su
 * ficha, y verlo escrito es la única oportunidad que tiene de corregirlo si escribe desde el
 * teléfono de otra persona.
 */
export function resumenParaConfirmar(datos: DatosDeLaCita, telefono: string): string[] {
  const lineas = [
    `Nombre: ${datos.nombre ?? "—"}`,
    `Mascota: ${datos.mascota ?? "—"}${datos.especie ? ` (${datos.especie})` : ""}`,
    `Motivo: ${datos.motivo ?? "—"}`,
    `Teléfono: ${telefono}`,
  ]
  if (datos.email) lineas.push(`Correo: ${datos.email}`)
  lineas.push(
    datos.sin_hora
      ? `Día: ${datos.fecha ?? "—"}${datos.preferencia ? ` (${datos.preferencia})` : ""} — la hora te la confirmamos`
      : `Cuándo: ${datos.fecha ?? "—"} a las ${datos.hora ?? "—"}`,
  )
  return lineas
}

/**
 * El bloque que se le inyecta al modelo en el prompt.
 *
 * Se renderiza desde la MISMA función que calcula lo que falta — si fueran dos, el prompt podría
 * decir «ya tenés el nombre» mientras la lógica lo cuenta como faltante, y el modelo quedaría
 * atrapado entre las dos.
 */
export function bloqueParaElPrompt(datos: DatosDeLaCita): string {
  const tengo = ORDEN.filter((id) => resuelto(datos, id))
  const faltan = faltantes(datos)

  const ya = tengo.length
    ? tengo
        .map((id) => {
          if (id === "cuando") {
            return datos.sin_hora
              ? `cuándo=${datos.fecha}${datos.preferencia ? ` (${datos.preferencia})` : ""}, sin hora`
              : `cuándo=${datos.fecha} ${datos.hora}`
          }
          if (id === "email") {
            return datos.email_rechazado ? "correo=NO LO QUIERE DAR (no se lo pidas más)" : `correo=${datos.email}`
          }
          return `${id}=${datos[id as keyof DatosDeLaCita]}`
        })
        .join(" · ")
    : "nada todavía"

  const siguiente = siguientePregunta(datos)

  return [
    `DATOS QUE YA TE DIO: ${ya}`,
    `TE FALTA: ${faltan.length ? faltan.join(", ") : "nada — leele todo de vuelta y pedile que confirme"}`,
    siguiente
      ? `LA PRÓXIMA PREGUNTA ES ÉSTA Y NINGUNA OTRA: "${siguiente}". Lo que ya está arriba NO se vuelve a preguntar NUNCA.`
      : "No preguntes más datos: confirmá y llamá solicitar_cita.",
  ].join("\n")
}
