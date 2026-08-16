// El bloque «Contexto runtime» del system prompt.
//
// POR QUÉ IMPORTA PROBAR ESTO. Si una línea deja de llegar al prompt, el modelo pierde una
// capacidad y **no falla nada**: ni un tipo, ni el lint, ni ningún otro test. La respuesta sale
// peor y nadie se entera hasta que un vet la usa. Es el modo de fallo silencioso que este archivo
// existe para cazar.
import { describe, expect, it } from "vitest"

import { bloqueDeContextoRuntime } from "@/lib/athos-agent/contexto-runtime"

const UUID = "3f7b1c2e-9a4d-4e6f-8b1a-2c3d4e5f6a7b"
const BASE = { hoyISO: "2026-08-16" }

describe("lo que siempre está", () => {
  it("la fecha va siempre, anclada a Colombia", () => {
    const b = bloqueDeContextoRuntime(BASE)
    expect(b).toContain("2026-08-16")
    expect(b).toContain("UTC-5")
  })

  it("es un bloque con encabezado y una línea por hecho", () => {
    const b = bloqueDeContextoRuntime({ ...BASE, clinica: "Clínica Norte", vet: "Dra. Ruiz" })
    expect(b).toMatch(/^# Contexto runtime/)
    expect(b.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(3)
  })
})

describe("lo que no se sabe no se inventa", () => {
  // Un prompt lleno de negaciones —"clínica: ninguna", "paciente: ninguno"— le enseña al modelo a
  // hablar de lo que no tiene. Lo ausente simplemente no aporta línea.
  it("sin clínica, sin vet y sin paciente no aparecen sus líneas", () => {
    const b = bloqueDeContextoRuntime(BASE)
    expect(b).not.toMatch(/Clínica:/)
    expect(b).not.toMatch(/Hablás con/)
    expect(b).not.toMatch(/paciente en contexto/)
    expect(b.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1)
  })

  it("un nombre vacío no cuenta como nombre", () => {
    expect(bloqueDeContextoRuntime({ ...BASE, clinica: "", vet: "" })).not.toMatch(/Clínica:|Hablás/)
  })
})

describe("la pantalla que el vet tiene delante", () => {
  // EL CABLEADO QUE ESTA FASE AGREGA. Sin esto, parado en una consulta, Athos no sabía ni de qué
  // paciente se trataba: `patientId` llega null en cinco de las ocho pantallas.
  it("una consulta llega al prompt con su id", () => {
    const b = bloqueDeContextoRuntime({
      ...BASE,
      contexto: { tipo: "consulta", consultaId: UUID },
    })
    expect(b).toContain(UUID)
    expect(b).toContain("get_consultation_details")
  })

  it("la agenda llega al prompt", () => {
    const b = bloqueDeContextoRuntime({ ...BASE, contexto: { tipo: "agenda" } })
    expect(b).toContain("list_appointments_on_day")
  })

  it("sin contexto el bloque sigue armándose igual", () => {
    expect(() => bloqueDeContextoRuntime({ ...BASE, contexto: null })).not.toThrow()
    expect(bloqueDeContextoRuntime({ ...BASE, contexto: null })).toContain("2026-08-16")
  })

  // Las pantallas sin nada útil que decir no aportan línea: se paga en tokens todos los turnos.
  it("el chat a pantalla completa no agrega ruido", () => {
    const b = bloqueDeContextoRuntime({ ...BASE, contexto: { tipo: "asistente", patientId: null } })
    expect(b.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1)
  })
})

describe("lo que ya funcionaba y no se rompió", () => {
  it("el paciente del selector sigue llegando", () => {
    expect(bloqueDeContextoRuntime({ ...BASE, patientId: UUID })).toContain("get_patient_summary")
  })

  it("la bandeja sigue diciendo cuál es su objetivo", () => {
    expect(bloqueDeContextoRuntime({ ...BASE, source: "inbox" })).toContain("send_whatsapp_message")
  })

  it("el chat normal no arrastra la instrucción de la bandeja", () => {
    expect(bloqueDeContextoRuntime({ ...BASE, source: "chat" })).not.toContain("bandeja de WhatsApp")
  })

  it("el aviso de densidad clínica se conserva al final", () => {
    const b = bloqueDeContextoRuntime({ ...BASE, avisoDensidad: "\n- ⚠️ POCOS datos clínicos" })
    expect(b).toMatch(/POCOS datos clínicos$/)
  })
})

describe("todo junto, que es como corre de verdad", () => {
  it("un vet en una consulta, con clínica y paciente, recibe las cinco líneas", () => {
    const b = bloqueDeContextoRuntime({
      hoyISO: "2026-08-16",
      clinica: "Clínica Norte",
      vet: "Dra. Ruiz",
      patientId: UUID,
      contexto: { tipo: "consulta", consultaId: "11111111-2222-4333-8444-555555555555" },
      source: "widget",
    })
    const lineas = b.split("\n").filter((l) => l.startsWith("- "))
    expect(lineas).toHaveLength(5)
    // Y ninguna se pisa con otra: el paciente del selector y la consulta son cosas distintas.
    expect(b).toContain(UUID)
    expect(b).toContain("11111111-2222-4333-8444-555555555555")
  })
})
