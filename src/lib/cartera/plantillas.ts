// Las plantillas de los recordatorios de cobranza, de cada clínica.
//
// ── DE DÓNDE SALE ─────────────────────────────────────────────────────────────────────────────
//
// Del documento de cambios del cliente (24-ago): «plantillas de WhatsApp predeterminadas
// configurables por veterinario (no genéricas para todos)». Hasta hoy el texto estaba escrito a
// mano en `cartera/scheduler.ts`, así que TODAS las clínicas del país mandaban exactamente el mismo
// mensaje — con el mismo tono y sin el nombre de nadie.
//
// ── LOS HUECOS SON EL CONTRATO, Y POR ESO SE VALIDAN ──────────────────────────────────────────
//
// Un recordatorio de cobranza sólo sirve si el titular puede saber DE QUÉ le hablan y CÓMO pagar.
// Eso son dos huecos, y si el vet borra uno al reescribir el texto, el mensaje sale igual pero
// deja de funcionar:
//
//   · sin `{number}` — «tiene una factura vencida», y el titular no sabe cuál de las tres;
//   · sin `{link}`   — se le pide que pague sin decirle dónde, y llama a la clínica a preguntar.
//
// Nadie lo notaría desde adentro: el envío diría ENVIADO y el mensaje se vería bien en la caja de
// texto. Se descubriría por los titulares llamando, o por la cartera que no baja. Por eso los dos
// se exigen al GUARDAR, que es el único momento en que hay alguien mirando.
//
// `{balance}` NO se exige: «le recordamos su factura {number}, puede pagarla acá: {link}» es un
// mensaje perfectamente bueno, y el saldo se ve al abrir el enlace. Exigirlo sería mandar sobre el
// tono, que es justo lo que esta pantalla viene a devolverle a cada clínica.
//
// ── UN HUECO QUE NO EXISTE SE MANDA TAL CUAL ──────────────────────────────────────────────────
//
// `{nombre}` o `{mascota}` parecen razonables y no existen: saldrían impresos con sus llaves en el
// WhatsApp del titular. Se rechazan al guardar, nombrándolos, en vez de dejar que la clínica lo
// descubra en el teléfono de un cliente.

import { REMINDER_STEP_KINDS, type ReminderStepKind } from "@/lib/supabase/facturacion-enums"

/** Los huecos que el sistema sabe llenar. */
export const HUECOS = ["number", "balance", "link"] as const
export type Hueco = (typeof HUECOS)[number]

/** Los que, sin ellos, el mensaje sale pero no sirve. */
const HUECOS_OBLIGATORIOS: Hueco[] = ["number", "link"]

/** Tope de largo. No es el de WhatsApp (4096): es el de un mensaje de cobro que alguien lee. */
export const LARGO_MAXIMO = 1000

/**
 * El texto por defecto de cada paso — el mismo que estaba escrito a mano en el programador.
 *
 * Se conserva palabra por palabra: es lo que las clínicas vienen recibiendo, y cambiarlo de paso
 * habría alterado el mensaje de todas las que NO tocan nada.
 */
export const PLANTILLAS_POR_DEFECTO: Record<ReminderStepKind, string> = {
  ENVIO_FACTURA: "Le compartimos su factura {number}. Puede pagarla aquí: {link}",
  RECORDATORIO_1:
    "Le recordamos que su factura {number} venció. Saldo: {balance}. Pague aquí: {link}",
  RECORDATORIO_2: "Segundo recordatorio de su factura {number}. Saldo pendiente: {balance}. {link}",
  AVISO_SALDO: "Aviso de saldo pendiente: factura {number} por {balance}. {link}",
  ESCALAMIENTO:
    "Su caso será atendido personalmente por nuestro equipo (factura {number}). {link}",
}

/** Cómo se llama cada paso en la pantalla de configuración. */
export const NOMBRE_DEL_PASO: Record<ReminderStepKind, string> = {
  ENVIO_FACTURA: "Al enviar la factura",
  RECORDATORIO_1: "Primer recordatorio",
  RECORDATORIO_2: "Segundo recordatorio",
  AVISO_SALDO: "Aviso de saldo pendiente",
  ESCALAMIENTO: "Escalamiento al equipo",
}

