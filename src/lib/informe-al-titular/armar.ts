// El informe que se lleva el dueño: la consulta contada en su idioma.
//
// QUÉ ES. En el prototipo de Luciano se llama `client_reports`, y es lo que el 18-ago se pidió
// replicar: *"reporte en PDF como en el repo"*. La nota SOAP está escrita para otro veterinario
// —"paciente presenta hiporexia de 48h, se instaura fluidoterapia"— y el que se lleva al animal a
// la casa no la entiende. Este informe dice lo mismo en castellano: qué tiene, qué hay que hacer, y
// con qué señales volver corriendo.
//
// ── LO QUE HACE EL MODELO ACÁ, Y LO QUE NO ──────────────────────────────────────────────────────
//
// **Sólo TRADUCE.** Todo lo clínico ya está decidido y aprobado en la nota; el modelo la reescribe
// para otro lector. No diagnostica, no agrega tratamiento, no consulta nada.
//
// Esa frontera es la que hace que este informe sea seguro de entregar: lo que sale al mundo es
// contenido que un veterinario ya aprobó, con otras palabras. Si el modelo pudiera AGREGAR, el
// documento que se lleva el dueño tendría material que nadie revisó — y a diferencia de la nota,
// éste no se queda adentro.
//
// ── LAS TRES GUARDAS ────────────────────────────────────────────────────────────────────────────
//
//   1. **La nota tiene que estar APROBADA** (regla 5). Un informe derivado de un borrador se
//      saltearía la aprobación por la puerta que da a la calle. Lo impone también un trigger en la
//      0071 — la UI deshabilitando el botón es una cortesía, no una garantía.
//   2. **Tiene que haber qué contar.** Sin `assessment` ni `plan` no hay informe posible, y llamar
//      al modelo para que redacte la nada cuesta lo mismo que uno útil.
//   3. **Gasta cupo** como cualquier llamada de la clínica. No hay IA gratis.
//
// PURO Y SIN RED: `vitest.config.mts` corre en `environment: "node"` sobre `src/**/*.test.ts`.

export type NotaAprobada = {
  status: string
  subjective?: string | null
  objective?: string | null
  assessment?: string | null
  plan?: string | null
}

export type InsumosDelInforme = {
  nota: NotaAprobada
  paciente: { nombre: string; especie?: string | null }
  titular: { nombre?: string | null }
  clinica?: string | null
  veterinario?: string | null
  /** Fecha de la consulta, ya en texto legible. */
  fecha?: string | null
}

/** Las secciones del informe, tal como se guardan y se imprimen. */
export type Informe = {
  subject: string
  salutation: string
  body: string
  plan: string
  warnings: string
  signature: string
}

/**
 * ¿Se puede entregar un informe de esta consulta?
 *
 * SE DEVUELVE EL MOTIVO Y NO UN BOOLEANO, porque los dos noes son distintos y la pantalla tiene que
 * decir cuál: "aprobá la nota primero" es accionable, "esta consulta no tiene qué informar" no.
 * Un botón gris sin explicación es la forma más rápida de que alguien crea que el sistema falla.
 */
export function sePuedeInformar(nota: NotaAprobada | null | undefined):
  | { puede: true }
  | { puede: false; motivo: "sin-nota" | "nota-sin-aprobar" | "nota-vacia" } {
  if (!nota) return { puede: false, motivo: "sin-nota" }
  if (nota.status !== "approved") return { puede: false, motivo: "nota-sin-aprobar" }
  const hayContenido = [nota.assessment, nota.plan].some((s) => (s ?? "").trim().length > 0)
  if (!hayContenido) return { puede: false, motivo: "nota-vacia" }
  return { puede: true }
}

export const MOTIVOS: Record<"sin-nota" | "nota-sin-aprobar" | "nota-vacia", string> = {
  "sin-nota": "Esta consulta todavía no tiene nota.",
  "nota-sin-aprobar": "Aprobá la nota antes de entregarle el informe al titular.",
  "nota-vacia": "La nota no tiene análisis ni plan: no hay nada que informar todavía.",
}

/**
 * El pedido que se le manda al modelo.
 *
 * TODO VA EN EL PEDIDO: no tiene herramientas y no consulta nada. Igual que el briefing, y por la
 * misma razón — un informe que saliera a buscar datos podría contradecir a la nota que el vet
 * aprobó, y lo que se lleva el dueño tiene que ser lo aprobado.
 */
