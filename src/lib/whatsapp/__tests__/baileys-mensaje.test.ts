import { describe, expect, it } from "vitest"

import {
  desenvolver,
  esConversacionIndividual,
  textoDeMensaje,
  tipoDeMedia,
  tiposDeContenido,
  type EvoMessage,
} from "../baileys-mensaje"

// Cada test de acá reproduce una forma real de mensaje que ANTES se descartaba en silencio, con el
// número conectado y el webhook funcionando. Es la prueba que faltaba para no depender de tener un
// WhatsApp delante.

const conMensaje = (message: EvoMessage["message"]): EvoMessage => ({
  key: { remoteJid: "573001112233@s.whatsapp.net", id: "ABC123" },
  message,
})

describe("desenvolver — los contenedores de Baileys", () => {
  it("el texto plano pasa igual", () => {
    expect(textoDeMensaje(conMensaje({ conversation: "hola" }))).toBe("hola")
  })

  it("deviceSentMessage: lo que uno se manda A SÍ MISMO", () => {
    // La instancia de Evolution ES un dispositivo vinculado del teléfono del vet, así que la
    // primera prueba que cualquiera hace —escribirse a sí mismo— llega envuelta así.
    const m = conMensaje({ deviceSentMessage: { message: { conversation: "prueba" } } })
    expect(textoDeMensaje(m)).toBe("prueba")
  })

  it("ephemeralMessage: chats con mensajes temporales", () => {
    const m = conMensaje({ ephemeralMessage: { message: { conversation: "se borra" } } })
    expect(textoDeMensaje(m)).toBe("se borra")
  })

  it("anidado dos veces, que es como llega de verdad", () => {
    const m = conMensaje({
      deviceSentMessage: { message: { ephemeralMessage: { message: { conversation: "doble" } } } },
    })
    expect(textoDeMensaje(m)).toBe("doble")
  })

  it("una foto envuelta sigue siendo una foto, con su pie", () => {
    const m = conMensaje({
      ephemeralMessage: { message: { imageMessage: { caption: "mirá la herida" } } },
    })
    expect(tipoDeMedia(m)).toBe("image")
    expect(textoDeMensaje(m)).toBe("mirá la herida")
  })

  it("una foto SIN pie no tiene texto, pero sí tipo — y por eso no se descarta", () => {
    // El guardia del webhook es `if (!body && !media) continue`. Si `tipoDeMedia` no viera dentro
    // del contenedor, una foto sin pie se caería entera.
    const m = conMensaje({ deviceSentMessage: { message: { imageMessage: {} } } })
    expect(textoDeMensaje(m)).toBeNull()
    expect(tipoDeMedia(m)).toBe("image")
  })

  it("no se cuelga con un anidamiento absurdo", () => {
    let hondo: NonNullable<EvoMessage["message"]> = { conversation: "fondo" }
    for (let i = 0; i < 40; i += 1) hondo = { ephemeralMessage: { message: hondo } }
    expect(() => desenvolver(hondo)).not.toThrow()
  })

  it("un tipo que no sabemos leer se nombra, para poder agregarlo", () => {
    const m = conMensaje({ ephemeralMessage: { message: { pollCreationMessage: {} } as never } })
    expect(textoDeMensaje(m)).toBeNull()
    expect(tipoDeMedia(m)).toBeNull()
    expect(tiposDeContenido(m)).toBe("pollCreationMessage")
  })
})

describe("esConversacionIndividual — la protección dura del agente", () => {
  it("un grupo JAMÁS", () => {
    expect(esConversacionIndividual("120363000000000000@g.us")).toBe(false)
  })

  it("difusión y estados tampoco", () => {
    expect(esConversacionIndividual("status@broadcast")).toBe(false)
    expect(esConversacionIndividual("123@broadcast")).toBe(false)
  })

  it("un canal tampoco", () => {
    expect(esConversacionIndividual("123@newsletter")).toBe(false)
  })

  it("una persona sí", () => {
    expect(esConversacionIndividual("573001112233@s.whatsapp.net")).toBe(true)
  })

  it("una persona con direccionamiento LID también", () => {
    // WhatsApp está migrando a LID. Con la lista blanca anterior (`@s.whatsapp.net`) una
    // conversación normal con este formato se descartaba entera y en silencio.
    expect(esConversacionIndividual("18092345678901@lid")).toBe(true)
  })

  it("una cadena sin arroba no es un JID", () => {
    expect(esConversacionIndividual("")).toBe(false)
    expect(esConversacionIndividual("573001112233")).toBe(false)
  })
})
