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

// ── El calendario, que es el mismo problema un mes después ──────────────────────────────────────
//
// El síntoma del calendario es peor que el de WhatsApp, porque no se ve: alguien agenda una cita,
// no le llega a ningún calendario, y la única señal era un toast DESPUÉS de guardar — cuando ya
// era tarde y con la solución en otra pantalla. Nadie va a Integraciones a resolver un problema que
// no sabe que tiene.
//
// Desde v5 la agenda se lo pide al entrar, y el botón lleva al consentimiento del proveedor
// directamente. Estos tests son sobre lo mismo que los de arriba: que el arreglo no se deshaga en
// una mudanza, porque un enlace que apunta a la pantalla vieja sigue compilando y sigue pintando un
// botón.
const AGENDA = leer("app/dashboard/calendario/page.tsx")
const AVISO = leer("components/calendar/aviso-conectar-calendario.tsx")

describe("conectar el calendario desde la agenda", () => {
  it("la agenda le pide el calendario a quien no lo tiene", () => {
    expect(AGENDA).toContain("AvisoConectarCalendario")
  })

  it("pregunta por el calendario de QUIEN MIRA, no por el del administrador", () => {
    // Es la diferencia entre v4 y v5, y equivocarse acá no rompe nada visible: un vet sin calendario
    // vería la ventana o no según lo que hubiera conectado su jefe.
    expect(AGENDA).toMatch(/estadoCalendario\(user\.id\)/)
  })

  it("el botón conecta de una vez, sin mandar a otra pantalla", () => {
    // Es lo que se pidió: "que lo dirija a conectarlo de una vez". Un enlace a Integraciones sería
    // exactamente el viaje que esta ventana viene a eliminar.
    expect(AVISO).toContain("useConexionDeCalendario")
    expect(AVISO).not.toMatch(/href=["']\/dashboard\/(settings|conexiones)/)
  })

  it("vuelve a la agenda después del consentimiento, no a Integraciones", () => {
    expect(AVISO).toMatch(/useConexionDeCalendario\("\/dashboard\/calendario"\)/)
  })

  it("es el MISMO camino de conexión que usa Integraciones, no una copia", () => {
    // Dos implementaciones del mismo consentimiento serían dos que arreglar cada vez que cambie el
    // contrato de Composio, y la segunda se enteraría tarde.
    // Se acepta el alias o el relativo: `calendar-settings.tsx` es vecino del módulo y lo importa
    // como `./conectar-calendario`, que es el estilo del resto de esa carpeta.
    const importa = /from "(@\/components\/settings|\.)\/conectar-calendario"/
    expect(AVISO).toMatch(importa)
    expect(leer("components/settings/calendar-settings.tsx")).toMatch(importa)
  })
})

describe("conectar el calendario desde Integraciones", () => {
  it("lo pueden conectar los dos roles, no sólo el administrador", () => {
    // Hasta v4 el formulario vivía dentro de un `{esAdministrador && ...}`: un vet abría la pantalla
    // y no tenía botón. Desde v5 el evento se crea en el calendario del vet asignado, así que
    // esconderlo dejaría a la mitad del equipo sin poder hacer lo único que hace falta hacer acá.
    const conexiones = leer("app/dashboard/conexiones/page.tsx")
    expect(conexiones).toContain("<CalendarSettings")
    expect(conexiones).not.toMatch(/\{esAdministrador && \(\s*<CalendarSettings/)
  })
})
