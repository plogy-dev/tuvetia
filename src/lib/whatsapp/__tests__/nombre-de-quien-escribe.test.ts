/**
 * El nombre de quien escribe por WhatsApp.
 *
 * ── EL DEFECTO ────────────────────────────────────────────────────────────────────────────────
 *
 * Reportado el 24-ago: «cuando escribe un número, aparece sin nombre, solo número». La bandeja
 * resolvía el nombre contra los titulares registrados y, si no encontraba, pintaba `+57300…`. Sin
 * plan B — aunque Baileys nos venía mandando `pushName` en cada mensaje entrante y el webhook lo
 * tiraba.
 *
 * ── LO QUE ESTE TEST PROTEGE ──────────────────────────────────────────────────────────────────
 *
 * Dos cosas que se pueden romper en silencio, y la segunda es de fondo:
 *
 *   1. Que el orden sea TITULAR → perfil → número. Al revés, el nombre que la clínica escribió y
 *      verificó quedaría tapado por el que eligió un desconocido.
 *   2. Que un nombre de perfil NUNCA se muestre como si fuera un titular. `pushName` lo elige quien
 *      escribe: puede decir «Servicio Técnico», un emoji, o el nombre de otra persona. Pintarlo sin
 *      marca es afirmar una identidad que nadie verificó — y esta bandeja es donde se decide a
 *      quién se le cobra.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

const FUENTE = readFileSync("src/components/whatsapp/inbox.tsx", "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "")

const WEBHOOK = readFileSync("src/app/api/whatsapp/evolution/webhook/[token]/route.ts", "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "")

describe("el webhook guarda el nombre de perfil", () => {
  it("lo escribe en la fila", () => {
    expect(WEBHOOK).toContain("push_name")
  })

  it("SÓLO EN ENTRANTES", () => {
    // En un saliente `pushName` es el nombre de perfil de LA CLÍNICA. Guardarlo llenaría la tabla
    // con nuestro propio nombre repetido, con el riesgo de que un día se pinte como si fuera del
    // titular.
    const i = WEBHOOK.indexOf("push_name")
    expect(WEBHOOK.slice(i, i + 120)).toContain("fromMe ?")
  })

  it("la bandeja lo trae en su consulta", () => {
    // Sin esto el campo existe, se guarda, y no llega a la pantalla — que desde afuera es
    // indistinguible de que no se guardara.
    expect(FUENTE).toContain("push_name")
  })
})

describe("el orden de los nombres", () => {
  it("TITULAR PRIMERO, después el perfil, y el número de último", () => {
    // El titular es el dato que la clínica escribió y verificó. Que lo tape un nombre elegido por
    // un desconocido sería perder información buena por información dudosa.
    const i = FUENTE.indexOf("const nameOf")
    const bloque = FUENTE.slice(i, i + 500)
    const iTitular = bloque.indexOf("ownerByPhone.get")
    const iPerfil = bloque.indexOf("perfilPorTelefono.get")
    const iNumero = bloque.indexOf("`+${phone}`")
    expect(iTitular).toBeGreaterThan(-1)
    expect(iPerfil).toBeGreaterThan(iTitular)
    expect(iNumero).toBeGreaterThan(iPerfil)
  })

  it("el nombre de perfil sale SÓLO de mensajes entrantes", () => {
    const i = FUENTE.indexOf("const perfilPorTelefono")
    expect(FUENTE.slice(i, i + 400)).toContain('m.direction !== "inbound"')
  })

  it("gana el más reciente: la gente cambia su nombre de WhatsApp", () => {
    // Se recorre en orden y el último sobrescribe. Si se cortara en el primero, la bandeja mostraría
    // para siempre el nombre que la persona tenía la primera vez que escribió.
    const i = FUENTE.indexOf("const perfilPorTelefono")
    const bloque = FUENTE.slice(i, i + 400)
    expect(bloque).toContain("map.set")
    expect(bloque).not.toContain("map.has")
  })
})

describe("un nombre de perfil NO se muestra como un titular", () => {
  it("hay una forma de distinguirlos", () => {
    expect(FUENTE).toContain("esNombreDePerfil")
  })

  it("y sólo es cierto cuando NO hay titular", () => {
    const i = FUENTE.indexOf("const esNombreDePerfil")
    const bloque = FUENTE.slice(i, i + 400)
    expect(bloque).toContain("!ownerByPhone.get")
    expect(bloque).toContain("perfilPorTelefono.get")
  })

  it("SE PINTA LA MARCA en la lista y en la conversación abierta", () => {
    // Que la función exista y no se use sería peor que no tenerla: el código diría que se distingue
    // y la pantalla no lo haría.
    // Se cuentan las LLAMADAS: la declaración es `esNombreDePerfil = useCallback(`, que no lleva
    // paréntesis pegado al nombre y por eso no entra en la cuenta. Son dos sitios: la lista de
    // conversaciones y la cabecera de la abierta.
    const usos = FUENTE.split("esNombreDePerfil(").length - 1
    expect(usos, "se declara pero no se pinta en los dos sitios").toBeGreaterThanOrEqual(2)
  })
})
