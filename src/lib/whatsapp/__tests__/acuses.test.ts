/**
 * Los acuses de WhatsApp.
 *
 * Medido el 23-ago: **0 de 3.491 salientes** tenían `delivered_at` o `read_at`. Todo mensaje de la
 * clínica se quedaba en un solo check, para siempre — incluidos los recordatorios de cobranza,
 * donde saber si el titular LEYÓ es la diferencia entre «no le llegó» y «no quiere pagar».
 *
 * Lo que se prueba acá no es el webhook sino las dos decisiones que se pueden equivocar en
 * silencio: qué significa cada estado de Baileys, y qué se escribe cuando los acuses llegan
 * desordenados — que es lo normal.
 */
import { describe, expect, it } from "vitest"

import { acuseDe, camposDelAcuse } from "@/lib/whatsapp/acuses"

const AHORA = "2026-08-24T20:00:00.000Z"
const ANTES = "2026-08-24T19:00:00.000Z"

describe("acuseDe — los estados de Baileys", () => {
  it("entiende los NOMBRES", () => {
    expect(acuseDe("DELIVERY_ACK")).toBe("entregado")
    expect(acuseDe("READ")).toBe("leido")
  })

  it("entiende también los NÚMEROS del enum", () => {
    // Evolution manda una u otra forma según versión. Apostar a una sola es volver a cero acuses el
    // día que actualicen.
    expect(acuseDe(3)).toBe("entregado")
    expect(acuseDe(4)).toBe("leido")
    expect(acuseDe("3")).toBe("entregado")
  })

  it("PLAYED cuenta como leído", () => {
    // Una nota de voz escuchada: para el vet significa lo mismo, y un tercer estado que la bandeja
    // no sabe pintar sería información que se pierde.
    expect(acuseDe("PLAYED")).toBe("leido")
    expect(acuseDe(5)).toBe("leido")
  })

  it("SERVER_ACK no sella nada — ése es el primer check, y ya lo da `created_at`", () => {
    expect(acuseDe("SERVER_ACK")).toBeNull()
    expect(acuseDe(2)).toBeNull()
  })

  it("PENDING y ERROR tampoco", () => {
    expect(acuseDe("PENDING")).toBeNull()
    expect(acuseDe("ERROR")).toBeNull()
    expect(acuseDe(0)).toBeNull()
    expect(acuseDe(1)).toBeNull()
  })

  it("lo que no reconoce no inventa nada", () => {
    for (const basura of [null, undefined, "", "  ", "CUALQUIERA", {}, [], 99]) {
      expect(acuseDe(basura), `${JSON.stringify(basura)}`).toBeNull()
    }
  })

  it("no le importan mayúsculas ni espacios", () => {
    expect(acuseDe(" delivery_ack ")).toBe("entregado")
    expect(acuseDe("read")).toBe("leido")
  })
})

describe("camposDelAcuse — los acuses llegan desordenados", () => {
  const limpio = { delivered_at: null, read_at: null }

  it("un entregado sella la entrega", () => {
    expect(camposDelAcuse("entregado", limpio, AHORA)).toEqual({ delivered_at: AHORA })
  })

  it("LEÍDO IMPLICA ENTREGADO cuando el de entrega se perdió", () => {
    // Pasa: si el primer acuse que llega es READ, un mensaje «leído y no entregado» sería un estado
    // que no existe, y la bandeja lo pintaría como si siguiera en camino.
    expect(camposDelAcuse("leido", limpio, AHORA)).toEqual({
      delivered_at: AHORA,
      read_at: AHORA,
    })
  })

  it("NUNCA PISA LO QUE YA ESTÁ SELLADO", () => {
    // La primera fecha es la buena: es la hora en que de verdad pasó, no la del reintento.
    expect(camposDelAcuse("entregado", { delivered_at: ANTES, read_at: null }, AHORA)).toEqual({})
    expect(camposDelAcuse("leido", { delivered_at: ANTES, read_at: ANTES }, AHORA)).toEqual({})
  })

  it("UN ENTREGADO TARDÍO NO DES-LEE UN MENSAJE", () => {
    // El caso que justifica todo esto. Un `DELIVERY_ACK` que aterriza DESPUÉS de un `READ` —y
    // aterriza— no puede devolver el tick azul a gris: el vet vería que el titular «des-leyó» su
    // mensaje.
    const yaLeido = { delivered_at: ANTES, read_at: ANTES }
    const campos = camposDelAcuse("entregado", yaLeido, AHORA)
    expect(campos).not.toHaveProperty("read_at")
    expect(campos).toEqual({})
  })

  it("un leído sobre algo ya entregado sólo agrega la lectura", () => {
    expect(camposDelAcuse("leido", { delivered_at: ANTES, read_at: null }, AHORA)).toEqual({
      read_at: AHORA,
    })
  })

  it("sin acuse no se escribe nada", () => {
    expect(camposDelAcuse(null, limpio, AHORA)).toEqual({})
  })
})

describe("el webhook sólo sella SALIENTES", () => {
  const RUTA = "src/app/api/whatsapp/evolution/webhook/[token]/route.ts"

  it("comprueba la dirección antes de escribir", async () => {
    // NO es un detalle: en los ENTRANTES `read_at` ya significa otra cosa — lo escribe la propia
    // bandeja cuando el vet abre la conversación, y alimenta el contador de no leídos. Un acuse que
    // lo sellara marcaría como leídas conversaciones que nadie abrió.
    const { readFileSync } = await import("node:fs")
    const fuente = readFileSync(RUTA, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
    const bloque = fuente.slice(fuente.indexOf('event === "messages.update"'))
    expect(bloque.slice(0, 2000)).toContain('direction !== "outbound"')
  })

  it("y se suscribe al evento que trae los acuses", async () => {
    const { EVOLUTION_WEBHOOK_EVENTS } = await import("@/lib/whatsapp/evolution")
    expect(EVOLUTION_WEBHOOK_EVENTS).toContain("MESSAGES_UPDATE")
  })

  it("REFRESCA LA SUSCRIPCIÓN DE LAS INSTANCIAS QUE YA EXISTÍAN", async () => {
    // La trampa que casi deja este arreglo muerto: los eventos sólo se registran al CONECTAR
    // (`ensureInstance` ← `/api/whatsapp/evolution/connect`), así que agregar MESSAGES_UPDATE al
    // arreglo no alcanza a las instancias creadas antes. Desplegar esto sin la resuscripción no
    // habría cambiado nada en las clínicas ya conectadas hasta que alguien reescaneara un QR — que
    // es justo lo que no se le puede pedir a un vet para arreglar algo que él no rompió.
    const { readFileSync } = await import("node:fs")
    const fuente = readFileSync(RUTA, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
    expect(fuente).toContain("asegurarEventosDelWebhook(instance)")
  })
})
