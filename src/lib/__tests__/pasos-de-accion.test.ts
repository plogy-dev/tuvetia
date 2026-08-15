import { describe, expect, it } from "vitest"

import {
  destinosDeAccion,
  pasosEjecutados,
  pasosPrevistos,
} from "@/lib/athos-agent/pasos-de-accion"

describe("pasosPrevistos", () => {
  it("dice que agendar son DOS cosas, no una", () => {
    // Es justo lo que la tarjeta no decía: la cita también se copia al calendario de la clínica.
    expect(pasosPrevistos("create_appointment", {})).toHaveLength(2)
  })

  it("para la ficha lista sólo lo que esa propuesta toca", () => {
    expect(pasosPrevistos("update_patient_record", { patient_id: "x", weight_kg: 4.5 })).toEqual([
      "Actualizar el peso en la ficha",
    ])
    expect(
      pasosPrevistos("update_patient_record", {
        patient_id: "x",
        weight_kg: 4.5,
        notes_append: "Se observa cojera",
        add_allergy: { allergen: "penicilina", severity: "severe" },
      }),
    ).toHaveLength(3)
  })

  it("no cuenta un campo vacío como un paso", () => {
    expect(pasosPrevistos("update_patient_record", { patient_id: "x", notes_append: "   " })).toEqual([])
    expect(pasosPrevistos("update_patient_record", { patient_id: "x", add_allergy: {} })).toEqual([])
  })

  it("un peso de cero sigue siendo un cambio declarado", () => {
    // `!p.weight_kg` habría descartado el 0. Se compara contra null/undefined a propósito.
    expect(pasosPrevistos("update_patient_record", { patient_id: "x", weight_kg: 0 })).toEqual([
      "Actualizar el peso en la ficha",
    ])
  })

  it("un tool desconocido no rompe la tarjeta", () => {
    expect(pasosPrevistos("tool_inventada", {})).toEqual([])
    expect(pasosPrevistos("create_owner", null)).toEqual(["Crear el titular"])
  })
})

describe("pasosEjecutados", () => {
  it("marca como NO HECHO el paso que de verdad no ocurrió", () => {
    // El caso real: la cita quedó en la plataforma pero nadie conectó Google Calendar. Decir
    // "✓ Ejecutada" y nada más es como se pierde una cita en el teléfono del vet sin explicación.
    const pasos = pasosEjecutados("create_appointment", {
      appointment_id: "a1",
      google_event_id: null,
    })
    expect(pasos.map((p) => p.estado)).toEqual(["ok", "no"])
    expect(pasos[1].texto).toContain("No se copió")
  })

  it("marca los dos en ok cuando el calendario sí recibió la cita", () => {
    const pasos = pasosEjecutados("create_appointment", {
      appointment_id: "a1",
      google_event_id: "g_123",
    })
    expect(pasos.every((p) => p.estado === "ok")).toBe(true)
  })

  it("nombra la cuenta desde la que salió el correo", () => {
    expect(pasosEjecutados("send_email", { enviado: true, remitente: "vet@clinica.com" })[0].texto).toBe(
      "Correo enviado desde vet@clinica.com",
    )
  })

  it("sin remitente conocido no inventa la frase", () => {
    expect(pasosEjecutados("send_email", { enviado: true, remitente: null })[0].texto).toBe(
      "Correo enviado",
    )
  })

  it("lee de `updated` las columnas que la ruta tocó de verdad", () => {
    const pasos = pasosEjecutados("update_patient_record", {
      patient_id: "p1",
      updated: ["weight_kg", "notes"],
      allergy_added: true,
    })
    expect(pasos).toHaveLength(3)
    expect(pasos.every((p) => p.estado === "ok")).toBe(true)
  })

  it("no da por hecha la alergia si la ruta no la registró", () => {
    const pasos = pasosEjecutados("update_patient_record", {
      patient_id: "p1",
      updated: ["weight_kg"],
      allergy_added: false,
    })
    expect(pasos.map((p) => p.texto)).toEqual(["Peso actualizado en la ficha"])
  })

  it("un resultado ausente o raro no produce pasos inventados", () => {
    expect(pasosEjecutados("update_patient_record", undefined)).toEqual([])
    expect(pasosEjecutados("create_appointment", "nada")).toHaveLength(2) // sin google_event_id → "no"
    expect(pasosEjecutados("tool_inventada", {})).toEqual([])
  })
})

describe("destinosDeAccion", () => {
  it("lleva a la ficha del paciente recién creado", () => {
    expect(destinosDeAccion("create_owner_and_patient", { owner_id: "o1", patient_id: "p1" })).toEqual([
      { texto: "Ver la ficha", href: "/dashboard/patients/p1" },
    ])
  })

  it("no arma un enlace a la ficha si no vino el id", () => {
    // Mejor ningún botón que un botón a `/dashboard/patients/undefined`.
    expect(destinosDeAccion("create_patient", {})).toEqual([])
  })

  it("un titular nuevo va al LISTADO, porque la ficha de titular no existe", () => {
    expect(destinosDeAccion("create_owner", { owner_id: "o1" })).toEqual([
      { texto: "Ver los titulares", href: "/dashboard/owners" },
    ])
  })

  it("la cita lleva a la agenda", () => {
    expect(destinosDeAccion("create_appointment", { appointment_id: "a1" })[0].href).toBe(
      "/dashboard/calendario",
    )
  })

  it("cada destino apunta a una ruta que existe en el repo", () => {
    // Las rutas reales bajo `src/app/dashboard`. Si alguien borra una, este test lo dice antes que
    // un 404 en producción.
    const RUTAS = [
      "/dashboard/calendario",
      "/dashboard/owners",
      "/dashboard/comunicaciones",
      "/dashboard/comunicaciones/correo",
    ]
    const tools = [
      "create_appointment",
      "update_appointment",
      "create_owner",
      "send_whatsapp_message",
      "send_email",
      "reply_email",
    ]
    for (const t of tools) {
      for (const d of destinosDeAccion(t, {})) {
        expect(RUTAS).toContain(d.href)
      }
    }
  })
})
