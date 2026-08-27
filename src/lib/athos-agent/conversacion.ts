// Piezas puras del turno de conversación del agente. Sin Supabase ni AI SDK: se prueban solas.
//
// Resuelven cuatro defectos reportados el 2026-07-31 sobre `/dashboard/asistente`:
//   · respuestas desproporcionadas al input (diferenciales completos con 2 datos)
//   · la misma pregunta repetida al principio y al final
//   · párrafos largos cuando la literatura no aporta nada
//   · el hilo no sobrevivía a la sesión
import type { UIMessage } from "ai"

/** Texto plano de un mensaje del SDK (que viene partido en `parts`). */
export function textoDe(mensaje: UIMessage): string {
  return (mensaje.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim()
}

// --- Densidad clínica del input ------------------------------------------------------------
//
// El agente respondía con diferenciales completos ante "un perro que vomita". La respuesta tiene
// que ser proporcional a los datos: con poco input, lo correcto es PREGUNTAR.
//
// Se cuenta de forma determinística, no se le pregunta al modelo: contar es barato, reproducible y
// no gasta tokens. El resultado entra al prompt como contexto de runtime.

const SEÑALES: [RegExp, string][] = [
  [/\b(perr[oa]|gat[oa]|canin[oa]|felin[oa]|equin[oa]|bovin[oa]|conej[oa]|hurón|ave|loro)\b/i, "especie"],
  [/\b\d+\s*(años?|meses?|semanas?|días?)\b/i, "edad o evolución"],
  [/\b\d+([.,]\d+)?\s*(kg|kilos?|gr|gramos?)\b/i, "peso"],
  [/\b(macho|hembra|castrad[oa]|esterilizad[oa]|entero)\b/i, "sexo o estado reproductivo"],
  [/\b(vomit|diarrea|fiebre|tos|cojera|convuls|letarg|anorexi|prurito|rasca|decaí|sangr|disnea|poliuri|polidipsi)\w*/i, "signo clínico"],
  [/\b(hace|desde)\s+(un[oa]?s?|\d+|dos|tres|cuatro|cinco)\b/i, "tiempo de evolución"],
  [/\b(temperatura|fc|fr|mucosas|tllc|palpaci|ausculta|deshidrat)\w*/i, "hallazgo de examen"],
  [/\b(vacun|desparasit|tratamiento|medicad|antibiótic|corticoid)\w*/i, "antecedente terapéutico"],
  [/\b(hemograma|radiograf|ecograf|bioquím|urianáli|citolog)\w*/i, "paraclínico"],
]

export type Densidad = {
  /** Cuántas señales clínicas distintas trae el texto. */
  datos: number
  /** Qué se detectó — para el log y para explicar la decisión. */
  señales: string[]
  /** `escaso` = hay que preguntar antes de desarrollar. */
  nivel: "escaso" | "suficiente"
}

/** Umbral: con menos de 3 señales, un diferencial completo es adivinar. */
export const MINIMO_PARA_DESARROLLAR = 3

export function densidadClinica(texto: string): Densidad {
  const señales = SEÑALES.filter(([re]) => re.test(texto)).map(([, nombre]) => nombre)
  return {
    datos: señales.length,
    señales,
    nivel: señales.length >= MINIMO_PARA_DESARROLLAR ? "suficiente" : "escaso",
  }
}

/**
 * ¿Es una consulta clínica, o una instrucción operativa?
 *
 * "¿qué tengo mañana?" o "mándale un WhatsApp a la dueña de Lola" no necesitan densidad clínica —
 * pedir más datos ahí sería absurdo. La regla de proporcionalidad solo aplica a lo clínico.
 */
const OPERATIVO =
  /\b(agenda|cita|citas|mañana|hoy|horario|cupo|whatsapp|mensaje|factura|recordatorio|titular|teléfono|historial|última pregunta)\b/i

export function esConsultaClinica(texto: string): boolean {
  if (OPERATIVO.test(texto)) return false
  return densidadClinica(texto).datos > 0
}

// --- Preguntas duplicadas ------------------------------------------------------------------

// Qué DATO pide cada pregunta. La deduplicación va por dato, no por redacción: el defecto
// reportado es que el agente pide "el nombre del paciente" al abrir y "cómo se llama" al cerrar —
// dos frases distintas pidiendo lo mismo. Comparar cadenas no lo caza; comparar el dato sí.
const DATO_PEDIDO: [RegExp, string][] = [
  [/(nombre|se llama|cómo.*llama)[^?]*(paciente|perr|gat|mascota|animal)/i, "nombre del paciente"],
  [/(paciente|perr|gat|mascota)[^?]*(nombre|se llama)/i, "nombre del paciente"],
  [/(nombre|se llama|quién es)[^?]*(titular|dueñ|propietari)/i, "nombre del titular"],
  [/(titular|dueñ|propietari)[^?]*(nombre|se llama)/i, "nombre del titular"],
  [/edad|cuántos años|qué edad/i, "edad"],
  [/peso|cuánto pesa|cuántos kilos/i, "peso"],
  [/especie|es perro o gato/i, "especie"],
  [/sexo|macho o hembra/i, "sexo"],
  [/hace cuánto|desde cuándo|cuánto tiempo/i, "tiempo de evolución"],
  [/temperatura|fiebre[^?]*(tiene|medi)/i, "temperatura"],
]

/**
 * Clave de comparación de una pregunta.
 *
 * Si pide un dato conocido, la clave ES ese dato — así dos redacciones distintas del mismo pedido
 * colisionan. Si no, cae a una normalización del texto (sin tildes, signos ni muletillas), que al
 * menos caza la repetición literal.
 */
function claveDePregunta(p: string): string {
  for (const [re, dato] of DATO_PEDIDO) if (re.test(p)) return dato
  return p
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    // Con `\b`: sin él, "es" se comería letras dentro de "esto" y dos preguntas distintas
    // colisionarían.
    .replace(/\b(me|puedes|podrias|podes|decir|indicar|cual|cuales|es|el|la|los|las|de|del|un|una|por|favor|porfa|y|para)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Las preguntas de un texto, en orden. */
export function preguntasDe(texto: string): string[] {
  return (texto.match(/[^.!?\n]*\?/g) ?? []).map((s) => s.trim()).filter(Boolean)
}

/**
 * Preguntas repetidas dentro de una misma respuesta.
 *
 * El agente pedía el nombre del paciente al abrir Y al cerrar. Esto no reescribe la respuesta —
 * cuando termina de generarse ya se emitió por streaming— sino que **detecta** la repetición para
 * poder medirla y para que las pruebas cacen la regresión. La regla que la evita vive en el prompt.
 */
export function preguntasDuplicadas(texto: string): string[] {
  const vistas = new Map<string, string>()
  const repetidas: string[] = []
  for (const p of preguntasDe(texto)) {
    const k = claveDePregunta(p)
    if (!k) continue
    if (vistas.has(k)) repetidas.push(p)
    else vistas.set(k, p)
  }
  return repetidas
}

// --- Qué se persiste del turno --------------------------------------------------------------

export type TurnoAGuardar = { role: "user" | "assistant"; content: string }

/**
 * El turno NUEVO, y sólo ése.
 *
 * El cliente reenvía el hilo entero en cada petición (incluido el que se precargó de la base), así
 * que guardar `messages` completo duplicaría todo el historial en cada mensaje. Se guarda el último
 * mensaje del vet y la respuesta que se acaba de generar.
 */
/**
 * Marca que en ESE turno se propuso algo de verdad. Se persiste junto al texto.
 *
 * POR QUÉ. El historial guarda solo texto, así que al recargar el modelo veía decenas de turnos
 * suyos diciendo "te dejé propuesto el correo" SIN ninguna llamada a herramienta asociada — y
 * aprendía de su propio historial que la respuesta a "enviá un correo" ES esa frase. Empezó a
 * escribirla sin llamar la tool: el vet leía que había una propuesta y no existía ninguna.
 *
 * Con la marca, el historial muestra texto Y acción juntos. La UI la esconde al renderizar
 * (ver `sinMarcas` en el asistente): es contexto para el modelo, no contenido para el vet.
 */
export const MARCA_PROPUESTA = /\[\[propuesto:([a-z_,]+)\]\]/

/**
 * Borra cualquier marca `[[propuesto:…]]` del texto del modelo.
 *
 * LA MARCA LA PONE EL SERVIDOR, Y SÓLO EL SERVIDOR. Esta función existe porque el modelo también
 * las escribe: ve las de su propio historial y las imita, que es el mismo mecanismo de imitación
 * que la marca vino a resolver.
 *
 * NO ES COSMÉTICO. `sanearHistorial` trata la marca como PRUEBA de que el turno propuso algo
 * (`if (MARCA_PROPUESTA.test(texto)) return m` — lo deja pasar sin desactivar). Si el modelo puede
 * escribirla, puede fabricar esa prueba: escribe "te dejé el correo listo [[propuesto:send_email]]"
 * sin llamar ninguna tool, y el saneador lo certifica como propuesta real en vez de desactivarlo.
 * El control que existe para que no invente propuestas pasaría a avalarle las inventadas.
 *
 * El patrón es DELIBERADAMENTE tolerante (`[^\]]*` y no `[a-z_,]+`): lo que el modelo escribe no
 * respeta el formato. En producción se vio `[[propuesto:send_email, send_email]]` — con espacio y
 * repetida, dos cosas que `toolsQuePropusieron` no puede producir porque deduplica con `Set` y une
 * con `join(",")`. Un patrón estricto deja pasar justo las que no salieron de acá.
 */
export function sinMarcaDePropuesta(texto: string): string {
  return texto.replace(/\s*\[\[propuesto:[^\]]*\]\]/g, "").trimEnd()
}

/**
 * Valor de `needs_connection` con el que una tool de correo pide que el chat muestre la tarjeta de
 * conectar la cuenta.
 *
 * Es una constante y no el literal suelto porque ya se rompió una vez: decía "gmail" en los dos
 * lados, y al pasar a dos proveedores solo cambió uno. La comparación quedó en falso y la tarjeta
 * dejó de aparecer — sin error, sin nada: el vet pedía un correo y no pasaba nada.
 */
export const CONEXION_CORREO = "correo"

/** Nombres de las tools de ESCRITURA que dejaron una propuesta registrada en este turno. */
function toolsQuePropusieron(respuesta: UIMessage | undefined): string[] {
  const nombres: string[] = []
  for (const parte of respuesta?.parts ?? []) {
    const p = parte as { type?: string; output?: unknown }
    if (typeof p.type !== "string" || !p.type.startsWith("tool-")) continue
    const salida = p.output as { action_id?: unknown; status?: unknown } | undefined
    if (salida && typeof salida.action_id === "string" && salida.status === "proposed") {
      nombres.push(p.type.slice("tool-".length))
    }
  }
  return [...new Set(nombres)]
}

/**
 * Frases con las que Athos manda a aprobar algo. Si aparecen SIN `[[propuesto:…]]`, ese turno
 * afirma una acción que no se registró.
 */
const AFIRMA_PROPUESTA =
  /\b(te dej[ée]|dej[ée]|te propuse|propuse|dej[ao] propuest|qued[óo] propuest)\b|\baprob[áa]l[oa] en la tarjeta\b|\ben la tarjeta\b/i

/**
 * Desactiva las afirmaciones de propuesta que NO tienen su marca.
 *
 * PARA QUÉ. `MARCA_PROPUESTA` arregla los turnos NUEVOS, pero los que ya están guardados no la
 * llevan — al 2026-08-03 hay 16 así en producción. El modelo los sigue recibiendo al recargar un
 * hilo viejo, y son justamente los que le enseñaron el patrón: "decí que dejaste la propuesta, sin
 * llamar la tool". Arreglar el guardado no desarma lo ya guardado.
 *
 * Se hace al LEER y no reescribiendo `athos_messages` a propósito: esa tabla es historial clínico
 * y no se toca para arreglar un defecto nuestro. Además cubre cualquier fila vieja, incluidas las
 * de hilos que nadie abrió todavía.
 *
 * No borra el turno ni lo reescribe: le agrega una nota que el modelo lee como "acá NO hubo
 * acción". Así el ejemplo deja de ser imitable — que es todo lo que se necesita.
 */
export function sanearHistorial(mensajes: UIMessage[]): UIMessage[] {
  return mensajes.map((m) => {
    if (m.role !== "assistant") return m
    const texto = textoDe(m)
    if (!texto || MARCA_PROPUESTA.test(texto) || !AFIRMA_PROPUESTA.test(texto)) return m
    return {
      ...m,
      parts: [
        ...(m.parts ?? []),
        {
          type: "text",
          text: "\n\n[[sin-propuesta: este turno NO registró ninguna acción; no lo imites]]",
        },
      ],
    } as UIMessage
  })
}

export function turnoAGuardar(
  entrantes: UIMessage[],
  respuesta: UIMessage | undefined,
): TurnoAGuardar[] {
  const turnos: TurnoAGuardar[] = []
  const ultimoDelVet = [...entrantes].reverse().find((m) => m.role === "user")
  const preguntaTexto = ultimoDelVet ? textoDe(ultimoDelVet) : ""
  if (preguntaTexto) turnos.push({ role: "user", content: preguntaTexto })

  // Se limpia ANTES de anexar la de verdad: lo que llega acá es la salida fresca del modelo, así
  // que toda marca que traiga la escribió él. Ver `sinMarcaDePropuesta`.
  const respuestaTexto = respuesta ? sinMarcaDePropuesta(textoDe(respuesta)) : ""
  const propuestas = respuesta ? toolsQuePropusieron(respuesta) : []

  if (respuestaTexto) {
    const marca = propuestas.length ? `\n\n[[propuesto:${propuestas.join(",")}]]` : ""
    turnos.push({ role: "assistant", content: `${respuestaTexto}${marca}` })
    return turnos
  }

  // ── UN TURNO SIN TEXTO NO PUEDE DESAPARECER EN SILENCIO ────────────────────────────────────
  //
  // Antes, sin texto no se guardaba nada: el vet veía su pregunta y DEBAJO NADA. Ni respuesta ni
  // error — el hilo simplemente no crecía. Pasó el 27-ago con una remisión en Word: el turno topó
  // `maxOutputTokens` (2000 exactos, medido) y lo que quedó cortado fue una llamada a herramienta,
  // no texto, así que no había qué mostrar. El vet escribió «?» y perdió ese turno también.
  //
  // Al recargar era peor: como tampoco se persistía, la pregunta desaparecía y quedaba la sensación
  // de que el chat se come lo que uno escribe.
  //
  // Dos casos distintos y por eso dos mensajes:
  //
  //   · CON PROPUESTAS, no hay nada roto: el modelo propuso una acción y la tarjeta habla por sí
  //     sola. Se deja constancia para que el hilo tenga sentido al releerlo.
  //   · SIN PROPUESTAS es un turno que se perdió, y hay que DECIRLO. Un mensaje de una línea vale
  //     infinitamente más que el vacío: el vet sabe que puede reintentar en vez de quedarse
  //     mirando la pantalla preguntándose si mandó el mensaje.
  //
  // Se guarda como `assistant` a propósito: es lo que el hilo mostró en ese lugar, y así el
  // historial que se recarga coincide con lo que el vet vio.
  if (propuestas.length) {
    turnos.push({
      role: "assistant",
      content: `Te dejé una propuesta para aprobar.\n\n[[propuesto:${propuestas.join(",")}]]`,
    })
  } else if (respuesta) {
    turnos.push({
      role: "assistant",
      content:
        "Se me cortó la respuesta antes de terminarla. Volvé a preguntarme — si el mensaje traía " +
        "un documento largo, probá con una pregunta más específica sobre él.",
    })
  }
  return turnos
}

// ── Recorte del historial que viaja AL MODELO ────────────────────────────────────────────────────
//
// Medido en producción (2026-08-26, athos_agent_usage): el agente promediaba 22.000 tokens de
// entrada por turno con picos de 57.000 — el cliente reenvía el hilo ENTERO en cada petición,
// tool parts incluidos, y ese prefill se re-paga en CADA paso del loop de herramientas. Sumado a
// la velocidad de salida del proveedor, los turnos cruzaban el maxDuration de la ruta y Vercel
// mataba la función a mitad de stream: eso es el "Athos se quedó en blanco" reportado.
//
// El recorte es del CAMINO AL MODELO, no de la conversación: `turnoAGuardar` persiste sobre el
// hilo completo y el vet sigue viendo todo. Lo que el modelo pierde de contexto viejo lo cubren
// la memoria del paciente (patient_embeddings) y sus tools de historial.

/** Tope de mensajes del hilo que ve el modelo (los últimos). */
export const MAX_MENSAJES_AL_MODELO = 16

// Tope de PESO (chars del JSON de las parts, que es donde viven los resultados de tools). ~28k
// chars ≈ 8-9k tokens: suficiente para una conversación larga sin arrastrar el laboratorio de
// hace veinte turnos por cada paso del loop.
const MAX_CHARS_AL_MODELO = 28000

export function recortarHistorial(mensajes: UIMessage[]): UIMessage[] {
  let recorte = mensajes.slice(-MAX_MENSAJES_AL_MODELO)
  const peso = (m: UIMessage) => JSON.stringify(m.parts ?? []).length
  let total = recorte.reduce((s, m) => s + peso(m), 0)
  // Se sueltan mensajes ENTEROS desde el principio (nunca parts sueltas: partir un mensaje deja
  // tool-calls huérfanos de su resultado y hay proveedores que lo rechazan).
  while (recorte.length > 4 && total > MAX_CHARS_AL_MODELO) {
    total -= peso(recorte[0])
    recorte = recorte.slice(1)
  }
  // Algunos proveedores exigen que el primer mensaje no-system sea del usuario.
  while (recorte.length && recorte[0].role !== "user") recorte = recorte.slice(1)
  // Nunca vacío: sin historial no hay pregunta que responder.
  return recorte.length ? recorte : mensajes.slice(-1)
}
