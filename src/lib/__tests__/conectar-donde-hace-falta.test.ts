/**
 * Conectar se hace donde uno se da cuenta de que falta conectar.
 *
 * EL CASO, dicho por David el 19-ago: para conectar WhatsApp había que irse hasta Integraciones.
 * Y el viaje era peor de lo que él describió — el botón de Comunicaciones decía "Conectar en
 * Configuración", pero el conector ya no vive ahí (se mudó a Conexiones), así que quien lo seguía
 * llegaba a una línea de estado y a OTRO enlace. Dos saltos para escanear un código.
 *
 * POR QUÉ UN TEST Y NO SÓLO EL ARREGLO. Este defecto no lo produjo un descuido: lo produjo una
 * MUDANZA. El conector cambió de sección y el enlace que apuntaba a la vieja siguió compilando,
 * siguió pintando un botón, y siguió llevando a una pantalla que existe. Nada falla. La única
 * manera de que se note es que alguien intente conectar — o esto.
 *
 * Lee el fuente porque no hay otra forma: `vitest` corre en `node` sobre `src/**\/*.test.ts` y esto
 * es una afirmación sobre qué monta una página, no sobre lo que devuelve una función.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const RAIZ = join(process.cwd(), "src")

/** Sin comentarios: los de esta misma página citan el enlace viejo como ejemplo de lo que no va. */
function leer(ruta: string): string {
  return readFileSync(join(RAIZ, ruta), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

const COMUNICACIONES = leer("app/dashboard/comunicaciones/page.tsx")

describe("conectar WhatsApp desde Comunicaciones", () => {
  it("el QR se escanea en la propia pantalla", () => {
    expect(COMUNICACIONES).toContain("WhatsappSettings")
  })

  it("no manda a otra sección a conectar", () => {
    // Cualquier enlace a Configuración o a Conexiones desde esta pantalla es el viaje que David
    // pidió quitar. Si algún día hace falta uno por otro motivo, este test es el lugar donde
    // justificarlo — no algo que se saltea.
    expect(COMUNICACIONES).not.toMatch(/href=["']\/dashboard\/(settings|conexiones)/)
  })

  it("es el MISMO componente que usa Conexiones, no una copia", () => {
    // El flujo de vinculación tiene consentimiento de integración no oficial, reintentos y tres
    // proveedores detrás (Meta, Kapso, Evolution). Dos implementaciones del mismo QR serían dos
    // que arreglar cada vez que Meta cambia algo — y la segunda se enteraría tarde.
    const importa = /import \{ WhatsappSettings \} from "@\/components\/settings\/whatsapp-settings"/
    expect(COMUNICACIONES).toMatch(importa)
    expect(leer("app/dashboard/conexiones/page.tsx")).toMatch(importa)
  })

  it("le pasa el estado real, no uno inventado", () => {
    // `pending` y `disconnected` NO son lo mismo que `none`, y el componente pinta distinto cada
    // uno: "Continuar conexión", "Reconectar", y el aviso de que los mensajes no están llegando.
    // Mandarle siempre `none` haría que un número desvinculado se vea como uno que nunca se
    // conectó — y el vet no se enteraría de que dejó de recibir mensajes.
    expect(COMUNICACIONES).toContain("initialStatus={")
    expect(COMUNICACIONES).toMatch(/initialStatus=\{[^}]*integration\?\.status/)
    expect(COMUNICACIONES).toContain("agent_mode")
  })
})
