// Qué paciente resolvió Athos POR SU CUENTA, leído de sus llamadas a herramientas.
//
// POR QUÉ EXISTE. Es el punto que abrió la reunión del 17-ago:
//
//     Luciano: "en el momento en que yo tenga 200 pacientes, ¿cómo carajo le voy a decir al man qué
//               contexto tiene? Imposible… Athos debería reconocer el contexto y traerlo dependiendo
//               de la conversación"
//
// Y la objeción de Jesús, que es clínica y seria: "si tú tienes 7 perros que tienen leucemia… la
// característica específica se te llega a escapar conversacionalmente, y llegas a dar un mal
// diagnóstico".
//
// El acuerdo no fue darle la razón a ninguno de los dos: **el selector se queda, y encima se
// muestra qué detectó Athos, para poder verificarlo y corregirlo.** Textual de Luciano: "esta
// opción no se tiene que quitar", y "como tipo Claude, cuando el man está pensando… ya tengo el
// contexto completo de Manchita".
//
// LA MITAD QUE YA FUNCIONABA. Athos hace rato que puede encontrar a Manchita solo: `search_patients`
// busca por nombre de mascota o de titular, y el prompt de sistema le ordena usarla antes de operar
// sobre nada. Lo que faltaba no era la detección — era que el veterinario la VIERA. Hoy el chip del
// encabezado muestra sólo lo que el vet eligió en el selector; si Athos resolvió otro paciente, se
// entera leyendo la respuesta y adivinando.
//
// DE DÓNDE SALE EL DATO. De los `parts` de los mensajes: el AI SDK expone cada llamada a herramienta
// con su entrada y su salida. No hace falta ningún canal nuevo ni una query más — la información ya
// está viajando, sólo que nadie la mira.
//
// POR QUÉ ES UN `.ts` PURO. Igual que `derivar.ts`: el repo corre vitest en `environment: "node"` y
// no tiene con qué montar componentes. Lo que quiera cobertura tiene que vivir fuera de React. Y
// esto la quiere: es una heurística sobre datos ajenos, que es justo lo que se rompe en silencio.

/** La forma MÍNIMA que necesitamos de un mensaje. Estructural a propósito: así los tests arman
 *  casos a mano sin construir un `UIMessage` entero del SDK. */
export type ParteDeMensaje = {
  type: string
  state?: string
  output?: unknown
}

export type MensajeConPartes = {
  role: string
  parts?: readonly ParteDeMensaje[]
}

export type PacienteDetectado = {
  id: string
  nombre: string
  especie: string | null
  /**
   * CÓMO lo supo, porque cambia lo que se le puede afirmar al vet.
   *
   * - `ficha`: Athos abrió el expediente (`get_patient_summary`). Es un hecho, no una inferencia.
   * - `busqueda`: lo resolvió buscando y hubo UNA sola coincidencia.
   */
  via: "ficha" | "busqueda"
}

/** Los `type` de part que emite el SDK para estas dos tools. */
const FICHA = "tool-get_patient_summary"
const BUSQUEDA = "tool-search_patients"

function comoObjeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null
}

/** `{ patient: { id, name, species, … } }` — la salida de `get_patient_summary`. */
function deLaFicha(output: unknown): PacienteDetectado | null {
  const o = comoObjeto(output)
  const p = comoObjeto(o?.patient)
  const id = texto(p?.id)
  const nombre = texto(p?.name)
  return id && nombre ? { id, nombre, especie: texto(p?.species), via: "ficha" } : null
}

/**
 * `{ count, patients: [ { id, name, species, … } ] }` — la salida de `search_patients`.
 *
 * SÓLO CUENTA SI HUBO UNA COINCIDENCIA. Con varias, Athos todavía no eligió, y afirmar que "está
 * usando a Manchita" cuando hay tres Manchitas es exactamente el error que Jesús advirtió en la
 * reunión. Con cero, no hay nada que decir.
 */
function deLaBusqueda(output: unknown): PacienteDetectado | null {
  const o = comoObjeto(output)
  const lista = Array.isArray(o?.patients) ? (o.patients as unknown[]) : null
  if (!lista || lista.length !== 1) return null
  const p = comoObjeto(lista[0])
  const id = texto(p?.id)
  const nombre = texto(p?.name)
  return id && nombre ? { id, nombre, especie: texto(p?.species), via: "busqueda" } : null
}

/**
 * El paciente con el que Athos está trabajando, o `null` si no resolvió ninguno.
 *
 * Se recorre de lo MÁS RECIENTE a lo más viejo y se devuelve el primero: en una conversación que
 * pasó de Manchita a Rocky, el contexto vigente es Rocky. Una herramienta que todavía está corriendo
 * no cuenta —no tiene salida— y una que falló, tampoco.
 */
export function pacienteDetectado(
  messages: readonly MensajeConPartes[] | undefined,
): PacienteDetectado | null {
  if (!messages?.length) return null

  for (let i = messages.length - 1; i >= 0; i--) {
    const partes = messages[i].parts
    if (!partes?.length) continue
    for (let j = partes.length - 1; j >= 0; j--) {
      const parte = partes[j]
      if (parte.state !== "output-available") continue
      if (parte.type === FICHA) {
        const hallado = deLaFicha(parte.output)
        if (hallado) return hallado
      } else if (parte.type === BUSQUEDA) {
        const hallado = deLaBusqueda(parte.output)
        if (hallado) return hallado
      }
    }
  }
  return null
}

/**
 * ¿Hay que avisarle al vet de una discrepancia?
 *
 * El caso que importa: el selector dice "consulta general" o dice *otro* paciente, y Athos está
 * trabajando con uno distinto. Ahí es donde una detección silenciosa se vuelve peligrosa — y es lo
 * que el indicador tiene que dejar ver y corregir de un clic.
 *
 * Si coinciden no hay nada que resolver, y con Athos sin detectar nada tampoco.
 */
export function discrepa(
  seleccionado: string | null,
  detectado: PacienteDetectado | null,
): boolean {
  if (!detectado) return false
  return detectado.id !== seleccionado
}
