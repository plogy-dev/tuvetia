import { describe, expect, it } from "vitest"

import { clasificarFalloDeEnvio, ErrorQueElVetPuedeResolver, FALLO_DE_ACCION } from "../error-de-envio"
import { EvolutionError } from "../evolution"
import { normalizarTelefono } from "../telefono"

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

describe("clasificarFalloDeEnvio con contexto de acción", () => {
  // El clasificador se aplica a las nueve tools de `athos/actions/[id]/execute`, no sólo a WhatsApp.
  it("NO le habla de mensajes al vet cuando falló crear un paciente", () => {
    const f = clasificarFalloDeEnvio(new Error("violación de constraint"), FALLO_DE_ACCION)
    expect(f.texto).not.toContain("mensaje")
    expect(f.texto).not.toContain("WhatsApp")
    expect(f.texto).toContain("acción")
  })

  it("no manda a revisar una conexión de WhatsApp que no tiene nada que ver", () => {
    const f = clasificarFalloDeEnvio(new EvolutionError("x → 400", 400), FALLO_DE_ACCION)
    expect(f.texto).not.toContain("WhatsApp")
    expect(f.texto).toContain("400")
  })

  it("un 5xx y un timeout siguen distinguiéndose", () => {
    const t = new Error("abortado")
    t.name = "TimeoutError"
    expect(clasificarFalloDeEnvio(t, FALLO_DE_ACCION).status).toBe(504)
    expect(clasificarFalloDeEnvio(new EvolutionError("x → 503", 503), FALLO_DE_ACCION).texto).toContain("503")
  })

  it("sigue sin filtrar el detalle crudo", () => {
    const crudo = 'POST /instancia/tuvetia_6c7504ae → 401: {"apikey":"secreta"}'
    const f = clasificarFalloDeEnvio(new EvolutionError(crudo, 401), FALLO_DE_ACCION)
    expect(f.texto).not.toContain("tuvetia_6c7504ae")
    expect(f.texto).not.toContain("secreta")
  })

  it("el contexto por defecto sigue siendo el de WhatsApp, palabra por palabra", () => {
    // Lo que garantiza que agregar el contexto no cambió nada del camino de envío.
    expect(clasificarFalloDeEnvio(new Error("x")).texto).toBe(
      "No se pudo enviar el mensaje por un error inesperado. Si vuelve a pasar, avisá a soporte.",
    )
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

  it("el `detalle` NUNCA se le muestra al vet: para eso está el mensaje", () => {
    // Los fallos a medias de Athos necesitan las dos cosas — la frase accionable para el vet y el
    // error de Postgres para la auditoría. Si `detalle` se colara a la UI, el arreglo habría
    // reintroducido justo la fuga que este archivo existe para evitar.
    const e = new ErrorQueElVetPuedeResolver(
      "El titular se creó, pero el paciente no.",
      409,
      'duplicate key value violates unique constraint "patients_pkey" en tuvetia_6c7504ae',
    )
    const f = clasificarFalloDeEnvio(e, FALLO_DE_ACCION)
    expect(f.texto).toBe("El titular se creó, pero el paciente no.")
    expect(f.texto).not.toContain("constraint")
    expect(f.texto).not.toContain("tuvetia_6c7504ae")
    // Y el detalle sigue disponible para quien lo audita.
    expect(e.detalle).toContain("patients_pkey")
  })

  it("sin `detalle`, el mensaje sigue siendo el rastro — no queda undefined", () => {
    const e = new ErrorQueElVetPuedeResolver("algo pasó")
    expect(e.detalle).toBeUndefined()
    expect(e.message).toBe("algo pasó")
  })
})

describe("normalizarTelefono", () => {
  it("le pone el indicativo a un móvil colombiano de 10 dígitos", () => {
    // El fallo real: Athos propuso "3244669300" y WhatsApp respondió `exists:false`.
    expect(normalizarTelefono("3244669300")).toBe("573244669300")
    expect(normalizarTelefono("324 466 9300")).toBe("573244669300")
  })

  it("un fijo de 10 dígitos también lo lleva", () => {
    expect(normalizarTelefono("6012345678")).toBe("576012345678")
  })

  it("no toca el que ya viene completo", () => {
    expect(normalizarTelefono("573244669300")).toBe("573244669300")
    expect(normalizarTelefono("+57 324 466 9300")).toBe("573244669300")
  })

  it("NO asume Colombia para longitudes que no son la nacional", () => {
    // Un internacional destrozado por asumir el 57 es peor que uno sin tocar.
    expect(normalizarTelefono("+1 415 555 0123")).toBe("14155550123")
    expect(normalizarTelefono("+34 600 123 456")).toBe("34600123456")
  })
})
