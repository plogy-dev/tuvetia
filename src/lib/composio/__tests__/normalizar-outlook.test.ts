/**
 * La bandeja tiene que mostrar lo mismo venga de Gmail o de Outlook.
 *
 * Acá se fija sobre todo la decisión que costó un error en producción: Outlook NO usa
 * `SEARCH_MESSAGES`. Esa tool va contra la Microsoft Search API, que no existe para cuentas
 * personales — una cuenta outlook.com respondía "This API is not supported for MSA accounts" a
 * cada búsqueda. Todo va por `LIST_MESSAGES` (`/me/messages`), que sirve para los dos tipos.
 */
import { describe, expect, it } from "vitest"

import { adaptador } from "@/lib/composio/proveedores"

const outlook = adaptador("outlook")

const MENSAJE = {
  id: "AAMkAD1234",
  conversationId: "AAQkADconversacion",
  subject: "Resultados de Luna",
  bodyPreview: "Adjunto el hemograma",
  receivedDateTime: "2026-08-01T14:30:00Z",
  isRead: false,
  hasAttachments: true,
  webLink: "https://outlook.live.com/mail/0/inbox/id/AAMkAD1234",
  from: { emailAddress: { name: "Ana Gómez", address: "ana@lab.com" } },
  toRecipients: [{ emailAddress: { address: "vet@clinica.co" } }],
}

describe("normalizar de Outlook", () => {
  it("lee la colección de LIST_MESSAGES, envuelta en response_data", () => {
    const r = outlook.normalizar({ response_data: { value: [MENSAJE] } }, "vet@clinica.co")
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({
      id: "AAMkAD1234",
      refConversacion: "AAQkADconversacion",
      // Se responde AL MENSAJE en Outlook, no al hilo: por eso refRespuesta es el id del mensaje.
      refRespuesta: "AAMkAD1234",
      de: "Ana Gómez <ana@lab.com>",
      para: "vet@clinica.co",
      asunto: "Resultados de Luna",
      leido: false,
      adjuntos: 1,
      // El enlace sale de `webLink`, no de una URL fija: una cuenta personal vive en
      // outlook.live.com y una de trabajo en outlook.office.com.
      enlace: "https://outlook.live.com/mail/0/inbox/id/AAMkAD1234",
    })
  })

  it("nunca usa la Search API, que no existe para cuentas personales", () => {
    // El fallo real: con una cuenta outlook.com toda búsqueda moría en
    // "This API is not supported for MSA accounts". Si alguien vuelve a enrutar la búsqueda por
    // SEARCH_MESSAGES buscando el filtrado por cuerpo, este test cae primero.
    for (const q of ["", "Luna", "ana@lab.com"]) {
      expect(outlook.buscar(q, 25).slug).toBe("OUTLOOK_OUTLOOK_LIST_MESSAGES")
    }
    expect(outlook.buscarConversacion("AAQk-conv").slug).toBe("OUTLOOK_OUTLOOK_LIST_MESSAGES")
  })

  it("marca como propio lo que mandó la cuenta conectada", () => {
    const mio = { ...MENSAJE, from: { emailAddress: { address: "vet@clinica.co" } } }
    expect(outlook.normalizar({ response_data: { value: [mio] } }, "vet@clinica.co")[0].esPropio).toBe(true)
    expect(outlook.normalizar({ response_data: { value: [MENSAJE] } }, "vet@clinica.co")[0].esPropio).toBe(false)
  })

  it("una respuesta que no se entiende da una bandeja vacía, no una excepción", () => {
    // La página de correo es un server component: una excepción acá no muestra "no se pudo leer",
    // tira toda la ruta.
    for (const raro of [null, undefined, {}, { response_data: {} }, "texto", 42]) {
      expect(outlook.normalizar(raro, "vet@clinica.co")).toEqual([])
    }
  })

  it("un mensaje al que le faltan campos no rompe la fila", () => {
    const r = outlook.normalizar({ response_data: { value: [{ id: "x" }] } }, null)
    expect(r[0]).toMatchObject({ id: "x", asunto: "(sin asunto)", de: "(desconocido)", para: "" })
  })
})

describe("cómo se traduce una búsqueda a los filtros de Graph", () => {
  it("una dirección sola filtra por remitente; cualquier otra cosa, por asunto", () => {
    expect(outlook.buscar("ana@lab.com", 10).args).toMatchObject({ from_address: "ana@lab.com" })
    expect(outlook.buscar("Resultados", 10).args).toMatchObject({ subject_contains: "Resultados" })
  })

  it("siempre pide la bandeja de entrada, sin dejarlo al default", () => {
    expect(outlook.buscar("", 25).args).toMatchObject({ folder: "inbox" })
    expect(outlook.buscar("Luna", 25).args).toMatchObject({ folder: "inbox" })
  })

  it("al filtrar pide un lote grande, porque Graph filtra sobre lo ya traído", () => {
    // `subject_contains` y `from_address` se aplican del lado del cliente: con top=10 se buscaría
    // dentro de los 10 últimos correos y el vet vería "no encontré nada" casi siempre.
    expect(outlook.buscar("Resultados", 10).args.top).toBe(100)
    // Sin filtro no hace falta: se quiere justamente lo más reciente.
    expect(outlook.buscar("", 25).args.top).toBe(25)
  })

  it("responder NO manda destinatario: lo resuelve Graph desde el mensaje original", () => {
    // Es lo que sostiene `respuestaFijaDestinatario`, y con eso la verificación contra el hilo se
    // saltea para Outlook. Si algún día esta tool aceptara un `to`, la exención dejaría de ser
    // válida y este test tiene que caer.
    const { args } = outlook.responder({
      ref: "AAMkAD1234",
      a: "atacante@ejemplo.com",
      asunto: "Re: Resultados",
      cuerpo: "Gracias",
    })
    expect(outlook.respuestaFijaDestinatario).toBe(true)
    expect(JSON.stringify(args)).not.toContain("atacante@ejemplo.com")
    expect(args).toEqual({ message_id: "AAMkAD1234", comment: "Gracias" })
  })
})
