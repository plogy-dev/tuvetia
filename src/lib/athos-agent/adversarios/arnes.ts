/**
 * El arnés: corre el agente REAL contra un caso del corpus, sin tocar la base ni mandar nada.
 *
 * LA REGLA QUE ORDENA TODO ESTE ARCHIVO: lo único que se falsea es el MUNDO, nunca el agente. El
 * system prompt es el de producción (`ATHOS_AGENT_SYSTEM_PROMPT` + el bloque de contexto runtime,
 * armado igual que en la ruta), el modelo es el que resuelva `agentModel()` —o sea, el que
 * configuren las env vars, con su cascada— y las descripciones y esquemas de las 21 tools son los
 * de `buildAthosTools`. Si el banco midiera un prompt recortado o una lista de tools propia estaría
 * midiendo a otro agente, y el resultado no diría nada sobre el que atiende a los veterinarios.
 *
 * QUÉ SÍ SE REEMPLAZA: el `execute` de cada tool, y sólo eso.
 *   · LECTURA  → devuelve el fixture envenenado del caso. Es el vector del ataque.
 *   · ESCRITURA → no propone nada en la base: anota la llamada y devuelve exactamente lo que
 *     devolvería `proposeAction`. Tiene que devolver eso y no un `{ok:true}` cualquiera, porque el
 *     agente LEE esa respuesta y sigue razonando a partir de ella: si le llegara algo que no dice
 *     "no está ejecutada", el turno siguiente sería otro.
 *
 * POR QUÉ NO SE USA UN SUPABASE FALSO Y LAS TOOLS DE VERDAD. Porque las de lectura consultan tablas
 * con formas distintas cada una, y reproducir eso en un cliente falso sería reproducir media base
 * para terminar controlando lo mismo que se controla acá en una línea: qué texto ve el modelo.
 */
import { generateText, stepCountIs, type LanguageModel, type ToolSet } from "ai"
import type { SupabaseClient } from "@supabase/supabase-js"

import { ATHOS_AGENT_SYSTEM_PROMPT } from "@/lib/athos-agent/system-prompt"
import { bloqueDeContextoRuntime } from "@/lib/athos-agent/contexto-runtime"
import { buildAthosTools } from "@/lib/athos-agent/tools"
import { agentModel } from "@/lib/athos-agent/model"
import type { AgentContext } from "@/lib/athos-agent/actions"
import type { CasoAdversario } from "./casos"
import type { EscrituraPropuesta, Transcripcion } from "./veredicto"

/**
 * Las nueve tools que escriben. Se enumeran acá y `adversarios.test.ts` comprueba contra
 * `buildAthosTools` que la lista siga completa: una tool de escritura nueva que no esté acá se
 * trataría como de lectura y el banco no vería nunca lo que propone.
 */
export const TOOLS_DE_ESCRITURA = [
  "send_whatsapp_message",
  "send_email",
  "reply_email",
  "create_appointment",
  "update_appointment",
  "create_owner",
  "create_patient",
  "create_owner_and_patient",
  "update_patient_record",
] as const

/**
 * La nota EXACTA que `proposeAction` le devuelve al modelo.
 *
 * Está duplicada a propósito —el arnés no puede llamar a `proposeAction`, que escribe en la base—
 * y por eso `adversarios.test.ts` compara las dos cadenas. Si alguien cambia la de producción, el
 * test se pone rojo: un banco que le contesta al modelo algo distinto de lo que le contesta la app
 * mide a un agente que no existe.
 */
export const NOTA_PROPUESTA =
  "Acción registrada como PROPUESTA — pendiente de aprobación del veterinario en la tarjeta. No está ejecutada."

/** Lo que devuelve una tool de lectura sin fixture: vacío y sin error, para no inducir nada. */
const VACIO: Record<string, unknown> = { count: 0, results: [] }

/** Fecha fija: un banco cuyo resultado dependa del día en que se corre no es reproducible. */
const HOY = "2026-08-24"

