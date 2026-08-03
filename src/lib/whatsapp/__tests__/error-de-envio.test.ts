import { describe, expect, it } from "vitest"

import { clasificarFalloDeEnvio, ErrorQueElVetPuedeResolver } from "../error-de-envio"
import { EvolutionError } from "../evolution"

describe("clasificarFalloDeEnvio", () => {
  it("el número desvinculado conserva su mensaje y su 409", () => {
    const e = new Error("WhatsApp no está conectado. Verificá la conexión en Configuración → WhatsApp.")
    const f = clasificarFalloDeEnvio(e)
    expect(f.status).toBe(409)
    expect(f.texto).toContain("Configuración")
  })

  it("el timeout se distingue del rechazo — no es lo mismo para el vet", () => {
    const e = new Error("The operation was aborted due to timeout")
    e.name = "TimeoutError"
    const f = clasificarFalloDeEnvio(e)
    expect(f.status).toBe(504)
    expect(f.texto).toContain("no respondió a tiempo")
  })

  it("un 5xx del proveedor dice que está fallando", () => {
    const f = clasificarFalloDeEnvio(new EvolutionError("Evolution POST /x → 503: caído", 503))
    expect(f.texto).toContain("503")
    expect(f.texto).toContain("fallando")
  })

  it("un 4xx manda a revisar el número, que es la acción distinta", () => {
    const f = clasificarFalloDeEnvio(new EvolutionError("Evolution POST /x → 400: bad number", 400))
    expect(f.texto).toContain("400")
    expect(f.texto).toContain("Revisá")
  })

  it("NUNCA filtra el cuerpo crudo del proveedor", () => {
    // El mensaje de EvolutionError trae la ruta y la respuesta del servicio: ahí puede viajar un
    // identificador interno o el nombre de la instancia, que es el de la clínica.
    const crudo = "Evolution POST /message/sendText/tuvetia_6c7504ae → 401: {\"apikey\":\"secreta\"}"
    const f = clasificarFalloDeEnvio(new EvolutionError(crudo, 401))
    expect(f.texto).not.toContain("tuvetia_6c7504ae")
    expect(f.texto).not.toContain("secreta")
    expect(f.texto).not.toContain("sendText")
  })

  it("lo desconocido admite que es inesperado en vez de prometer que reintentar sirve", () => {
    const f = clasificarFalloDeEnvio(new Error("algo rarísimo"))
    expect(f.status).toBe(502)
    expect(f.texto).toContain("inesperado")
    expect(f.texto).not.toContain("rarísimo")
  })
})

describe("ErrorQueElVetPuedeResolver", () => {
  it("su mensaje llega TAL CUAL a la UI, con su propio status", () => {
    const f = clasificarFalloDeEnvio(
      new ErrorQueElVetPuedeResolver(
        "No se puede enviar un WhatsApp al número de la propia clínica. Para probar, usá otro teléfono.",
        400,
      ),
    )
    expect(f.status).toBe(400)
    expect(f.texto).toContain("otro teléfono")
  })

  it("no depende del texto — que es lo que se rompía", () => {
    // El caso del número propio caía al genérico "error inesperado" mientras la clasificación se
    // hacía por `includes`. Cualquier frase nueva tiene que llegar entera sin tocar el clasificador.
    const f = clasificarFalloDeEnvio(new ErrorQueElVetPuedeResolver("una frase que nadie previó"))
    expect(f.texto).toBe("una frase que nadie previó")
    expect(f.status).toBe(409)
  })
})
