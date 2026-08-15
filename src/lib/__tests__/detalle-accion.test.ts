import { describe, expect, it } from "vitest"

import { camposDeAccion } from "@/lib/athos-agent/detalle-accion"

/** Igual que lo guarda la tool: `starts_at`/`ends_at` ya resueltos a ISO con offset de Colombia. */
const CITA = {
  title: "Control posquirúrgico",
  starts_at: "2026-08-20T10:30:00-05:00",
  ends_at: "2026-08-20T11:00:00-05:00",
  patient_id: "11111111-1111-1111-1111-111111111111",
  owner_id: "22222222-2222-2222-2222-222222222222",
  reason: "Retiro de puntos",
  notes: null,
}

function valorDe(campos: { etiqueta: string; valor: string }[], etiqueta: string) {
  return campos.find((c) => c.etiqueta === etiqueta)?.valor
}

describe("camposDeAccion", () => {
  it("no filtra ningún uuid a la pantalla", () => {
    const campos = camposDeAccion("create_appointment", CITA)
    const todo = campos.map((c) => c.valor).join(" ")
    expect(todo).not.toContain("11111111")
    expect(todo).not.toContain("22222222")
  })

  it("saca la duración de la diferencia entre los dos instantes", () => {
    expect(valorDe(camposDeAccion("create_appointment", CITA), "Duración")).toBe("30 min")
  })

  it("muestra el motivo, que el resumen de la tool no incluye", () => {
    expect(valorDe(camposDeAccion("create_appointment", CITA), "Motivo")).toBe("Retiro de puntos")
  })

  it("formatea el instante en la zona de Bogotá, no en UTC", () => {
    // 10:30 con offset -05:00 es 15:30Z. Formateado en UTC saldría con esa hora y, en un caso de
    // noche, con la fecha corrida un día — que es el defecto que documenta `date-utils.ts`.
    expect(valorDe(camposDeAccion("create_appointment", CITA), "Cuándo")).toContain("10:30")
  })

  it("omite los campos vacíos en vez de pintar filas sin valor", () => {
    const etiquetas = camposDeAccion("create_appointment", CITA).map((c) => c.etiqueta)
    expect(etiquetas).not.toContain("Notas")
  })

  it("expone los campos del titular que el resumen esconde", () => {
    const campos = camposDeAccion("create_owner", {
      full_name: "Camila Ospina",
      phone: "3104482291",
      email: "camila@example.com",
      document_id: "1020304050",
      address: "Calle 1 #2-3",
      notes: null,
    })
    // El resumen de la tool sólo dice nombre y teléfono; estos tres se guardaban sin que nadie los viera.
    expect(valorDe(campos, "Correo")).toBe("camila@example.com")
    expect(valorDe(campos, "Documento")).toBe("1020304050")
    expect(valorDe(campos, "Dirección")).toBe("Calle 1 #2-3")
  })

  it("separa titular y paciente cuando la propuesta trae los dos", () => {
    const campos = camposDeAccion("create_owner_and_patient", {
      owner: { full_name: "Camila Ospina", phone: "3104482291" },
      patient: { name: "Luna", species: "canino", sex: "female", weight_kg: 4.5 },
    })
    expect(valorDe(campos, "Titular · nombre")).toBe("Camila Ospina")
    expect(valorDe(campos, "Paciente · nombre")).toBe("Luna")
    expect(valorDe(campos, "Sexo")).toBe("Hembra")
    expect(valorDe(campos, "Peso")).toBe("4,5 kg")
  })

  it("traduce el estado de una cita a su etiqueta en español", () => {
    const campos = camposDeAccion("update_appointment", {
      appointment_id: "33333333-3333-3333-3333-333333333333",
      status: "canceled",
    })
    expect(valorDe(campos, "Estado")).toBe("Cancelada")
  })

  it("arma la alergia con alérgeno, severidad y reacción", () => {
    const campos = camposDeAccion("update_patient_record", {
      patient_id: "44444444-4444-4444-4444-444444444444",
      add_allergy: { allergen: "penicilina", severity: "severe", reaction: "urticaria" },
    })
    expect(valorDe(campos, "Alergia")).toBe("penicilina · severa · urticaria")
  })

  it("no repite los campos de mensajería, que ya se editan en el formulario", () => {
    for (const tool of ["send_whatsapp_message", "send_email", "reply_email"]) {
      expect(camposDeAccion(tool, { to_email: "a@b.com", subject: "x", body: "y" })).toEqual([])
    }
  })

  it("un tool desconocido o un payload que no es objeto no rompen la tarjeta", () => {
    expect(camposDeAccion("tool_que_no_existe", { a: 1 })).toEqual([])
    expect(camposDeAccion("create_owner", null)).toEqual([])
    expect(camposDeAccion("create_owner", "texto suelto")).toEqual([])
  })

  it("descarta fechas y horas imposibles en vez de imprimir Invalid Date", () => {
    const campos = camposDeAccion("create_appointment", {
      ...CITA,
      starts_at: "no-es-una-fecha",
      ends_at: "tampoco",
    })
    expect(campos.map((c) => c.etiqueta)).not.toContain("Cuándo")
    expect(campos.map((c) => c.etiqueta)).not.toContain("Duración")
  })
})
