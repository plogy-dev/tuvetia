/**
 * Banco de calidad del agente Athos — mide los 5 defectos reportados el 2026-07-31.
 *
 * NO corre en CI: gasta llamadas reales al modelo de producción. Se ejecuta a mano cuando hay que
 * declarar un número con evidencia:
 *
 *   RUN_BANCO=1 ANTHROPIC_API_KEY=... npx vitest run --config vitest.e2e.config.mts e2e/banco-agente.e2e.ts
 *
 * Todas las métricas son DETERMINÍSTICAS —contar preguntas, medir longitud, detectar marcadores— y
 * no interviene ningún juez LLM: en este proyecto ya está medido que el juez absoluto tiene ±7/40 de
 * ruido y 78% de sesgo de posición, así que lo que se puede contar, se cuenta.
 *
 * Usa el MISMO system prompt y el MISMO modelo que `/api/athos/agent`. Lo que no reproduce es el
 * bucle de tools: para el bloque de literatura se le inyecta un resultado de tool fabricado, que es
 * justo lo que permite forzar `evidence_level: limited` sin depender de qué traiga el corpus hoy.
 *
 * El informe se escribe a DISCO (`docs/BANCO-AGENTE-RESULTADO.md`), no a consola: vitest intercepta
 * console.log y el resultado se perdía.
 */
import { writeFileSync } from "node:fs"

import { afterAll, describe, expect, it } from "vitest"
import { generateText, stepCountIs, tool, type ModelMessage } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import { z } from "zod"

import {
  densidadClinica,
  esConsultaClinica,
  preguntasDe,
  preguntasDuplicadas,
} from "../src/lib/athos-agent/conversacion"
import { ATHOS_AGENT_SYSTEM_PROMPT } from "../src/lib/athos-agent/system-prompt"

const ACTIVO = process.env.RUN_BANCO === "1" && Boolean(process.env.ANTHROPIC_API_KEY)
const MODELO = process.env.ATHOS_AGENT_MODEL ?? "claude-sonnet-5"
const INFORME = "docs/BANCO-AGENTE-RESULTADO.md"

// --- casos ---------------------------------------------------------------------------------

/** Input pobre: 0-2 señales clínicas. Lo correcto es PREGUNTAR, no desarrollar. */
const POBRES = [
  "un perro que vomita",
  "tengo un gato que no come",
  "vino un perro cojeando",
  "una gata con diarrea",
  "perro decaído",
  "me llegó un conejo raro",
]

/** Input rico: anamnesis real. Acá sí corresponde desarrollar. */
const RICOS = [
  "Perro macho castrado de 6 años, 22 kg, vomita hace 3 días, no come, mucosas pálidas, abdomen tenso a la palpación. Ya está desparasitado y vacunado.",
  "Gata hembra de 12 años, 3.8 kg, poliuria y polidipsia hace dos semanas, bajó de peso, deshidratación 5%, temperatura 38.9.",
  "Perro de 4 años, 15 kg, prurito intenso hace un mes, lesiones en pliegues, ya recibió corticoides sin mejoría.",
  "Cachorro de 3 meses, 4 kg, diarrea sanguinolenta hace 2 días, vómito, sin vacunas, letárgico.",
]

/** Operativo: pedir datos clínicos acá sería absurdo. */
const OPERATIVOS = [
  "¿qué tengo mañana?",
  "muéstrame la agenda de hoy",
  "¿cuáles son los horarios de la clínica?",
  "búscame el titular con teléfono 3001234567",
]

/** Literatura que NO aporta: debe descartarse en una frase, no en un párrafo. */
const LITERATURA_TANGENCIAL = [
  { pregunta: "¿Qué dice la evidencia sobre osificación heterotópica en la pata trasera de un perro?", nivel: "limited" },
  { pregunta: "¿Hay evidencia sobre el manejo de ganglioglioma en caninos?", nivel: "none" },
]

// --- métricas determinísticas --------------------------------------------------------------

/** Marcadores de que el modelo DESARROLLÓ (diferenciales, protocolo, dosis). */
const DESARROLLA =
  /(diferencial|descartar|podría (ser|tratarse)|protocolo|mg\/kg|dosis de|plan diagnóstico|sospech)/i

/** El modelo narrando su propio proceso — metadata que no debe salir al vet. */
const NARRA_PROCESO =
  /(consult[éeó]\s+(la|el)\s+(literatura|base|evidencia)|voy a buscar|según mi búsqueda|revis[ée] la literatura|hice una búsqueda|busqué en)/i

/** Pide datos clínicos que en una consulta operativa no vienen al caso. */
const PIDE_DATOS_CLINICOS = /(qué especie|cuántos años|qué edad|cuánto pesa|cuántos kilos|es perro o gato)/i

