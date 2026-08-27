// Las piezas puras del turno del agente. Cubren los cuatro defectos reportados el 2026-07-31.
import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import {
  densidadClinica,
  esConsultaClinica,
  MAX_MENSAJES_AL_MODELO,
  MINIMO_PARA_DESARROLLAR,
  preguntasDe,
  preguntasDuplicadas,
  recortarHistorial,
  textoDe,
  turnoAGuardar,
  sanearHistorial,
  sinMarcaDePropuesta,
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

  // ── La marca falsificada ────────────────────────────────────────────────────────────────────
  //
  // Visto en producción el 2026-08-16, a la vista del vet: `[[propuesto:send_email, send_email]]`.
  // Esa marca NO salió del servidor y hay dos pruebas independientes de eso: `toolsQuePropusieron`
  // deduplica con `Set` (nunca repite un nombre) y une con `join(",")` (nunca mete un espacio).
  // La escribió el modelo, imitando las que ve en su propio historial.
  //
  // Lo que la vuelve grave no es que se vea: es que `sanearHistorial` LEE la marca como prueba de
  // que el turno propuso algo de verdad. Sin limpiarla, el modelo fabrica su propia coartada.
  it("descarta la marca que escribió el modelo, aunque venga bien formada", () => {
    const falsificada = {
      id: "a3",
      role: "assistant",
      parts: [
        { type: "text", text: "Te dejé el correo listo.\n\n[[propuesto:send_email]]" },
        // Ni una sola tool: no hay nada propuesto detrás de esa marca.
      ],
    } as unknown as UIMessage
    const t = turnoAGuardar(historial, falsificada)
    expect(t[1].content).not.toContain("[[propuesto:")
    expect(t[1].content).toBe("Te dejé el correo listo.")
  })

  it("la falsificada no sobrevive para que el saneador la desactive después", () => {
    const falsificada = {
      id: "a4",
      role: "assistant",
      parts: [{ type: "text", text: "Te dejé propuesto el correo — aprobalo en la tarjeta.\n\n[[propuesto:send_email]]" }],
    } as unknown as UIMessage

    // Lo que se guarda hoy, con el arreglo puesto.
    const guardado = turnoAGuardar(historial, falsificada)[1].content

    // Y al releerlo, el saneador SÍ lo desactiva — que es lo que la marca falsa impedía.
    const releido = sanearHistorial([msg("assistant", guardado)])
    expect(textoDe(releido[0])).toContain("[[sin-propuesta:")
  })

  // El caso real, con el formato exacto que se vio en pantalla.
  it("una marca del modelo NO le roba la suya al turno que sí propuso", () => {
    const mixta = {
      id: "a5",
      role: "assistant",
      parts: [
        { type: "text", text: "Listo.\n\n[[propuesto:send_email, send_email]]" },
        { type: "tool-send_email", output: { action_id: "act-9", status: "proposed" } },
      ],
    } as unknown as UIMessage
    const t = turnoAGuardar(historial, mixta)
    // Queda UNA marca, y es la del servidor: sin espacio y sin repetir.
    expect(t[1].content).toBe("Listo.\n\n[[propuesto:send_email]]")
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

  // ── ESTE TEST VIGILABA LO CONTRARIO, Y ESE COMPORTAMIENTO CAUSÓ UN FALLO REAL ──────────────
  //
  // Decía «una respuesta vacía (sólo tools) no se guarda». Sonaba prudente y dejaba al vet mirando
  // una pantalla en blanco: pasó el 27-ago con una remisión en Word. El turno topó
  // `maxOutputTokens` (2000 exactos, medido en `athos_agent_usage`) y lo que quedó cortado fue una
  // llamada a herramienta, no texto — así que no había nada que guardar ni que mostrar. Ni
  // respuesta, ni error, ni rastro al recargar: la pregunta desaparecía.
  //
  // Un mensaje de una línea vale infinitamente más que el vacío: el vet sabe que puede reintentar
  // en vez de dudar de si mandó el mensaje.

  it("un turno cortado deja constancia en vez de desaparecer", () => {
    const soloTools = { id: "a", role: "assistant",
                        parts: [{ type: "tool-search_patients" }] } as unknown as UIMessage
    const turnos = turnoAGuardar(historial, soloTools)
    expect(turnos).toHaveLength(2)
    expect(turnos[1].role).toBe("assistant")
    // Dice qué pasó y qué hacer. No es un error técnico en la cara del veterinario.
    expect(turnos[1].content).toContain("cortó")
    expect(turnos[1].content).toContain("Volvé a preguntarme")
  })

  it("y si lo que hubo fue una propuesta, lo dice sin hablar de un corte", () => {
    // Acá NO hay nada roto: el modelo propuso una acción y la tarjeta habla por sí sola. Decirle
    // «se me cortó» sería mentirle y hacerle desconfiar de una propuesta que está bien.
    const propone = {
      id: "a", role: "assistant",
      // La forma REAL de una propuesta: `action_id` + `status: "proposed"`, que es lo que
      // `toolsQuePropusieron` reconoce. Un fixture aproximado hacía pasar el test por el camino
      // equivocado — el del turno cortado.
      parts: [{ type: "tool-create_appointment", state: "output-available",
                output: { action_id: "act-1", status: "proposed" } }],
    } as unknown as UIMessage
    const turnos = turnoAGuardar(historial, propone)
    expect(turnos).toHaveLength(2)
    expect(turnos[1].content).toContain("propuesta")
    expect(turnos[1].content).not.toContain("cortó")
    expect(turnos[1].content).toContain("[[propuesto:create_appointment]]")
  })

  it("sin mensajes del vet no guarda nada del vet", () => {
    expect(turnoAGuardar([msg("assistant", "hola")], undefined)).toEqual([])
  })
})

describe("sanearHistorial — desactiva las afirmaciones de propuesta sin respaldo", () => {
  const turno = (role: "user" | "assistant", text: string) =>
    ({ id: "x", role, parts: [{ type: "text", text }] }) as unknown as UIMessage

  it("un turno que dice haber propuesto SIN marca queda desactivado", () => {
    // Los 16 que ya están en producción: el modelo los recibía como ejemplo imitable.
    const r = sanearHistorial([turno("assistant", "Te dejé propuesto el correo — aprobálo en la tarjeta.")])
    expect(textoDe(r[0])).toContain("[[sin-propuesta:")
  })

  it("un turno CON marca se deja intacto: ahí sí hubo acción", () => {
    const original = "Te dejé propuesta la cita.\n\n[[propuesto:create_appointment]]"
    const r = sanearHistorial([turno("assistant", original)])
    expect(textoDe(r[0])).toBe(original)
    expect(textoDe(r[0])).not.toContain("sin-propuesta")
  })

  it("un turno normal no se toca", () => {
    const original = "Luna pesa 12,4 kg y su última consulta fue el 28 de julio."
    const r = sanearHistorial([turno("assistant", original)])
    expect(textoDe(r[0])).toBe(original)
  })

  it("los turnos del VETERINARIO nunca se tocan, aunque nombren la tarjeta", () => {
    const original = "aprobálo en la tarjeta por favor"
    const r = sanearHistorial([turno("user", original)])
    expect(textoDe(r[0])).toBe(original)
  })

  it("no rompe un historial vacío", () => {
    expect(sanearHistorial([])).toEqual([])
  })
})

describe("sinMarcaDePropuesta", () => {
  it("borra el formato que escribe el servidor", () => {
    expect(sinMarcaDePropuesta("Listo.\n\n[[propuesto:send_email]]")).toBe("Listo.")
  })

  // El patrón viejo era `[a-z_,]+` y este caso —el que se vio en producción— no lo matcheaba.
  it("borra el que escribe el modelo, con espacios y repetido", () => {
    expect(sinMarcaDePropuesta("Listo.\n\n[[propuesto:send_email, send_email]]")).toBe("Listo.")
  })

  it("borra varias en el mismo texto", () => {
    expect(sinMarcaDePropuesta("Uno [[propuesto:a]] y dos [[propuesto:b, c]] fin")).toBe(
      "Uno y dos fin",
    )
  })

  it("no toca la otra marca ni el texto normal", () => {
    expect(sinMarcaDePropuesta("Nada que proponer.")).toBe("Nada que proponer.")
    expect(sinMarcaDePropuesta("Ojo.\n\n[[sin-propuesta: no lo imites]]")).toBe(
      "Ojo.\n\n[[sin-propuesta: no lo imites]]",
    )
  })
})

describe("recortarHistorial — lo que ve el modelo, no lo que ve el vet", () => {
  const msj = (role: "user" | "assistant", texto: string, relleno = 0): UIMessage =>
    ({
      id: `${role}-${texto.slice(0, 8)}-${relleno}`,
      role,
      parts: [
        { type: "text", text: texto },
        // El peso real del historial de producción: tool parts con JSON grande.
        ...(relleno ? [{ type: "text", text: "x".repeat(relleno) }] : []),
      ],
    }) as UIMessage

  it("un hilo corto pasa intacto", () => {
    const hilo = [msj("user", "hola"), msj("assistant", "buenas"), msj("user", "pregunta")]
    expect(recortarHistorial(hilo)).toEqual(hilo)
  })

  it("un hilo largo se queda con los últimos MAX_MENSAJES_AL_MODELO", () => {
    const hilo = Array.from({ length: 40 }, (_, i) =>
      msj(i % 2 ? "assistant" : "user", `turno ${i}`),
    )
    const r = recortarHistorial(hilo)
    expect(r.length).toBeLessThanOrEqual(MAX_MENSAJES_AL_MODELO)
    expect(r[r.length - 1]).toBe(hilo[hilo.length - 1]) // el final nunca se pierde
  })

  it("mensajes PESADOS (tool parts gordos) fuerzan más recorte, sin bajar de 4", () => {
    const hilo = Array.from({ length: 12 }, (_, i) =>
      msj(i % 2 ? "assistant" : "user", `turno ${i}`, 9000),
    )
    const r = recortarHistorial(hilo)
    expect(r.length).toBeLessThan(12)
    expect(r.length).toBeGreaterThanOrEqual(4)
  })

  it("nunca arranca con un turno del asistente (hay proveedores que lo rechazan)", () => {
    const hilo = Array.from({ length: 17 }, (_, i) =>
      msj(i % 2 ? "user" : "assistant", `turno ${i}`),
    )
    const r = recortarHistorial(hilo)
    expect(r[0].role).toBe("user")
  })

  it("jamás devuelve vacío: en el peor caso, el último mensaje", () => {
    const solo = [msj("assistant", "colgado")]
    expect(recortarHistorial(solo)).toHaveLength(1)
  })
})
