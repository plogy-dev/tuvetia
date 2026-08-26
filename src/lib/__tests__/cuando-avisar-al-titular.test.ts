/**
 * Cuándo se le escribe al titular al guardar una cita.
 *
 * Lo que se fija acá es que corregir una tilde NO le mande un WhatsApp a un cliente real, y que
 * mover la cita SÍ se lo mande. Las dos mitades importan: sin la primera se le escribe de más, y
 * sin la segunda el titular llega el día equivocado.
 */
import { describe, expect, it } from "vitest"

import { hayQueAvisar } from "@/lib/citas/cuando-avisar"

const LUNES = "2026-09-07T14:00:00+00:00"
const JUEVES = "2026-09-10T14:00:00+00:00"

/** Una cita normal recién creada. */
const CREAR = {
  esEdicion: false,
  status: "scheduled",
  esBloqueo: false,
  inicioAnterior: null,
  inicioNuevo: LUNES,
}

describe("al crear", () => {
  it("siempre se avisa", () => {
    expect(hayQueAvisar(CREAR)).toBe(true)
  })
})

describe("al editar", () => {
  it("cambiar el motivo o las notas NO avisa", () => {
    // Es el defecto que esto cierra: abrir la cita para corregir una tilde le mandaba al titular
    // otro «quedó agendada» idéntico al de ayer.
    expect(
      hayQueAvisar({ ...CREAR, esEdicion: true, inicioAnterior: LUNES, inicioNuevo: LUNES }),
    ).toBe(false)
  })

  it("mover la cita SÍ avisa", () => {
    // Cortar en «sólo al crear» arreglaría el spam y abriría algo peor: el titular se sigue
    // guiando por el martes viejo.
    expect(
      hayQueAvisar({ ...CREAR, esEdicion: true, inicioAnterior: LUNES, inicioNuevo: JUEVES }),
    ).toBe(true)
  })

  it("el mismo instante escrito distinto NO es un cambio de hora", () => {
    // La base devuelve `+00:00` y el formulario arma otra cosa; comparar cadenas leería eso como
    // un cambio y volvería a mandar el aviso en cada guardado.
    expect(
      hayQueAvisar({
        ...CREAR,
        esEdicion: true,
        inicioAnterior: "2026-09-07T14:00:00+00:00",
        inicioNuevo: "2026-09-07T09:00:00-05:00",
      }),
    ).toBe(false)
  })

  it("una fecha ilegible avisa, ante la duda", () => {
    expect(
      hayQueAvisar({ ...CREAR, esEdicion: true, inicioAnterior: "basura", inicioNuevo: LUNES }),
    ).toBe(true)
  })
})

describe("cuando NO hay a quién escribirle", () => {
  it("un bloqueo nunca avisa", () => {
    // No tiene titular ni teléfono: cada almuerzo reservado le pedía al proveedor un envío
    // imposible y le pintaba al vet un renglón rojo por algo que nunca tuvo destinatario.
    expect(hayQueAvisar({ ...CREAR, esBloqueo: true })).toBe(false)
    expect(
      hayQueAvisar({ ...CREAR, esBloqueo: true, esEdicion: true, inicioAnterior: JUEVES }),
    ).toBe(false)
  })
})

describe("segun como quede la cita", () => {
  it("cancelarla NO manda «quedó agendada»", () => {
    // Sería decirle que su cita está en pie justo cuando se acaba de caer.
    expect(hayQueAvisar({ ...CREAR, status: "cancelled" })).toBe(false)
    expect(
      hayQueAvisar({
        ...CREAR,
        esEdicion: true,
        status: "cancelled",
        inicioAnterior: LUNES,
        inicioNuevo: JUEVES,
      }),
    ).toBe(false)
  })

  it("tampoco una que ya paso o que no se presento", () => {
    for (const status of ["completed", "no_show", "in_progress"]) {
      expect(hayQueAvisar({ ...CREAR, status }), status).toBe(false)
    }
  })

  it("confirmada si avisa", () => {
    expect(hayQueAvisar({ ...CREAR, status: "confirmed" })).toBe(true)
  })
})