type Medicion = {
  caso: string
  chars: number
  preguntas: number
  desarrolla: boolean
  narra: boolean
  duplicadas: number
  texto: string
}

/** Respuestas completas, para que cualquiera pueda juzgar por su cuenta si la métrica acertó. */
const respuestas: Medicion[] = []

// Tools de mentira con datos fijos.
//
// Sin ellas el modelo intenta llamar una tool que no existe y ESCUPE EL JSON COMO TEXTO
// (`{"date":"2026-08-01"}`), que es lo que se vio en la primera corrida. Eso no pasa en producción
// —ahí las tools están declaradas— y contaminaba tanto la longitud como los marcadores.
//
// Devuelven datos fijos a propósito: lo que se mide es la FORMA de la respuesta, no si el dato es
// correcto. Que sean estables hace la corrida reproducible.
const TOOLS_FALSAS = {
  list_appointments_on_day: tool({
    description: "Citas de un día",
    inputSchema: z.object({ date: z.string() }),
    execute: async () => [
      { hora: "09:00", paciente: "Rocco", motivo: "control" },
      { hora: "11:30", paciente: "Michi", motivo: "vacunación" },
    ],
  }),
  get_clinic_hours: tool({
    description: "Horarios de la clínica",
    inputSchema: z.object({}),
    execute: async () => ({ lunes_viernes: "08:00-18:00", sabado: "09:00-13:00" }),
  }),
  get_owner_by_phone: tool({
    description: "Titular por teléfono",
    inputSchema: z.object({ phone: z.string() }),
    execute: async () => ({ nombre: "Ana Gómez", pacientes: ["Lola"] }),
  }),
  search_clinical_evidence: tool({
    description: "Evidencia clínica de la literatura veterinaria",
    inputSchema: z.object({ question: z.string(), species: z.string().optional() }),
    execute: async () => ({
      passed: true,
      evidence_level: "limited",
      chunks: [{ source: "PubMed", excerpt: "Elbow dysplasia in growing dogs: radiographic findings." }],
    }),
  }),
}

async function medir(pregunta: string, extra: ModelMessage[] = []): Promise<Medicion> {
  const densidad = densidadClinica(pregunta)
  const aviso =
    esConsultaClinica(pregunta) && densidad.nivel === "escaso"
      ? [
          "",
          `- El vet dio POCOS datos clínicos (${densidad.datos}: ${densidad.señales.join(", ") || "ninguno"}).`,
          "  NO desarrolles diferenciales, protocolos ni dosis: haz 2-3 preguntas de clarificación y nada más.",
        ].join("\n")
      : ""

  const { text } = await generateText({
    model: anthropic(MODELO),
    system: [
      ATHOS_AGENT_SYSTEM_PROMPT,
      "",
      "# Contexto runtime",
      "",
      "- Fecha de hoy: 2026-07-31 (hora de Colombia, UTC-5).",
      aviso,
    ].join("\n"),
    messages: [{ role: "user", content: pregunta }, ...extra],
    maxOutputTokens: 1200,
    tools: TOOLS_FALSAS,
    stopWhen: stepCountIs(4),
  })

  const m = {
    caso: pregunta.slice(0, 46),
    chars: text.length,
    preguntas: preguntasDe(text).length,
    desarrolla: DESARROLLA.test(text),
    narra: NARRA_PROCESO.test(text),
    duplicadas: preguntasDuplicadas(text).length,
    texto: text,
  }
  respuestas.push(m)
  return m
}

// --- informe -------------------------------------------------------------------------------

const lineas: string[] = []
const log = (s = "") => lineas.push(s)

function tabla(titulo: string, ms: Medicion[]) {
  log("")
  log(`## ${titulo}`)
  log("")
  log("| chars | preguntas | ¿desarrolla? | ¿narra proceso? | duplicadas | caso |")
  log("|---|---|---|---|---|---|")
  for (const m of ms) {
    const dev = m.desarrolla ? "sí" : "no"
    const nar = m.narra ? "**SÍ**" : "no"
    log(`| ${m.chars} | ${m.preguntas} | ${dev} | ${nar} | ${m.duplicadas} | ${m.caso} |`)
  }
  log("")
}

function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

// --- corrida -------------------------------------------------------------------------------

