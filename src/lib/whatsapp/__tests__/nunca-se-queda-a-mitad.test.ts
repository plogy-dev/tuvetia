/**
 * Las tres piezas que hacen que nadie se quede a mitad de una cita.
 *
 * El caso que las trajo, medido en producción el 30-ago: un número no registrado le pidió cita a
 * `Clinica de Santiago Tellez`, VetGPT contestó dos veces y después se quedó mudo para siempre —
 * también ante «?», «?» y «a qué horas quedó mi cita?». La clínica no tenía horarios cargados, y el
 * silencio era el comodín para todo.
 *
 * Lo que se fija acá, en orden de importancia:
 *
 *   1. Que el rescate devuelva `null` sin cita en curso. Es LA garantía clínica: si esto se rompe,
 *      VetGPT empieza a contestar cosas que no debe. Todo lo demás de este archivo importa menos.
 *   2. Que ningún literal de rescate contenga nada clínico. Se comprueba con una lista negra, no
 *      leyéndolos: los literales se editan y nadie vuelve a mirar el test.
 *   3. Que «Mañana» a secas conserve la cita que ya estaba abierta — el mensaje exacto que rompió.
 *   4. Que no se vuelva a preguntar lo que la persona ya dijo.
 */
import { describe, expect, it } from "vitest"

import {
  bloqueParaElPrompt,
  faltantes,
  resumenParaConfirmar,
  siguientePregunta,
  type DatosDeLaCita,
} from "@/lib/whatsapp/datos-de-la-cita"
import { hayCitaEnCurso, intencionDeLaConversacion } from "@/lib/whatsapp/intencion"
import {
  TURNOS_ANTES_DE_ENTREGAR,
  respuestaDeRescate,
  type MotivoDelSilencio,
} from "@/lib/whatsapp/respuestas-de-rescate"

const COMPLETOS: DatosDeLaCita = {
  nombre: "Santiago Tellez",
  mascota: "Milo",
  especie: "Perro",
  motivo: "Control anual",
  email: "santiago@ejemplo.com",
  fecha: "2026-09-01",
  hora: "10:00",
}

describe("la garantía clínica — lo primero que no se puede romper", () => {
  it("sin cita en curso NO manda nada, pase lo que pase", () => {
    // Los tres motivos, con datos completos y con datos vacíos: ninguna combinación puede sacar un
    // mensaje si no hay un agendamiento abierto. Éste es el test que protege el silencio.
    const motivos: MotivoDelSilencio[] = ["sin_texto", "sin_horarios", "sin_avance"]
    for (const motivo of motivos) {
      for (const datos of [COMPLETOS, {}]) {
        for (const mensajesSinAvance of [0, 99]) {
          expect(
            respuestaDeRescate({ citaEnCurso: false, datos, mensajesSinAvance }, motivo),
            `${motivo} / sinAvance=${mensajesSinAvance}`,
          ).toBeNull()
        }
      }
    }
  })

  it("ningún literal de rescate dice nada clínico", () => {
    // No se leen a ojo: se editan y nadie vuelve a mirar. Si alguien mete una dosis o un precio en
    // una de estas frases, esto tiene que romperse.
    const PROHIBIDO = /dosis|\bmg\b|síntoma|sintoma|medicament|antibiótic|antibiotic|precio|\$|vacun/i
    const motivos: MotivoDelSilencio[] = ["sin_texto", "sin_horarios", "sin_avance"]
    const salidas: string[] = []
    for (const motivo of motivos) {
      for (const datos of [COMPLETOS, {}, { nombre: "Ana" }]) {
        for (const mensajesSinAvance of [0, TURNOS_ANTES_DE_ENTREGAR]) {
          const r = respuestaDeRescate({ citaEnCurso: true, datos, mensajesSinAvance }, motivo)
          if (r) salidas.push(r)
        }
      }
    }
    expect(salidas.length).toBeGreaterThan(0)
    for (const s of salidas) expect(s, s).not.toMatch(PROHIBIDO)
  })

  it("con una cita en curso SIEMPRE sale algo — nunca silencio", () => {
    const motivos: MotivoDelSilencio[] = ["sin_texto", "sin_horarios", "sin_avance"]
    for (const motivo of motivos) {
      for (const datos of [COMPLETOS, {}, { nombre: "Ana", mascota: "Kira" }]) {
        expect(
          respuestaDeRescate({ citaEnCurso: true, datos, mensajesSinAvance: 0 }, motivo),
          motivo,
        ).toBeTruthy()
      }
    }
  })

  it("después de N turnos sin avanzar, entrega la conversación en vez de insistir", () => {
    const r = respuestaDeRescate(
      { citaEnCurso: true, datos: { nombre: "Ana" }, mensajesSinAvance: TURNOS_ANTES_DE_ENTREGAR },
      "sin_texto",
    )
    expect(r).toMatch(/equipo/i)
  })
})

