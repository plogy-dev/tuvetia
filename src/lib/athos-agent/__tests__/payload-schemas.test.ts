import { describe, expect, it } from "vitest"

import { PAYLOAD_SCHEMAS, validarPayload } from "../payload-schemas"

// Revalidacion de `payload_override` al ejecutar una accion aprobada. Cierra el unico tramo donde el
// payload sale del servidor y vuelve sin que nada lo mire: el vet puede editar la propuesta —esa es
// la intencion— pero lo editado tiene que seguir siendo valido.

const CITA_OK = {
  title: "Control",
  starts_at: "2026-08-01T15:00:00.000Z",
  ends_at: "2026-08-01T15:30:00.000Z",
  patient_id: "2fa4dac8-2a34-4d03-85d7-f44f93780c34",
  owner_id: null,
  reason: null,
  notes: null,
}

describe("revalidacion del payload al aprobar", () => {
  it("un payload legitimo pasa intacto", () => {
    const r = validarPayload("create_appointment", { ...CITA_OK })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.title).toBe("Control")
  })

  it("DESCARTA los campos desconocidos que alguien agregue al override", () => {
    // Es la proteccion que mas rinde: un `clinic_id` inyectado no puede llegar a la RPC.
    const r = validarPayload("create_appointment", {
      ...CITA_OK,
      clinic_id: "clinica-de-otro",
      vet_id: "otro-vet",
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload).not.toHaveProperty("clinic_id")
      expect(r.payload).not.toHaveProperty("vet_id")
    }
  })

  it("rechaza un uuid que no lo es, con un mensaje que el vet pueda leer", () => {
    const r = validarPayload("create_appointment", { ...CITA_OK, patient_id: "no-soy-un-uuid" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("patient_id")
  })

  it("rechaza una fecha que no es ISO", () => {
    const r = validarPayload("create_appointment", { ...CITA_OK, starts_at: "mañana a las 3" })
    expect(r.ok).toBe(false)
  })

  it("rechaza un cuerpo de WhatsApp vacio o desmedido", () => {
    const base = { to_phone: "573001112233", body: "hola" }
    expect(validarPayload("send_whatsapp_message", { ...base, body: "" }).ok).toBe(false)
    expect(validarPayload("send_whatsapp_message", { ...base, body: "x".repeat(1501) }).ok).toBe(false)
    expect(validarPayload("send_whatsapp_message", base).ok).toBe(true)
  })

  it("exige que el telefono venga normalizado a digitos", () => {
    // La tool lo normaliza al proponer; si el override trae formato libre, algo se salteo ese paso.
    expect(validarPayload("send_whatsapp_message", { to_phone: "+57 300 111 2233", body: "h" }).ok)
      .toBe(false)
  })

  it("rechaza un peso imposible en la ficha del paciente", () => {
    const p = { patient_id: "2fa4dac8-2a34-4d03-85d7-f44f93780c34" }
    expect(validarPayload("update_patient_record", { ...p, weight_kg: -3 }).ok).toBe(false)
    expect(validarPayload("update_patient_record", { ...p, weight_kg: 5000 }).ok).toBe(false)
    expect(validarPayload("update_patient_record", { ...p, weight_kg: 4.5 }).ok).toBe(true)
  })

  it("una tool sin esquema declarado pasa tal cual, en vez de bloquearse", () => {
    const r = validarPayload("tool_que_no_existe", { lo: "que sea" })
    expect(r.ok).toBe(true)
  })

  it("cubre las 7 tools de escritura: agregar una obliga a declarar su esquema", () => {
    expect(Object.keys(PAYLOAD_SCHEMAS).sort()).toEqual([
      "create_appointment",
      "create_owner",
      "create_owner_and_patient",
      "create_patient",
      "send_whatsapp_message",
      "update_appointment",
      "update_patient_record",
    ])
  })
})