describe.skipIf(!ACTIVO)("banco de calidad del agente (modelo de producción)", () => {
  const todas: Medicion[] = []

  it("P1 · input pobre → pregunta, no desarrolla", async () => {
    const ms = await Promise.all(POBRES.map((c) => medir(c)))
    todas.push(...ms)
    tabla("P1 · Input POBRE — debe preguntar, no desarrollar", ms)
    const desarrollan = ms.filter((m) => m.desarrolla).length
    const preguntan = ms.filter((m) => m.preguntas >= 1).length
    log(`- **pregunta:** ${preguntan}/${ms.length}`)
    log(`- **desarrolla de más:** ${desarrollan}/${ms.length}`)
    log(`- **longitud mediana:** ${mediana(ms.map((m) => m.chars))} chars`)

    expect(preguntan, "con input pobre debe pedir datos").toBe(ms.length)
    expect(desarrollan, "con input pobre NO debe desarrollar").toBeLessThanOrEqual(1)
  }, 240_000)

  it("P1 · input rico → desarrolla", async () => {
    const ms = await Promise.all(RICOS.map((c) => medir(c)))
    todas.push(...ms)
    tabla("P1 · Input RICO — acá sí debe desarrollar", ms)
    const desarrollan = ms.filter((m) => m.desarrolla).length
    log(`- **desarrolla:** ${desarrollan}/${ms.length}`)
    log(`- **longitud mediana:** ${mediana(ms.map((m) => m.chars))} chars`)
    // Si con anamnesis completa tampoco desarrolla, el arreglo se pasó de frenada.
    expect(desarrollan).toBeGreaterThanOrEqual(ms.length - 1)
  }, 240_000)

  it("P1 · operativo → no pide anamnesis", async () => {
    const ms = await Promise.all(OPERATIVOS.map((c) => medir(c)))
    todas.push(...ms)
    tabla("P1 · Operativo — no debe pedir datos clínicos", ms)
    const piden = ms.filter((m) => PIDE_DATOS_CLINICOS.test(m.texto)).length
    log(`- **pide datos clínicos indebidamente:** ${piden}/${ms.length}`)
    expect(piden).toBe(0)
  }, 240_000)

  it("P5 · literatura tangencial → una frase, no un párrafo", async () => {
    const ms: Medicion[] = []
    for (const { pregunta, nivel } of LITERATURA_TANGENCIAL) {
      const extra: ModelMessage[] = [
        {
          role: "assistant",
          content: [
            "[resultado de search_clinical_evidence]",
            `evidence_level: ${nivel}`,
            "passed: true",
            'extractos: ["Elbow dysplasia in growing dogs: radiographic findings", "Canine hip dysplasia screening protocols", "Osteoarthritis management in senior dogs"]',
          ].join("\n"),
        },
        { role: "user", content: "Respondeme con eso." },
      ]
      ms.push(await medir(pregunta, extra))
    }
    todas.push(...ms)
    tabla("P5 · Literatura tangencial — debe descartar en una frase", ms)
    log(`- **longitud mediana:** ${mediana(ms.map((m) => m.chars))} chars`)
    // Una frase de descarte no pasa de ~350 chars; un párrafo desarrollado se va muy por encima.
    for (const m of ms) expect(m.chars, `demasiado largo: ${m.caso}`).toBeLessThan(700)
  }, 240_000)

  it("P2 y P3 · ni narra su proceso ni repite preguntas", () => {
    const narran = todas.filter((m) => m.narra)
    const conDup = todas.filter((m) => m.duplicadas > 0)
    log("")
    log(`## Resumen sobre ${todas.length} respuestas`)
    log("")
    log(`- **P2 · narra su proceso interno:** ${narran.length}/${todas.length}`)
    log(`- **P3 · repite una pregunta:** ${conDup.length}/${todas.length}`)
    for (const m of narran) log(`  - NARRA — ${m.caso}`)
    for (const m of conDup) log(`  - REPITE — ${m.caso}`)

    expect(narran.length).toBe(0)
    expect(conDup.length).toBe(0)
  })
})

afterAll(() => {
  if (!ACTIVO) return
  const total = POBRES.length + RICOS.length + OPERATIVOS.length + LITERATURA_TANGENCIAL.length
  const cabecera = [
    "# Banco de calidad del agente — resultado",
    "",
    `**Modelo:** \`${MODELO}\` · **Casos:** ${total} · **Corte:** 2026-07-31`,
    "",
    "Generado por `e2e/banco-agente.e2e.ts`. Todas las métricas son determinísticas —contar",
    "preguntas, medir longitud, detectar marcadores—: no interviene ningún juez LLM.",
    "",
    "> El banco declara **tools de mentira con datos fijos** (agenda, horarios, titular, evidencia).",
    "> (\"¿qué tengo mañana?\") salen cortas o vacías: en producción el modelo llamaría a una tool y",
    "> Los datos son fijos a propósito: se mide la FORMA de la respuesta, no si el dato es correcto.",
  ]

  // Anexo con el texto íntegro: una métrica sin el material que la produjo no se puede auditar.
  const anexo = ["", "---", "", "## Anexo — respuestas completas", ""]
  for (const m of respuestas) {
    anexo.push(`### ${m.caso}`, "", "```", m.texto || "(respuesta vacía)", "```", "")
  }

  writeFileSync(INFORME, [...cabecera, ...lineas, ...anexo].join("\n") + "\n", "utf-8")
})
