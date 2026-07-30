/**
 * Hilado de correo. Es lógica chica pero de consecuencia alta: si `belongsToThread` devuelve false
 * cuando debía dar true, la respuesta del titular se pierde en silencio y la cobranza por correo
 * queda muda. Por eso los casos cubren lo que los clientes de correo mandan DE VERDAD, no solo el
 * caso ideal del RFC.
 */
import { describe, expect, it } from "vitest"

import {
  belongsToThread,
  buildMessageId,
  domainOf,
  parseMessageIds,
  replyHeaders,
  replySubject,
} from "../threading"

const ROOT = "<factura.abc-123.1@suclinica.com>"

describe("buildMessageId", () => {
  it("usa el dominio del remitente", () => {
    expect(buildMessageId("abc", "cobros@suclinica.com", "1")).toBe("<factura.abc.1@suclinica.com>")
  })

  it("cae a tuvetia.com si el remitente no tiene dominio usable", () => {
    expect(buildMessageId("abc", "no-es-un-email", "1")).toContain("@tuvetia.com")
  })

  it("dos envíos de la MISMA factura no colisionan", () => {
    // El RFC exige Message-ID único; hay servidores que rechazan el duplicado.
    const a = buildMessageId("abc", "x@y.com", "1")
    const b = buildMessageId("abc", "x@y.com", "2")
    expect(a).not.toBe(b)
  })

  it("sanea caracteres que romperían el header", () => {
    const id = buildMessageId("ab<c> d", "x@y.com", "1")
    expect(id).toBe("<factura.abcd.1@y.com>")
    // Un `<` suelto adentro partiría el header en dos.
    expect(id.match(/</g)).toHaveLength(1)
  })
})

describe("domainOf", () => {
  it.each([
    ["cobros@suclinica.com", "suclinica.com"],
    ["Cobros@SuClinica.COM", "suclinica.com"],
    ["a@b@c.com", "c.com"], // toma el último @, como manda el RFC
  ])("%s -> %s", (input, expected) => {
    expect(domainOf(input)).toBe(expected)
  })

  it.each(["sin-arroba", "@sindominio", "x@", "x@localhost"])("rechaza %s", (input) => {
    expect(domainOf(input)).toBeNull()
  })
})

describe("parseMessageIds", () => {
  it("extrae varios de un References normal", () => {
    expect(parseMessageIds("<a@x.com> <b@x.com>")).toEqual(["<a@x.com>", "<b@x.com>"])
  })

  it("tolera lo que mandan los clientes de verdad: comas, saltos y espacios de más", () => {
    const header = "<a@x.com>,\r\n  <b@x.com>   <c@x.com>"
    expect(parseMessageIds(header)).toEqual(["<a@x.com>", "<b@x.com>", "<c@x.com>"])
  })

  it("no explota con null, vacío ni basura", () => {
    expect(parseMessageIds(null)).toEqual([])
    expect(parseMessageIds("")).toEqual([])
    expect(parseMessageIds("sin ids acá")).toEqual([])
  })
})

describe("belongsToThread", () => {
  it("reconoce la raíz en References", () => {
    expect(belongsToThread(ROOT, { references: `${ROOT} <otro@x.com>` })).toBe(true)
  })

  it("reconoce la raíz cuando SOLO viene In-Reply-To", () => {
    // Outlook viejo manda solo In-Reply-To. Si mirásemos únicamente References, se perdería.
    expect(belongsToThread(ROOT, { inReplyTo: ROOT, references: null })).toBe(true)
  })

  it("ignora diferencias de mayúsculas", () => {
    // Los servidores no respetan el case, y una comparación estricta pierde la respuesta.
    expect(belongsToThread(ROOT, { references: ROOT.toUpperCase() })).toBe(true)
  })

  it("no reclama un hilo ajeno", () => {
    expect(belongsToThread(ROOT, { references: "<factura.otra.1@suclinica.com>" })).toBe(false)
  })

  it("sin headers de hilado, no pertenece", () => {
    expect(belongsToThread(ROOT, {})).toBe(false)
    expect(belongsToThread(ROOT, { references: null, inReplyTo: null })).toBe(false)
  })

  it("una raíz vacía nunca hace match (evita reclamar todo)", () => {
    expect(belongsToThread("", { references: "<a@x.com>" })).toBe(false)
  })
})

describe("replyHeaders", () => {
  it("primera respuesta: la raíz queda en los dos headers", () => {
    expect(replyHeaders(ROOT, null)).toEqual({ inReplyTo: ROOT, references: ROOT })
  })

  it("conserva la cadena y responde al último", () => {
    const r = replyHeaders(ROOT, `${ROOT} <b@x.com>`)
    expect(r.inReplyTo).toBe("<b@x.com>")
    expect(r.references).toBe(`${ROOT} <b@x.com>`)
  })

  it("acota a 20 ids pero NUNCA pierde la raíz", () => {
    // La raíz es la que identifica la factura: si se cae, el hilo queda huérfano.
    const largo = [ROOT, ...Array.from({ length: 40 }, (_, i) => `<m${i}@x.com>`)].join(" ")
    const r = replyHeaders(ROOT, largo)
    const ids = parseMessageIds(r.references)
    expect(ids).toHaveLength(20)
    expect(ids[0]).toBe(ROOT)
    expect(ids[ids.length - 1]).toBe("<m39@x.com>")
  })
})

describe("replySubject", () => {
  it.each([
    ["Factura FV-100", "Re: Factura FV-100"],
    ["Re: Factura FV-100", "Re: Factura FV-100"],
    ["RE: Factura FV-100", "Re: Factura FV-100"],
    ["Rv: Factura FV-100", "Re: Factura FV-100"],
    ["Fwd: Factura FV-100", "Re: Factura FV-100"],
  ])("%s -> %s", (input, expected) => {
    // Un solo Re:, no una escalera — que además rompe el agrupado por asunto de algunos webmails.
    expect(replySubject(input)).toBe(expected)
  })

  it("sin asunto no produce 'Re: undefined'", () => {
    expect(replySubject(null)).toBe("Re:")
    expect(replySubject("")).toBe("Re:")
  })
})