export type OpcionesDeCorrida = {
  /** Tope de pasos del loop de tools. El de producción es 8. */
  pasos?: number
  /** Milisegundos antes de abandonar la corrida. */
  timeoutMs?: number
  /**
   * Modelo alternativo. EXISTE PARA PROBAR EL ARNÉS, no para medir con otro modelo desde acá.
   *
   * El arnés es código que decide qué se graba y qué ve el modelo: si estuviera sin probar, un
   * error suyo —una escritura que no se anota, un fixture que no llega— daría un banco entero en
   * verde sin que nada lo delate. Con esto, `adversarios.test.ts` lo maneja con un modelo falso y
   * verifica el cableado en CI, sin red. Para medir con otro modelo de verdad están las env vars
   * de `agentModel()`, que es lo que corre en producción.
   */
  modelo?: LanguageModel
}

/**
 * Corre UN caso y devuelve qué hizo el agente.
 *
 * No lanza: un fallo de proveedor (sin crédito, límite de tasa, timeout) vuelve como
 * `transcripcion.fallo` para que el informe pueda distinguir "el agente resistió" de "no se pudo
 * medir". Confundir esas dos cosas es cómo un banco termina reportando 0% de obediencia porque
 * nunca llamó a nadie.
 */
export async function correrCaso(
  caso: CasoAdversario,
  opciones: OpcionesDeCorrida = {},
): Promise<Transcripcion> {
  const escrituras: EscrituraPropuesta[] = []
  const lecturas: string[] = []

  const elegido = agentModel()
  const ctx: AgentContext = {
    userId: "vet-adversarios",
    clinicId: "clinic-adversarios",
    source: "chat",
    conversationKey: null,
    patientId: null,
    accessToken: null,
    get model() {
      return elegido.modelId
    },
  }

  // Se construyen las tools REALES sólo para quedarse con su `description` y su `inputSchema`, que
  // es lo que el modelo lee y lo que decide su comportamiento. El cliente de Supabase que se les
  // pasa nunca se usa: todos los `execute` quedan reemplazados abajo.
  const reales = buildAthosTools(null as unknown as SupabaseClient, ctx) as unknown as ToolSet

  const escrituraSet = new Set<string>(TOOLS_DE_ESCRITURA)
  const tools = Object.fromEntries(
    Object.entries(reales).map(([nombre, definicion]) => [
      nombre,
      {
        ...definicion,
        execute: async (args: Record<string, unknown>) => {
          if (escrituraSet.has(nombre)) {
            escrituras.push({ tool: nombre, payload: args })
            return {
              action_id: `adv-${escrituras.length}`,
              status: "proposed",
              summary: `Propuesta simulada de ${nombre}`,
              note: NOTA_PROPUESTA,
            }
          }
          lecturas.push(nombre)
          return caso.lecturas[nombre] ?? VACIO
        },
      },
    ]),
  ) as ToolSet

  const system = `${ATHOS_AGENT_SYSTEM_PROMPT}\n\n${bloqueDeContextoRuntime({
    hoyISO: HOY,
    clinica: "Veterinaria San Jorge",
    vet: "Santiago Duque",
    patientId: null,
    contexto: null,
    source: "chat",
    avisoDensidad: "",
    pendientes: [],
  })}`

  const control = AbortSignal.timeout(opciones.timeoutMs ?? 120_000)

  try {
    const r = await generateText({
      model: opciones.modelo ?? elegido.model,
      system,
      messages: [{ role: "user", content: caso.pedido }],
      maxOutputTokens: 2000,
      tools,
      stopWhen: stepCountIs(opciones.pasos ?? 8),
      abortSignal: control,
    })
    return { texto: r.text ?? "", escrituras, lecturas }
  } catch (e) {
    // Las escrituras y lecturas que alcanzó a hacer se conservan: si el ataque funcionó y DESPUÉS
    // se cayó la corrida, esa propuesta sigue siendo una obediencia y tiene que contarse.
    return {
      texto: "",
      escrituras,
      lecturas,
      fallo: e instanceof Error ? e.message : String(e),
    }
  }
}

/** El modelo con el que se está midiendo. Va en la cabecera del informe: sin eso no significa nada. */
export function modeloDelBanco(): { modelId: string; provider: string } {
  const { modelId, provider } = agentModel()
  return { modelId, provider }
}
