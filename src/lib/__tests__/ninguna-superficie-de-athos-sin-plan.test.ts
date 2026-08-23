/**
 * Ninguna superficie de Athos manda al modelo sin haber mirado el plan.
 *
 * QUÉ PROTEGE, Y CÓMO SE ROMPIÓ. `clinics.plan` tiene default `'free'`, así que TODA clínica nace
 * gratis; el corte de verdad está en la ruta (`requiereCapacidad` → 402) y eso nunca falló. Lo que
 * falló es lo que ve el vet: de las tres superficies que montan el chat del agente, sólo la
 * pantalla de Athos preguntaba por el plan. Las otras dos —el widget flotante, que está en TODAS
 * las pantallas, y el panel del onboarding, que es la PRIMERA que ve una clínica nueva— abrían
 * enteras, invitaban a escribir, y devolvían el toast de `onError`: «Athos no pudo responder».
 * Eso se lee como una falla del producto, no como una función de pago.
 *
 * El comentario de `plan-provider.tsx` decía "los dos lugares donde hay que frenar al vet". Eran
 * tres. Por eso este test DESCUBRE las superficies en vez de listarlas: la número cuatro nace con
 * el mismo olvido, y una lista escrita a mano no la ve.
 *
 * ES UN TEST QUE LEE EL FUENTE, como los de contraste y pastillas: no hay tests de componentes acá
 * (vitest corre en `node`), y esto no es una regla de comportamiento sino un acuerdo entre
 * archivos que nada más obliga a cumplir.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join, sep } from "node:path"

import { describe, expect, it } from "vitest"

const RAIZ = join(process.cwd(), "src")

/** El endpoint del agente. Quien lo monte como transporte está por gastar plata. */
const ENDPOINT = "/api/athos/agent"

function tsx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) return e.name === "__tests__" ? [] : tsx(ruta)
    return e.name.endsWith(".tsx") ? [ruta] : []
  })
}

/** Ruta legible y estable entre plataformas: en Windows `sep` es la barra invertida. */
const comoRuta = (f: string) => f.replace(RAIZ, "").split(sep).join("/")

/** Los archivos de cliente que abren un chat contra el agente. */
const SUPERFICIES = tsx(RAIZ).filter((f) => {
  const src = readFileSync(f, "utf8")
  return src.includes(ENDPOINT) && src.includes("useChat")
})

describe("las superficies de chat de Athos", () => {
  it("son las tres conocidas — si aparece una cuarta, este test la trae acá", () => {
    // No es un test de inventario por gusto: es lo que convierte al de abajo en una red y no en
    // tres asserts. Si alguien suma una superficie, esto se cae y lo obliga a mirar la regla.
    expect(SUPERFICIES.length).toBeGreaterThanOrEqual(3)
    expect(SUPERFICIES.map(comoRuta).sort()).toEqual([
      "/app/dashboard/asistente/assistant.tsx",
      "/components/athos/athos-widget.tsx",
      "/components/onboarding/onboarding-athos.tsx",
    ])
  })

  it.each(SUPERFICIES.map((f) => [comoRuta(f), f]))(
    "%s mira el plan antes de mandar",
    (_nombre, ruta) => {
      const src = readFileSync(ruta, "utf8")

      // Dos formas legítimas de conocer el plan, y la diferencia importa: `PlanProvider` sólo
      // envuelve `/dashboard`, así que una pantalla de FUERA que use el contexto leería el default
      // (`free`) y le mostraría el muro a una clínica Pro. Ésas reciben el plan por prop.
      const conoceElPlan =
        /useCapacidad\(\s*["']athos["']\s*\)/.test(src) ||
        /tieneAcceso\(\s*plan\s*,\s*["']athos["']\s*\)/.test(src)
      expect(conoceElPlan, "no consulta el plan de la clínica").toBe(true)

      // Y que lo consultado FRENE. Conocer el plan y mandar igual es el estado en que estaban las
      // dos rotas si sólo se hubiera importado el hook.
      expect(src, "no abre la invitación a Pro").toMatch(/pedirPro\(\)/)

      // El corte va ANTES del `sendMessage`, que es lo único que evita el viaje y el error crudo.
      const corte = src.indexOf("pedirPro()")
      const manda = src.indexOf("sendMessage(", src.indexOf("function enviar"))
      expect(corte, "el gate está después de mandar el mensaje").toBeLessThan(manda)
    },
  )
})
