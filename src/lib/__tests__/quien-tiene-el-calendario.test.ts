/**
 * De quién es el calendario de la clínica.
 *
 * LO QUE ESTOS TESTS PROTEGEN es que haya UNA sola respuesta. La regla estaba escrita dos veces y
 * distinto —el camino que empuja la cita con respaldo al primer `admin`, la pantalla de Conexiones
 * sin él— y esa diferencia produce el peor estado posible en una clínica sin `owner_id`: las citas
 * se empujan al calendario del primer admin y ese admin **nunca ve el botón para conectarlo**.
 * Nadie recibe invitación y no hay nada en pantalla que lo explique.
 *
 * Reportado el 21-ago como "el calendario no funciona". No lo era: quien lo reportó era veterinario
 * —no administrador— en una clínica ajena, y el conector se le ocultaba correctamente. Que un botón
 * ausente se lea como una falla es el motivo de la otra mitad del arreglo: nombrar al administrador.
 */

import { describe, expect, it } from "vitest"

import {
  puedeConectarElCalendario,
  quienTieneElCalendario,
} from "@/lib/calendario/quien-lo-tiene"

const OWNER = "u-owner"
const ADMIN = { id: "u-admin", full_name: "Ana Pérez" }

describe("quién tiene el calendario", () => {
  it("manda `owner_id` cuando está", () => {
    expect(quienTieneElCalendario(OWNER, ADMIN)).toBe(OWNER)
  })

  // Una decisión explícita —quién creó la clínica— no la pisa una inferencia.
  it("`owner_id` le gana al primer admin, no al revés", () => {
    expect(quienTieneElCalendario(OWNER, ADMIN)).not.toBe(ADMIN.id)
  })

  // EL RESPALDO. Las clínicas anteriores a la 0048 no tienen `owner_id`; sin esto no hay nadie que
  // pueda conectar el calendario y las citas no llegan a ningún lado.
  it("sin `owner_id` cae al primer admin", () => {
    expect(quienTieneElCalendario(null, ADMIN)).toBe(ADMIN.id)
    expect(quienTieneElCalendario(undefined, ADMIN)).toBe(ADMIN.id)
  })

  it("sin ninguno de los dos, no hay administrador", () => {
    expect(quienTieneElCalendario(null, null)).toBeNull()
    expect(quienTieneElCalendario(undefined, undefined)).toBeNull()
  })
})

describe("quién puede conectarlo", () => {
  it("el administrador resuelto, sí", () => {
    expect(puedeConectarElCalendario(OWNER, quienTieneElCalendario(OWNER, null))).toBe(true)
  })

  // LA MITAD QUE FALTABA EN CONEXIONES: comparar contra `owner_id` a secas dejaba al primer admin
  // recibiendo las citas sin botón para conectar el calendario donde caen.
  it("el primer admin TAMBIÉN, cuando no hay `owner_id`", () => {
    expect(puedeConectarElCalendario(ADMIN.id, quienTieneElCalendario(null, ADMIN))).toBe(true)
  })

  it("un veterinario de la clínica, no", () => {
    expect(puedeConectarElCalendario("u-vet", quienTieneElCalendario(OWNER, ADMIN))).toBe(false)
  })

  it("sin sesión, no", () => {
    expect(puedeConectarElCalendario(null, OWNER)).toBe(false)
    expect(puedeConectarElCalendario(undefined, OWNER)).toBe(false)
  })

  // Sin administrador resuelto nadie puede conectarlo — y sobre todo, un `null` de los dos lados no
  // puede leerse como "coinciden".
  it("dos nulos no son una coincidencia", () => {
    expect(puedeConectarElCalendario(null, null)).toBe(false)
  })
})
