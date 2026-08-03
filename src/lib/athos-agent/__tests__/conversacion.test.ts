// Las piezas puras del turno del agente. Cubren los cuatro defectos reportados el 2026-07-31.
import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import {
  densidadClinica,
  esConsultaClinica,
  MINIMO_PARA_DESARROLLAR,
  preguntasDe,
  preguntasDuplicadas,
  textoDe,
  turnoAGuardar,
} from "@/lib/athos-agent/conversacion"

const msg = (role: "user" | "assistant", ...textos: string[]): UIMessage =>
  ({ id: `${role}-${textos[0]?.slice(0, 6)}`, role,
     parts: textos.map((text) => ({ type: "text", text })) }) as UIMessage

describe("textoDe", () => {
  it("junta las partes de texto", () => {
    expect(textoDe(msg("user", "hola ", "doctor"))).toBe("hola doctor")
  })
  it("ignora las partes que no son texto", () => {
    const m = { id: "x", role: "assistant",
                parts: [{ type: "tool-search_patients" }, { type: "text", text: "listo" }] } as unknown as UIMessage
    expect(textoDe(m)).toBe("listo")
  })
  it("un mensaje sin partes no revienta", () => {
    expect(textoDe({ id: "x", role: "user" } as UIMessage)).toBe("")
  })
})

describe("densidadClinica — la respuesta debe ser proporcional al input", () => {
  it("un input pobre se marca como escaso", () => {
    // Esto es lo que disparaba diferenciales completos: dos datos y media página de respuesta.
    const d = densidadClinica("un perro que vomita")
    expect(d.nivel).toBe("escaso")
    expect(d.datos).toBeLessThan(MINIMO_PARA_DESARROLLAR)
  })

  it("un input con anamnesis real se marca como suficiente", () => {
    const d = densidadClinica(
      "perro macho de 4 años, 12 kg, vomita hace tres días, mucosas pálidas, ya lo desparasité",
    )
    expect(d.nivel).toBe("suficiente")
    expect(d.datos).toBeGreaterThanOrEqual(MINIMO_PARA_DESARROLLAR)
  })

  it("nombra qué señales encontró, para poder explicar la decisión", () => {
    const d = densidadClinica("gata de 3 años con fiebre")
    expect(d.señales).toContain("especie")
    expect(d.señales).toContain("signo clínico")
  })

  it("un texto vacío no tiene densidad", () => {
    expect(densidadClinica("").datos).toBe(0)
    expect(densidadClinica("   ").nivel).toBe("escaso")
  })

  it("cuenta una señal por categoría, no por repetición", () => {
    // "vomita, vomita y vomita" es un dato, no tres.
    expect(densidadClinica("vomita, vomita y vomita").datos).toBe(1)
  })
})

describe("esConsultaClinica — la proporcionalidad NO aplica a lo operativo", () => {
  it.each([
    "¿qué tengo mañana?",
    "mándale un WhatsApp a la dueña de Lola",
    "¿cuál fue la última pregunta que te hice?",
    "muéstrame la agenda de hoy",
  ])("%s no es consulta clínica", (t) => {
    // Pedirle más datos clínicos a esto sería absurdo.
    expect(esConsultaClinica(t)).toBe(false)
  })

  it("un cuadro clínico sí lo es", () => {
    expect(esConsultaClinica("perro con vómito hace dos días")).toBe(true)
  })
})

describe("preguntasDuplicadas — la misma pregunta al abrir y al cerrar", () => {
  it("caza la repetición aunque cambie la redacción", () => {
    const texto =
      "¿Cómo se llama el paciente? Con esos datos podría ser gastroenteritis. " +
      "Para dejarlo en la ficha, ¿me puedes decir cuál es el nombre del paciente?"
    expect(preguntasDuplicadas(texto)).toHaveLength(1)
  })

  it("no marca preguntas distintas", () => {
    const texto = "¿Cómo se llama el paciente? ¿Qué edad tiene? ¿Hace cuánto vomita?"
    expect(preguntasDuplicadas(texto)).toHaveLength(0)
  })

  it("un texto sin preguntas no tiene duplicados", () => {
    expect(preguntasDuplicadas("Le dejé propuesta la cita del martes.")).toEqual([])
  })

  it("preguntasDe respeta el orden", () => {
    expect(preguntasDe("Primero ¿A? luego ¿B?")).toHaveLength(2)
  })
})

describe("turnoAGuardar — sólo el turno nuevo", () => {
  const historial = [
    msg("user", "hola"),
    msg("assistant", "decime"),
    msg("user", "¿qué tengo mañana?"),
  ]

  it("guarda la última pregunta del vet y la respuesta", () => {
    const t = turnoAGuardar(historial, msg("assistant", "Tenés 3 citas."))
    expect(t).toEqual([
      { role: "user", content: "¿qué tengo mañana?" },
      { role: "assistant", content: "Tenés 3 citas." },
    ])
  })

  // El defecto que motiva la marca: como el historial guarda solo TEXTO, el modelo veía turnos
  // suyos diciendo "te dejé propuesto el correo" sin ninguna llamada asociada, y aprendió a
  // escribir la frase SIN llamar la tool. El vet buscaba una tarjeta que no existía.
  it("marca el turno cuando de verdad se propuso algo", () => {
    const conPropuesta = {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "Te dejé el correo listo." },
        { type: "tool-send_email", output: { action_id: "act-1", status: "proposed" } },
      ],
    } as unknown as UIMessage
    const t = turnoAGuardar(historial, conPropuesta)
    expect(t[1].content).toContain("[[propuesto:send_email]]")
  })

  it("NO marca cuando el texto lo dice pero la tool no propuso", () => {
    // Exactamente la alucinación: dice que propuso y no hay action_id.
    const sinPropuesta = {
      id: "a2",
      role: "assistant",
      parts: [
        { type: "text", text: "Te dejé propuesto el correo — aprobalo en la tarjeta." },
        { type: "tool-send_email", output: { error: "no conectado" } },
      ],
    } as unknown as UIMessage
    const t = turnoAGuardar(historial, sinPropuesta)
    expect(t[1].content).not.toContain("[[propuesto:")
  })

  it("NO reenvía el historial entero", () => {
    // El cliente manda el hilo completo en cada petición: guardarlo todo duplicaría la
    // conversación entera en cada mensaje.
    const t = turnoAGuardar(historial, msg("assistant", "ok"))
    expect(t.some((x) => x.content === "hola")).toBe(false)
    expect(t).toHaveLength(2)
  })

  it("sin respuesta guarda al menos la pregunta", () => {
    expect(turnoAGuardar(historial, undefined)).toEqual([
      { role: "user", content: "¿qué tengo mañana?" },
    ])
  })

  it("una respuesta vacía (sólo tools) no se guarda", () => {
    const soloTools = { id: "a", role: "assistant",
                        parts: [{ type: "tool-search_patients" }] } as unknown as UIMessage
    expect(turnoAGuardar(historial, soloTools)).toHaveLength(1)
  })

  it("sin mensajes del vet no guarda nada del vet", () => {
    expect(turnoAGuardar([msg("assistant", "hola")], undefined)).toEqual([])
  })
})
