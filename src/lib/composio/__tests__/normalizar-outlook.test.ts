/**
 * La bandeja tiene que mostrar lo mismo venga de Gmail o de Outlook.
 *
 * Outlook devuelve TRES formas distintas y ninguna se parece a la de Gmail (verificado contra los
 * esquemas de Composio el 2026-08-03):
 *
 * - todo envuelto en `data.response_data`;
 * - `LIST_MESSAGES` → la colección normal de Graph, `{ value: [...] }`;
 * - `SEARCH_MESSAGES` → la Search API, con los mensajes enterrados en
 *   `value[].hitsContainers[].hits[].resource`.
 *
 * El de la búsqueda es el que importa: si el normalizador sólo leyera `value`, buscar devolvería
 * una bandeja VACÍA en vez de un error — un fallo silencioso, que es el peor tipo.
 */
import { describe, expect, it } from "vitest"

import { adaptador } from "@/lib/composio/proveedores"

const outlook = adaptador("outlook")

const MENSAJE = {
  id: "AAMkAD1234",
  subject: "Resultados de Luna",
  bodyPreview: "Adjunto el hemograma",
  receivedDateTime: "2026-08-01T14:30:00Z",
  isRead: false,
  hasAttachments: true,
  from: { emailAddress: { name: "Ana Gómez", address: "ana@lab.com" } },
  toRecipients: [{ emailAddress: { address: "vet@clinica.co" } }],
}

describe("normalizar de Outlook", () => {
  it("lee la colección de LIST_MESSAGES, envuelta en response_data", () => {
    const r = outlook.normalizar({ response_data: { value: [MENSAJE] } }, "vet@clinica.co")
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({
      id: "AAMkAD1234",
      // Se responde AL MENSAJE en Outlook, no al hilo: por eso refRespuesta es el id del mensaje.
      refRespuesta: "AAMkAD1234",
      de: "Ana Gómez <ana@lab.com>",
      para: "vet@clinica.co",
      asunto: "Resultados de Luna",
      leido: false,
      adjuntos: 1,
    })
  })

  it("desentierra los mensajes de la Search API, que van dentro de los hits", () => {
    const busqueda = {
      response_data: {
        value: [{ hitsContainers: [{ hits: [{ resource: MENSAJE }] }] }],
      },
    }
    const r = outlook.normalizar(busqueda, "vet@clinica.co")
    expect(r).toHaveLength(1)
    expect(r[0].asunto).toBe("Resultados de Luna")
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

describe("elección de tool según haya o no búsqueda", () => {
  it("sin texto lista (SEARCH_MESSAGES exige query), con texto busca", () => {
    expect(outlook.buscar("", 25).slug).toBe("OUTLOOK_OUTLOOK_LIST_MESSAGES")
    expect(outlook.buscar("Luna", 25).slug).toBe("OUTLOOK_OUTLOOK_SEARCH_MESSAGES")
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
