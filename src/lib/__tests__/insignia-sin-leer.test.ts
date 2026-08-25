/**
 * El aviso de mensajes sin leer.
 *
 * ── QUÉ SE PROTEGE ────────────────────────────────────────────────────────────────────────────
 *
 * Hasta el 24-ago no había NINGUNA señal de que llegó un mensaje: había que entrar a Comunicaciones
 * y mirar. Un vet con un paciente delante no entra a mirar, así que un titular podía escribir a las
 * 9 y que nadie lo viera hasta la tarde.
 *
 * Lo frágil de este aviso no es que aparezca — es DÓNDE se cuenta y CÓMO se mantiene. Las tres
 * decisiones de abajo son las que alguien puede deshacer de buena fe:
 *
 *   1. Contar en el LAYOUT en vez de en el cliente. Es lo obvio y le agregaría un viaje de red a
 *      TODAS las pantallas del dashboard —que se midió en 1.023 ms y al que se le sacaron dos a
 *      mano— para pintar un número que interesa en una.
 *   2. INCREMENTAR en vez de recontar. Parece más barato y se desincroniza solo: la bandeja marca
 *      de a muchos, puede haber dos pestañas, y un evento perdido deja el número mal para siempre.
 *   3. Olvidar la puesta al día en `SUBSCRIBED`. Realtime pierde eventos con el socket caído y no
 *      los reenvía: sin recontar al reconectar, el número se queda viejo hasta recargar.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

const sinComentarios = (ruta: string) =>
  readFileSync(ruta, "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")

const INSIGNIA = sinComentarios("src/components/comunicaciones/insignia-sin-leer.tsx")
const NAV = sinComentarios("src/components/nav-main.tsx")
const LAYOUT = sinComentarios("src/app/dashboard/layout.tsx")

describe("qué se cuenta", () => {
  it("los ENTRANTES sin leer, y nada más", () => {
    // Un saliente sin `read_at` es lo normal —el titular todavía no lo abrió— y contarlo pondría un
    // aviso permanente que nadie puede bajar.
    expect(INSIGNIA).toContain('.eq("direction", "inbound")')
    expect(INSIGNIA).toContain('.is("read_at", null)')
  })

  it("con `head: true`: se pide el número, no las filas", () => {
    expect(INSIGNIA).toContain('count: "exact", head: true')
  })
})

describe("dónde se cuenta", () => {
  it("EN EL CLIENTE, NUNCA EN EL LAYOUT DEL DASHBOARD", () => {
    // El layout se midió en 1.023 ms y se le sacaron dos viajes a mano. Contar ahí devolvería uno,
    // y a todas las pantallas — para un número que interesa en una.
    expect(LAYOUT).not.toContain("whatsapp_messages")
    expect(INSIGNIA).toContain('"use client"')
  })

  it("el aviso cuelga del ítem de Comunicaciones y de ningún otro", () => {
    // Un número que no está pegado a su destino obliga a adivinar de qué habla.
    expect(NAV).toContain("RUTA_COMUNICACIONES")
    expect(NAV).toContain("InsigniaSinLeer")
  })
})

describe("cómo se mantiene al día", () => {
  it("SE RECUENTA, no se incrementa", () => {
    // Sumar y restar se desincroniza solo y no se arregla nunca. Un recuento siempre da la verdad.
    expect(INSIGNIA).not.toMatch(/setSinLeer\(\s*\(?\w*\)?\s*=>\s*\w+\s*[+-]\s*1/)
    expect(INSIGNIA).toContain("setSinLeer(count ?? 0)")
  })

  it("se pone al día en cada SUBSCRIBED, que es el primero y el de cada reconexión", () => {
    const i = INSIGNIA.indexOf(".subscribe(")
    expect(i).toBeGreaterThan(-1)
    expect(INSIGNIA.slice(i, i + 200)).toContain('"SUBSCRIBED"')
  })

  it("escucha INSERT y UPDATE: llegar y ser leído son las dos cosas que mueven el número", () => {
    expect(INSIGNIA).toContain('event: "INSERT"')
    expect(INSIGNIA).toContain('event: "UPDATE"')
  })

  it("con espera, porque abrir una conversación marca muchos de una", () => {
    // Sin debounce, leer veinte mensajes dispara veinte recuentos.
    expect(INSIGNIA).toContain("ESPERA_MS")
    expect(INSIGNIA).toContain("clearTimeout")
  })

  it("no escribe estado después de desmontarse", () => {
    // La consulta es asíncrona y la barra se desmonta al salir del dashboard.
    const i = INSIGNIA.indexOf("let vivo = true")
    expect(i).toBeGreaterThan(-1)
    expect(INSIGNIA).toContain("if (vivo) setSinLeer")
    expect(INSIGNIA).toContain("vivo = false")
  })
})

describe("la barra colapsada", () => {
  it("sigue avisando, con un punto", () => {
    // Colapsarla es lo que hace el vet para tener más sitio, o sea cuando está trabajando: apagar
    // el aviso justo ahí sería apagarlo cuando más importa.
    expect(INSIGNIA).toContain("group-data-[collapsible=icon]:block")
    expect(INSIGNIA).toContain("group-data-[collapsible=icon]:hidden")
  })
})
