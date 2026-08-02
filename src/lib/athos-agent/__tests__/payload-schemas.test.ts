import { describe, expect, it } from "vitest"

import { PAYLOAD_SCHEMAS, validarPayload } from "../payload-schemas"

// Revalidacion de `payload_override` al ejecutar una accion aprobada. Cierra el unico tramo donde el
// payload sale del servidor y vuelve sin que nada lo mire: el vet puede editar la propuesta —esa es
// la intencion— pero lo editado tiene que seguir siendo valido.

// patient_id, owner_id y reason son obligatorios desde 0048_calendar_admin_redesign (el RPC
// create_appointment ahora los exige, y valida que el paciente sea DEL titular indicado).
const CITA_OK = {
  title: "Control",
  starts_at: "2026-08-01T15:00:00.000Z",
  ends_at: "2026-08-01T15:30:00.000Z",
  patient_id: "2fa4dac8-2a34-4d03-85d7-f44f93780c34",
  owner_id: "9c1b1e7a-9a4a-4a3a-9c1a-3a4a9c1b1e7a",
  reason: "Control de rutina",
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

  // Regresión: este esquema pedía `substance` mientras la tool y el ejecutor usan `allergen`, así
  // que TODA propuesta de alergia se rechazaba con "add_allergy.substance: Required" y la alergia
  // nunca llegaba a la ficha. El nombre tiene que ser el mismo en las tres puntas.
  it("acepta una alergia con el nombre de campo que realmente usan la tool y el ejecutor", () => {
    const p = { patient_id: "2fa4dac8-2a34-4d03-85d7-f44f93780c34" }
    const r = validarPayload("update_patient_record", {
      ...p,
      add_allergy: { allergen: "penicilina", severity: "severe", reaction: "urticaria" },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const alergia = r.payload.add_allergy as Record<string, unknown>
      expect(alergia.allergen).toBe("penicilina") // sobrevive al parseo, no se descarta
      expect(alergia.severity).toBe("severe")
    }
  })

  it("rechaza una alergia sin severidad: la columna es NOT NULL y fallaría a mitad de ejecutar", () => {
    const p = { patient_id: "2fa4dac8-2a34-4d03-85d7-f44f93780c34" }
    expect(validarPayload("update_patient_record", { ...p, add_allergy: { allergen: "pollo" } }).ok)
      .toBe(false)
    // Y el nombre viejo ya no cuela: si alguien lo reintroduce, esto lo caza.
    expect(
      validarPayload("update_patient_record", {
        ...p,
        add_allergy: { substance: "pollo", severity: "mild" },
      }).ok,
    ).toBe(false)
  })

  it("una tool sin esquema declarado pasa tal cual, en vez de bloquearse", () => {
    const r = validarPayload("tool_que_no_existe", { lo: "que sea" })
    expect(r.ok).toBe(true)
  })

  it("cubre las 9 tools de escritura: agregar una obliga a declarar su esquema", () => {
    expect(Object.keys(PAYLOAD_SCHEMAS).sort()).toEqual([
      "create_appointment",
      "create_owner",
      "create_owner_and_patient",
      "create_patient",
      "reply_email",
      "send_email",
      "send_whatsapp_message",
      "update_appointment",
      "update_patient_record",
    ])
  })

  it("rechaza un destinatario que no es un correo", () => {
    // El vet puede editar el `to_email` en la tarjeta antes de aprobar; un typo ahí manda el correo
    // a un desconocido, y eso no se deshace.
    const base = { to_email: "ana@ejemplo.com", subject: "Control de Luna", body: "Hola Ana…" }
    expect(validarPayload("send_email", base).ok).toBe(true)
    expect(validarPayload("send_email", { ...base, to_email: "ana(arroba)ejemplo" }).ok).toBe(false)
    expect(validarPayload("send_email", { ...base, subject: "" }).ok).toBe(false)
  })

  it("una respuesta acepta el hilo de Gmail, que no es un uuid nuestro", () => {
    // El hilo vive en Gmail: su id es una cadena de Google. Exigir uuid acá rechazaría TODA
    // respuesta — el modo de fallo exacto que tuvo `create_appointment` con `add_allergy`.
    const base = {
      thread_id: "18f9c2a4b7e1d3f0",
      to_email: "ana@ejemplo.com",
      subject: "Re: Control de Luna",
      body: "Perfecto, la esperamos.",
    }
    expect(validarPayload("reply_email", base).ok).toBe(true)
    // El destinatario sí se valida: el vet puede corregirlo en la tarjeta y un typo manda la
    // respuesta a un desconocido.
    expect(validarPayload("reply_email", { ...base, to_email: "ana(arroba)ejemplo" }).ok).toBe(false)
    // Y lo desconocido se sigue descartando.
    const r = validarPayload("reply_email", { ...base, from_email: "otro@ejemplo.com" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload).not.toHaveProperty("from_email")
  })
})
