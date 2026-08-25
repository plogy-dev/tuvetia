/**
 * Los avisos de la clínica a sus titulares.
 *
 * ── QUÉ SE PROTEGE ────────────────────────────────────────────────────────────────────────────
 *
 * El dominio remitente es **uno solo para todas las clínicas**. Una lista sucia de una clínica le
 * baja la reputación al dominio y manda a spam los correos de cartera de todas las demás. Esa es la
 * razón por la que esta función estuvo planeada y sin construir desde el 22-ago, y por la que acá
 * hay más frenos que función.
 *
 * Las tres cosas que no pueden romperse en silencio:
 *
 *   1. Que la baja se respete DOS VECES —al armar la lista y al enviar—. Entre una y otra pasan
 *      minutos, y filtrar sólo al armar es la forma natural de escribirle a quien acaba de pedir que
 *      no le escribieran.
 *   2. Que el pie de baja vaya SIEMPRE, con el enlace propio de cada titular. Sin él, la gente marca
 *      como spam — que hace justo el daño que todo esto intenta evitar.
 *   3. Que la audiencia NO venga del navegador. Recibir la lista de correos sería dejar que quien
 *      manipule la petición elija a quién le escribe la clínica.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

import { pieDeBaja } from "@/lib/avisos/envio"
import { SEGMENTOS, TOPE } from "@/lib/avisos/audiencia"

const sinComentarios = (ruta: string) =>
  readFileSync(ruta, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")

const AUDIENCIA = sinComentarios("src/lib/avisos/audiencia.ts")
const ENVIO = sinComentarios("src/lib/avisos/envio.ts")
const ACTIONS = sinComentarios("src/lib/avisos/actions.ts")

describe("el pie de baja", () => {
  it("lleva el enlace propio del titular", () => {
    const pie = pieDeBaja("https://tuvetia.co", "abc-123")
    expect(pie).toContain("https://tuvetia.co/baja/abc-123")
  })

  it("aguanta una base con barra al final sin duplicarla", () => {
    expect(pieDeBaja("https://tuvetia.co/", "t")).toContain("https://tuvetia.co/baja/t")
    expect(pieDeBaja("https://tuvetia.co/", "t")).not.toContain("co//baja")
  })

  it("DICE QUE LA BAJA NO AFECTA LAS FACTURAS", () => {
    // Es la distinción que sostiene todo: darse de baja de los avisos no puede dar de baja de la
    // cobranza, que es la relación contractual y tiene su propio régimen. Si el correo no lo dice,
    // el titular se da de baja creyendo que apaga todo.
    expect(pieDeBaja("https://x.co", "t")).toContain("facturas")
  })

  it("va en TODOS los correos, no sólo en el primero", () => {
    // Dentro del bucle, no antes: si se armara una vez fuera, todos llevarían el enlace del primer
    // titular — y darse de baja daría de baja a otra persona.
    const i = ENVIO.indexOf("for (const [i, d] of aEnviar.entries())")
    expect(i).toBeGreaterThan(-1)
    expect(ENVIO.slice(i, i + 400)).toContain("pieDeBaja(baseUrl, d.token)")
  })
})

describe("la baja se respeta DOS veces", () => {
  it("al armar la audiencia", () => {
    expect(AUDIENCIA).toContain("sinLosDeBaja(")
  })

  it("y OTRA VEZ al enviar", () => {
    // Entre que la clínica arma la lista y aprieta enviar pueden pasar diez minutos.
    expect(ENVIO).toContain("sinLosDeBaja(")
    const i = ENVIO.indexOf("export async function enviarAviso")
    expect(ENVIO.slice(i, i + 700)).toContain("sinLosDeBaja(")
  })

  it("y se cuenta a cuántos se excluyó, para que se vea", () => {
    expect(ENVIO).toContain("excluidosPorBaja")
  })
})

describe("la audiencia no viene del navegador", () => {
  it("la acción recibe un SEGMENTO, nunca una lista de correos", () => {
    // Recibir correos dejaría que quien manipule la petición elija a quién le escribe la clínica —
    // incluidos correos de otra clínica.
    expect(ACTIONS).toContain("segmento: SEGMENTO")
    expect(ACTIONS).not.toMatch(/destinatarios:\s*z\./)
    expect(ACTIONS).not.toMatch(/emails?:\s*z\.array/)
  })

  it("y la vuelve a armar del lado del servidor antes de mandar", () => {
    const i = ACTIONS.indexOf("export async function mandarAviso")
    expect(ACTIONS.slice(i, i + 1200)).toContain("armarAudiencia(clinicId")
  })
})

describe("los frenos", () => {
  it("hay tope por envío", () => {
    expect(TOPE).toBeLessThanOrEqual(500)
    expect(AUDIENCIA).toContain("slice(0, TOPE)")
  })

  it("hay ritmo entre correos", () => {
    expect(ENVIO).toContain("MS_ENTRE_ENVIOS")
  })

  it("SÓLO SE REINTENTA LO TRANSITORIO", () => {
    // Reintentar un dominio mal configurado es gastar reputación dos veces por el mismo error.
    expect(ENVIO).toContain("envio.transient")
  })

  it("la traza es POR DESTINATARIO, no una del lote", () => {
    // Si algo rebota hay que poder decir a quién le llegó y a quién no. Es lo que convierte un
    // reclamo en algo que se puede responder.
    const i = ENVIO.indexOf("for (const [i, d] of aEnviar.entries())")
    expect(ENVIO.slice(i)).toContain('action: "aviso_titulares.enviado"')
  })

  it("todo va detrás del administrador de la clínica", () => {
    expect(ACTIONS).toContain("requireClinicAdmin()")
  })
})

describe("los segmentos son cerrados", () => {
  it("no hay «todos» ni consulta libre", () => {
    // Una lista de «todos» incluye al titular que dejó la clínica hace dos años y cuyo correo ya no
    // existe: eso es un rebote, y los rebotes queman el dominio de todas.
    const claves = Object.keys(SEGMENTOS)
    expect(claves.length).toBeGreaterThan(0)
    expect(claves).not.toContain("TODOS")
    for (const k of claves) {
      expect(SEGMENTOS[k as keyof typeof SEGMENTOS].etiqueta.length).toBeGreaterThan(5)
    }
  })

  it("cada segmento se apoya en algo que PASÓ en la clínica", () => {
    // Un paciente registrado, una consulta, una cita. Son direcciones de gente que estuvo.
    expect(AUDIENCIA).toContain('from("patients")')
    expect(AUDIENCIA).toContain('from("consultations")')
    expect(AUDIENCIA).toContain('from("appointments")')
  })
})