export function pedidoDelInforme(i: InsumosDelInforme): string {
  const { nota, paciente, titular } = i
  const trato = titular.nombre?.trim() || null

  return [
    `Sos Athos, el asistente de ${i.clinica ?? "la clínica veterinaria"}.`,
    "",
    "TAREA: reescribir la nota clínica de abajo como un informe para el DUEÑO del animal.",
    "El dueño no es veterinario. Escribí como le hablarías a un vecino: claro, cálido y concreto.",
    "",
    "REGLAS, y son estrictas:",
    "- NO agregues diagnósticos, medicamentos, dosis ni indicaciones que no estén en la nota.",
    "  Si algo no está escrito abajo, no existe. Traducís, no completás.",
    "- NO uses jerga. Nada de 'hiporexia', 'fluidoterapia', 'compatible con'. Decilo en castellano.",
    "- NO prometas resultados ni des pronósticos que la nota no dé.",
    "- Usá 'vos'/'tu' de forma consistente, en español de Colombia.",
    "",
    "FORMATO: devolvé EXACTAMENTE estas secciones, cada una con su etiqueta en una línea sola:",
    "ASUNTO:",
    "SALUDO:",
    "CUERPO:",
    "PLAN:",
    "ALERTAS:",
    "",
    "- ASUNTO: una línea, como el asunto de un correo. Nombrá al animal.",
    `- SALUDO: una línea. ${trato ? `El titular se llama ${trato}.` : "El titular no tiene nombre registrado: usá un saludo genérico."}`,
    "- CUERPO: 2 a 4 párrafos cortos. Qué se vio y qué significa, sin tecnicismos.",
    "- PLAN: qué tiene que hacer en casa, en viñetas que empiecen con '- '. Sólo lo que está en la nota.",
    "- ALERTAS: con qué señales volver de urgencia, en viñetas que empiecen con '- '.",
    "  Si la nota no menciona ninguna, escribí una línea general de 'ante cualquier empeoramiento'.",
    "",
    `PACIENTE: ${paciente.nombre}${paciente.especie ? ` (${paciente.especie})` : ""}`,
    i.fecha ? `FECHA DE LA CONSULTA: ${i.fecha}` : "",
    "",
    "NOTA CLÍNICA APROBADA:",
    seccion("Motivo y relato", nota.subjective),
    seccion("Hallazgos", nota.objective),
    seccion("Análisis", nota.assessment),
    seccion("Plan", nota.plan),
  ]
    .filter(Boolean)
    .join("\n")
}

function seccion(titulo: string, texto: string | null | undefined): string {
  const t = (texto ?? "").trim()
  return t ? `\n${titulo}:\n${t}` : ""
}

/**
 * Parte la respuesta del modelo en secciones.
 *
 * TOLERANTE CON LAS ETIQUETAS Y ESTRICTO CON LO QUE FALTA. El modelo a veces devuelve `**ASUNTO:**`
 * o `Asunto:`; eso se acepta. Lo que NO se inventa es contenido: si no vino `CUERPO`, el informe
 * queda con el cuerpo vacío y la pantalla lo muestra vacío para que el vet lo escriba. Rellenarlo
 * con un texto por defecto sería poner palabras que nadie escribió en un papel que se lleva el
 * dueño.
 */
export function limpiarInforme(crudo: string, firma: string): Informe {
  const texto = (crudo ?? "").replace(/\r\n/g, "\n")
  return {
    subject: tomar(texto, "ASUNTO"),
    salutation: tomar(texto, "SALUDO"),
    body: tomar(texto, "CUERPO"),
    plan: tomar(texto, "PLAN"),
    warnings: tomar(texto, "ALERTAS"),
    signature: firma,
  }
}

const ETIQUETAS = ["ASUNTO", "SALUDO", "CUERPO", "PLAN", "ALERTAS"]

function tomar(texto: string, etiqueta: string): string {
  // `[*_#\s]*` al principio: el modelo decora las etiquetas con markdown más seguido de lo que
  // promete. Y el corte es contra CUALQUIER otra etiqueta, no contra la siguiente en orden — si
  // devuelve las secciones desordenadas, cada una igual termina donde empieza la que le sigue.
  const otras = ETIQUETAS.filter((e) => e !== etiqueta).join("|")
  // `$(?![\s\S])` Y NO `$` A SECAS. Con la bandera `m`, `$` es fin de LÍNEA, así que el cuerpo se
  // cortaba en el primer párrafo y el segundo se perdía — y un informe de dos párrafos es el caso
  // normal, no el raro. `$(?![\s\S])` es fin de texto de verdad, aunque el modo multilínea esté
  // puesto (y tiene que estarlo, porque las etiquetas se anclan a principio de línea).
  const re = new RegExp(
    `^[*_#\\s]*${etiqueta}\\s*:?[*_]*[ \\t]*\\n?([\\s\\S]*?)(?=^[*_#\\s]*(?:${otras})\\s*:|$(?![\\s\\S]))`,
    "im",
  )
  const m = texto.match(re)
  return (m?.[1] ?? "").trim().replace(/^\*+|\*+$/g, "").trim()
}

/**
 * El informe como texto plano, para el portapapeles.
 *
 * ES LA MISMA PIEZA QUE EL PDF, COMPUESTA DISTINTO. Por eso el informe se guarda en secciones y no
 * como un bloque: partir un texto en secciones después es adivinar, y componerlo de dos formas a
 * partir de las secciones es trivial.
 */
export function comoTextoPlano(i: Informe): string {
  return [i.salutation, "", i.body, bloque("Qué hacer en casa", i.plan), bloque("Cuándo volver de urgencia", i.warnings), "", i.signature]
    .filter((p) => p !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function bloque(titulo: string, cuerpo: string): string {
  const c = (cuerpo ?? "").trim()
  return c ? `\n${titulo}:\n${c}\n` : ""
}

/** La firma por defecto: quién lo entrega y de dónde. El vet la puede editar antes de enviar. */
export function firmaPorDefecto(veterinario?: string | null, clinica?: string | null): string {
  return [veterinario?.trim(), clinica?.trim()].filter(Boolean).join(" · ")
}