describe("la intención — «Mañana» es el mensaje que rompió", () => {
  it("«Quiero agendar una cita» abre el agendamiento", () => {
    expect(intencionDeLaConversacion("Quiero agendar una cita")).toBe("cita")
  })

  it("«Mañana» a secas CONSERVA la cita que ya estaba abierta", () => {
    // Éste es el bug entero en una línea. Un clasificador sin memoria devolvería «general» y el
    // agente trataría la respuesta como una consulta suelta — que es como se perdió el hilo.
    expect(intencionDeLaConversacion("Mañana", "cita")).toBe("cita")
    expect(intencionDeLaConversacion("?", "cita")).toBe("cita")
    expect(intencionDeLaConversacion("Santiago Tellez, mi mascota se llama Milo", "cita")).toBe("cita")
  })

  it("lo clínico gana incluso sobre una cita en curso", () => {
    expect(intencionDeLaConversacion("Milo está vomitando", "cita")).toBe("clinico")
    expect(hayCitaEnCurso(intencionDeLaConversacion("Milo está vomitando", "cita"))).toBe(false)
  })

  it("lo clínico dura un solo turno", () => {
    // Quien contó un síntoma y después pregunta el horario merece que le contesten el horario.
    expect(intencionDeLaConversacion("¿A qué hora abren?", "clinico")).toBe("general")
  })

  it("una pregunta suelta no abre ningún agendamiento", () => {
    expect(intencionDeLaConversacion("¿A qué hora abren?")).toBe("general")
    expect(hayCitaEnCurso(intencionDeLaConversacion("¿A qué hora abren?"))).toBe(false)
  })
})

describe("los datos — no se pregunta dos veces lo mismo", () => {
  it("lo que ya está nunca vuelve a faltar", () => {
    expect(faltantes({})).toContain("nombre")
    expect(faltantes({ nombre: "Santiago" })).not.toContain("nombre")
    // Un string vacío o de espacios NO cuenta como respondido: si contara, el agente daría por
    // sabido un nombre que nadie dijo y crearía una ficha en blanco.
    expect(faltantes({ nombre: "   " })).toContain("nombre")
  })

  it("el correo se puede rechazar, y entonces deja de faltar", () => {
    expect(faltantes({ email_rechazado: true })).not.toContain("email")
    expect(faltantes({ email: "a@b.com" })).not.toContain("email")
    expect(faltantes({})).toContain("email")
  })

  it("el teléfono nunca se pregunta: ya lo tenemos", () => {
    expect(faltantes({})).not.toContain("telefono" as never)
    expect(bloqueParaElPrompt({})).not.toMatch(/teléfono|telefono/i)
  })

  it("sin hora alcanza con el día — o la conversación no cerraría nunca sin horarios cargados", () => {
    expect(faltantes({ ...COMPLETOS, hora: null, sin_hora: true, fecha: "2026-09-01" })).not.toContain("cuando")
    expect(faltantes({ ...COMPLETOS, hora: null, sin_hora: false })).toContain("cuando")
  })

  it("con todo junto ya no hay más preguntas", () => {
    expect(faltantes(COMPLETOS)).toEqual([])
    expect(siguientePregunta(COMPLETOS)).toBeNull()
  })

  it("el bloque del prompt y lo que falta salen de la misma cuenta", () => {
    // Si divergieran, el prompt diría «ya tenés el nombre» mientras la lógica lo cuenta como
    // faltante, y el modelo quedaría atrapado entre los dos.
    const datos: DatosDeLaCita = { nombre: "Ana", mascota: "Kira" }
    const bloque = bloqueParaElPrompt(datos)
    expect(bloque).toContain("Ana")
    for (const id of faltantes(datos)) expect(bloque).toContain(id)
    expect(bloque).toContain(siguientePregunta(datos)!)
  })

  it("el resumen que se lee de vuelta incluye el teléfono, aunque no se haya preguntado", () => {
    // Es el dato con el que se crea la ficha, y verlo escrito es la única oportunidad de corregirlo
    // para quien escribe desde el teléfono de otra persona.
    expect(resumenParaConfirmar(COMPLETOS, "573118850971").join("\n")).toContain("573118850971")
  })
})
