/**
 * El onboarding se puede recorrer en los dos sentidos, y volver no pierde lo tecleado.
 *
 * ── QUÉ SE PROTEGE ────────────────────────────────────────────────────────────────────────────
 *
 * Pedido del cliente (24-ago): «flechas para devolverse (adelante/atrás) en el onboarding». El
 * wizard sólo avanzaba: quien se equivocaba en el horario del sábado o quería revisar un precio ya
 * escrito no tenía forma de volver salvo abandonar el onboarding y repetirlo desde Ayuda.
 *
 * La parte frágil no es la flecha — es que VOLVER NO PIERDA NADA. Eso es cierto sólo mientras el
 * estado de los pasos viva en el wizard y los pasos se pinten condicionalmente: así salir de un
 * paso no lo desmonta. El día que alguien baje ese estado a un componente hijo, o convierta cada
 * paso en su propia ruta, la flecha seguirá ahí y los horarios se borrarán al regresar — y nadie lo
 * notaría escribiendo el código, sólo un vet perdiendo lo que acababa de cargar.
 *
 * ES UN TEST QUE LEE EL FUENTE porque no hay tests de componentes acá y porque lo que se fija es
 * dónde vive una cosa, no qué pinta.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

const RUTA = "src/components/onboarding/welcome-wizard.tsx"

/** El fuente sin comentarios: la prosa de arriba nombra lo mismo que se busca abajo. */
const FUENTE = readFileSync(RUTA, "utf8")
  .split("\n")
  .filter((l) => {
    const t = l.trim()
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*")
  })
  .join("\n")

describe("las flechas del onboarding", () => {
  it("hay un control para volver y otro para avanzar", () => {
    expect(FUENTE).toContain('aria-label="Volver al paso anterior"')
    expect(FUENTE).toContain('aria-label="Ir al paso siguiente"')
  })

  it("navegan por ESTADO, no recargando la página", () => {
    // Una navegación real acá reventaría todo lo tecleado y, con una grabación del Modo Fantasma en
    // curso, dispararía el aviso de «¿salir del sitio?». Es la misma lección de
    // `navegacion-sin-recargar`.
    const flechas = FUENTE.slice(
      FUENTE.indexOf('aria-label="Volver al paso anterior"') - 400,
      FUENTE.indexOf('aria-label="Ir al paso siguiente"') + 400,
    )
    expect(flechas).toMatch(/setPaso\(\(p\) => Math\.max\(0, p - 1\)\)/)
    expect(flechas).toMatch(/setPaso\(\(p\) => Math\.min\(PASOS\.length - 1, p \+ 1\)\)/)
    expect(flechas).not.toContain("router.push")
    expect(flechas).not.toContain("window.location")
  })

  it("no se puede volver desde el primer paso ni avanzar desde el último", () => {
    expect(FUENTE).toContain("disabled={paso === P_CLINICA || busy}")
    expect(FUENTE).toContain("disabled={paso === P_CLINICA || paso === PASOS.length - 1 || busy}")
  })

  it("LA FLECHA DE ADELANTE NO SE SALTA EL PRIMER PASO", () => {
    // Los otros cinco son opcionales y el wizard ya los deja saltar de a uno con «Ahora no». Pero
    // sin la clínica guardada no hay contra qué colgar un horario ni un servicio: avanzar desde ahí
    // dejaría al vet cargando cosas que no se pueden guardar.
    const iSiguiente = FUENTE.indexOf('aria-label="Ir al paso siguiente"')
    const bloque = FUENTE.slice(iSiguiente - 400, iSiguiente)
    expect(bloque).toContain("paso === P_CLINICA")
  })

  it("las dos se apagan mientras algo se está guardando", () => {
    // Cambiar de paso a mitad de un guardado deja al vet mirando otra pantalla cuando llega el
    // resultado —o el error— del que acaba de dejar atrás.
    const iVolver = FUENTE.indexOf('aria-label="Volver al paso anterior"')
    const iSiguiente = FUENTE.indexOf('aria-label="Ir al paso siguiente"')
    for (const [nombre, i] of [
      ["volver", iVolver],
      ["siguiente", iSiguiente],
    ] as const) {
      expect(FUENTE.slice(i - 400, i), `la flecha de ${nombre}`).toContain("busy")
    }
  })
})

describe("volver no pierde lo tecleado", () => {
  it("EL ESTADO DE LOS PASOS VIVE EN EL WIZARD, no en los hijos", () => {
    // Ésta es la afirmación de fondo: los pasos se pintan condicionalmente, así que salir de uno no
    // lo desmonta MIENTRAS lo que se escribió viva acá arriba. Si mañana alguien mueve estos
    // `useState` a los componentes de cada paso, la flecha seguirá funcionando y los datos se
    // borrarán al regresar.
    for (const estado of [
      "const [dias, setDias]",
      "const [diasActivos, setDiasActivos]",
      "const [precios, setPrecios]",
      "const [ownerName, setOwnerName]",
      "const [ownerPhone, setOwnerPhone]",
      "const [petName, setPetName]",
    ]) {
      expect(FUENTE, `«${estado}» tiene que declararse en el wizard`).toContain(estado)
    }
  })

  it("los pasos se pintan condicionalmente en el mismo componente", () => {
    // `{paso === P_X && …}` es lo que mantiene vivo el estado del padre. Si esto se volviera una
    // ruta por paso, cada navegación arrancaría de cero.
    for (const paso of ["P_HORARIOS", "P_SERVICIOS", "P_PACIENTE", "P_EJEMPLO", "P_EQUIPO"]) {
      expect(FUENTE, `el paso ${paso}`).toContain(`paso === ${paso}`)
    }
  })
})
