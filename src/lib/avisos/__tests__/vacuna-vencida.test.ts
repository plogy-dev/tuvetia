/**
 * El segmento «vacuna vencida» no le puede escribir a quien ya se la puso.
 *
 * ── LA TRAMPA QUE ESTE TEST CUIDA ─────────────────────────────────────────────────────────────
 *
 * `vaccines` guarda APLICACIONES: una fila por pinchazo, cada una con su `next_dose_at`. La fila de
 * la vacuna del año pasado sigue diciendo que vencía en marzo, y es cierto — pero si en marzo se la
 * volvieron a poner, esa fila ya no significa nada.
 *
 * Un `where next_dose_at <= hoy` a secas le escribe al titular para avisarle de una vacuna que su
 * mascota tiene al día. Es el error que hace que la gente deje de abrir los correos de la clínica,
 * y en este producto el dominio de envío es UNO PARA TODAS: el que se quema no es el remitente de
 * esa clínica, es el de todas.
 *
 * Por eso el criterio es «la dosis MÁS NUEVA de esa vacuna en ese paciente ya venció», y por eso
 * está probado.
 */
import { describe, expect, it } from "vitest"

import { pacientesConVacunaVencida } from "@/lib/avisos/audiencia"

const HOY = "2026-08-25"

describe("a quién le toca una vacuna", () => {
  it("incluye al paciente cuya próxima dosis ya pasó", () => {
    expect(
      pacientesConVacunaVencida(
        [{ patient_id: "milo", vaccine_name: "Rabia", next_dose_at: "2026-06-01" }],
        HOY,
      ),
    ).toEqual(["milo"])
  })

  it("NO incluye al que ya se la volvió a poner", () => {
    // La aplicación vieja sigue diciendo que vencía en 2026-06-01. La nueva la relevó.
    expect(
      pacientesConVacunaVencida(
        [
          { patient_id: "milo", vaccine_name: "Rabia", next_dose_at: "2026-06-01" },
          { patient_id: "milo", vaccine_name: "Rabia", next_dose_at: "2027-06-01" },
        ],
        HOY,
      ),
    ).toEqual([])
  })

  it("las filas pueden venir en cualquier orden", () => {
    // PostgREST no garantiza orden sin `order()`, y quedarse con «la última que vi» en vez de «la
    // más nueva» daría un resultado distinto según cómo devolviera la base.
    expect(
      pacientesConVacunaVencida(
        [
          { patient_id: "milo", vaccine_name: "Rabia", next_dose_at: "2027-06-01" },
          { patient_id: "milo", vaccine_name: "Rabia", next_dose_at: "2026-06-01" },
        ],
        HOY,
      ),
    ).toEqual([])
  })

  it("una vacuna al día no tapa a OTRA vencida del mismo paciente", () => {
    // Cada vacuna es su propio grupo. Si se agrupara sólo por paciente, tener la rabia al día
    // ocultaría el refuerzo vencido de la polivalente.
    expect(
      pacientesConVacunaVencida(
        [
          { patient_id: "milo", vaccine_name: "Rabia", next_dose_at: "2027-06-01" },
          { patient_id: "milo", vaccine_name: "Polivalente", next_dose_at: "2026-06-01" },
        ],
        HOY,
      ),
    ).toEqual(["milo"])
  })

  it("«Rabia» y «rabia » son la misma vacuna", () => {
    // Sin normalizar, cada forma de escribirlo arma su propio grupo y la vieja vuelve a parecer
    // vencida — el mismo bug, disfrazado de dato sucio.
    expect(
      pacientesConVacunaVencida(
        [
          { patient_id: "milo", vaccine_name: "Rabia", next_dose_at: "2026-06-01" },
          { patient_id: "milo", vaccine_name: "rabia ", next_dose_at: "2027-06-01" },
        ],
        HOY,
      ),
    ).toEqual([])
  })

  it("la de hoy cuenta como vencida", () => {
    // El borde importa: si toca hoy, el aviso llega hoy y no mañana.
    expect(
      pacientesConVacunaVencida(
        [{ patient_id: "milo", vaccine_name: "Rabia", next_dose_at: HOY }],
        HOY,
      ),
    ).toEqual(["milo"])
  })

  it("un paciente aparece una sola vez aunque tenga tres vencidas", () => {
    expect(
      pacientesConVacunaVencida(
        [
          { patient_id: "milo", vaccine_name: "Rabia", next_dose_at: "2026-01-01" },
          { patient_id: "milo", vaccine_name: "Polivalente", next_dose_at: "2026-02-01" },
          { patient_id: "milo", vaccine_name: "Tos de las perreras", next_dose_at: "2026-03-01" },
        ],
        HOY,
      ),
    ).toEqual(["milo"])
  })
})