/** Lo guardado por la clínica: un texto por paso, y los pasos que falten caen al de por defecto. */
export type PlantillasDeClinica = Partial<Record<ReminderStepKind, string>>

/**
 * Lee lo guardado en `billing_settings.reminder_templates`.
 *
 * ES DEFENSIVO A PROPÓSITO. La columna es `jsonb`: puede traer lo que sea —un arreglo, un número,
 * una clave que ya no es un paso, un valor que no es texto— porque nada en Postgres le impone
 * forma. Un recordatorio que no sale por un json raro es plata que no se cobra, así que todo lo que
 * no se entiende se ignora y ese paso usa su texto por defecto.
 */
export function leerPlantillas(guardado: unknown): PlantillasDeClinica {
  if (!guardado || typeof guardado !== "object" || Array.isArray(guardado)) return {}
  const out: PlantillasDeClinica = {}
  for (const paso of REMINDER_STEP_KINDS) {
    const v = (guardado as Record<string, unknown>)[paso]
    if (typeof v === "string" && v.trim()) out[paso] = v.trim()
  }
  return out
}

/** El texto que le toca a un paso: el de la clínica si lo hay, si no el de por defecto. */
export function plantillaDe(
  plantillas: PlantillasDeClinica,
  paso: ReminderStepKind,
): string {
  return plantillas[paso] ?? PLANTILLAS_POR_DEFECTO[paso]
}

/** Los huecos que aparecen en un texto, sin repetir. */
export function huecosDe(texto: string): string[] {
  return [...new Set([...texto.matchAll(/\{([a-zA-Z_]+)\}/g)].map((m) => m[1]))]
}

/**
 * Revisa una plantilla antes de guardarla. Devuelve el problema en español, o `null` si está bien.
 */
export function revisarPlantilla(texto: string): string | null {
  const t = texto.trim()
  if (!t) return "El mensaje no puede quedar vacío."
  if (t.length > LARGO_MAXIMO) {
    return `El mensaje no puede pasar de ${LARGO_MAXIMO} caracteres (va en ${t.length}).`
  }

  const presentes = huecosDe(t)

  const faltan = HUECOS_OBLIGATORIOS.filter((h) => !presentes.includes(h))
  if (faltan.length > 0) {
    // El porqué va en el mensaje: «falta {link}» no le dice a nadie qué se rompe.
    const explica: Record<string, string> = {
      number: "{number} — sin él, el titular no sabe de cuál de sus facturas le hablan",
      link: "{link} — sin él, se le pide que pague sin decirle dónde",
    }
    return `Falta ${faltan.map((h) => explica[h]).join("; y falta ")}.`
  }

  const desconocidos = presentes.filter((h) => !HUECOS.includes(h as Hueco))
  if (desconocidos.length > 0) {
    return `${desconocidos.map((h) => `{${h}}`).join(", ")} no ${
      desconocidos.length === 1 ? "existe" : "existen"
    }: saldría tal cual en el WhatsApp del titular. Se pueden usar ${HUECOS.map((h) => `{${h}}`).join(", ")}.`
  }

  return null
}

/**
 * Llena los huecos de una plantilla.
 *
 * SE REEMPLAZAN TODAS LAS APARICIONES, no la primera. `String.replace` con una CADENA cambia sólo
 * la primera, y con las plantillas escritas a mano eso nunca se notó porque cada hueco aparecía una
 * sola vez. En cuanto el vet las escribe, «pague en {link} o reenvíeselo a quien corresponda:
 * {link}» deja de ser raro — y con `replace` el segundo saldría impreso con sus llaves.
 */
export function llenarPlantilla(
  texto: string,
  valores: { number: string; balance: string; link: string },
): string {
  return texto.replace(/\{(number|balance|link)\}/g, (_, hueco: Hueco) => valores[hueco])
}
