/**
 * Los cuatro reportes de David sobre el Modo Fantasma, 26-ago 6:57 p.m. — «esto es crucial crucial,
 * es el core functionality».
 *
 * Textual: *"1: No hay transcripcion en vivo. 2: Uno deja de grabar y sale una vaina abajo a la
 * derecha que confunde al usuario y como que traba el app. 3: La transcripción no esta tan precisa.
 * 4: Es super agresivo y poco amigable, como de la nada salta a esta pantalla"*.
 *
 * Los cuatro tenían causa distinta y ninguna era la obvia. Este archivo vigila las tres que se
 * arreglaron en el front; la cuarta (precisión) vive en `athos-service` y es sobre todo modelo y
 * vocabulario, no estructura, así que no se vigila desde acá.
 *
 * ── POR QUÉ SON CERROJOS DE TEXTO Y NO DE RENDER ────────────────────────────────────────────────
 *
 * Lo que se protege son DECISIONES sobre dónde vive cada cosa —qué pantalla se muestra en qué fase,
 * en qué esquina caen los avisos, qué componente monta la transcripción— y eso se rompe editando
 * una condición, no interactuando. Un test de render pasaría igual con la condición vieja si nadie
 * simula justo la fase `subiendo`.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const RAIZ = join(process.cwd(), "src")

/** El archivo sin comentarios: si no, estos tests se aprueban solos leyendo su propia explicación. */
function leer(ruta: string): string {
  return readFileSync(join(RAIZ, ruta), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

describe("2 · la vaina de abajo a la derecha", () => {
  // Eran DOS cosas encimadas en la misma esquina, y por eso «confunde» y «traba» a la vez.

  it("el parámetro `?grabar=1` se consume de la URL, no sólo se lee", () => {
    // LA CAUSA DEL MENSAJE SIN SENTIDO. Mientras se graba, la pantalla devuelve el Cockpit y el
    // grabador SE DESMONTA; al acabar vuelve a montarse con su `useRef` de nuevo en falso y el
    // `?grabar=1` todavía puesto. Arrancaba otra vez sobre una consulta recién terminada: fila
    // duplicada en `consents` (evidencia legal, Ley 1581), y encima el error del cerrojo de sesión
    // única — «Ya estás grabando la consulta de X» — justo después de acabar de grabarla.
    //
    // El ref no alcanzaba porque el ref muere con la instancia y el problema ES la instancia nueva.
    // Lo que tiene que morir es la orden.
    const rec = leer("components/consultation-recorder.tsx")
    expect(rec).toContain('searchParams.delete("grabar")')
    expect(rec).toContain("replaceState")
  })

  it("y se borra sin navegar: `replaceState`, nunca `router.replace`", () => {
    // Es la misma ruta — no hay nada que navegar. Un `router.replace` volvería a renderizar el
    // árbol entero en el peor momento posible: mientras se sube el audio.
    const rec = leer("components/consultation-recorder.tsx")
    expect(rec).not.toMatch(/router\s*\.\s*replace/)
  })

  it("los avisos no caen sobre la burbuja de VetGPT", () => {
    // Sonner por defecto va abajo a la derecha, 356 px de ancho y sin `pointer-events: none` en su
    // contenedor. Ahí vive la burbuja (`athos-dock.tsx`, `bottom-4 right-4`): durante los 4 s de
    // cada aviso los clics no le llegaban. El app SÍ estaba trabado en esa esquina.
    const toaster = leer("components/ui/sonner.tsx")
    const dock = leer("components/athos/athos-dock.tsx")

    // El dock sigue abajo a la derecha — es la premisa, y si mañana se mueve este test lo dice.
    // (En móvil sube 5rem para no pisar la barra inferior, pero la esquina es la misma.)
    expect(dock).toContain("md:bottom-4 md:right-4")

    const posicion = toaster.match(/position=["']([a-z-]+)["']/)?.[1]
    expect(posicion, "el Toaster tiene que fijar `position` explícita").toBeTruthy()
    expect(posicion).not.toBe("bottom-right")
  })
})

describe("4 · «de la nada salta a esta pantalla»", () => {
  it("el cockpit acompaña el cierre en vez de desaparecer al soltar el botón", () => {
    // `detener()` emite `fase: "subiendo"` como su PRIMERA acción, antes de vaciar el buffer y
    // antes de subir un solo byte. Con la condición vieja (`fase === "grabando"` a secas) el
    // cockpit se iba en ese mismo tick y el editor SOAP VACÍO se pintaba de golpe.
    //
    // Incluir las dos fases de cierre es lo que hace cierta la promesa que el propio cockpit tenía
    // escrita: retirarse cuando la pantalla de siempre ya tiene el material.
    const pagina = leer("app/dashboard/consultas/[id]/page.tsx")
    const i = pagina.indexOf("cerrandoEsta")
    expect(i, "la pantalla tiene que distinguir la fase de cierre").toBeGreaterThan(-1)

    const condicion = pagina.slice(i, i + 260)
    expect(condicion).toContain('"subiendo"')
    expect(condicion).toContain('"transcribiendo"')
    // Y esas fases tienen que MOSTRAR el cockpit, no sólo estar nombradas.
    expect(pagina).toMatch(/grabandoEsta\s*=[\s\S]{0,120}cerrandoEsta/)
  })

  it("mientras se cierra no se ofrece pausar ni volver a acabar", () => {
    // No hay micrófono que pausar y ya se acabó. Dejarlos habilitados invita a apretar dos veces
    // algo irreversible y a leer otro error del cerrojo de sesión única.
    const cockpit = leer("components/athos/cockpit.tsx")
    expect(cockpit).toMatch(/\{\s*!cerrando\s*&&/)
  })
})

describe("1 · «no hay transcripción en vivo»", () => {
  it("la pestaña que se abre por defecto muestra el texto en vivo", () => {
    // La había —en la pestaña «Transcripción»— pero la que se abre es «Consulta», y ahí no se veía
    // una palabra. Peor: «Notas en vivo» tarda 20-30 s en decir algo, porque su disparador exige
    // 15 s Y 40 palabras nuevas estables. En el momento exacto en que el vet mira la pantalla para
    // confirmar que lo está escuchando, la pantalla no le contestaba.
    const cockpit = leer("components/athos/cockpit.tsx")

    // La pestaña por defecto sigue siendo «consulta»…
    const pagina = leer("app/dashboard/consultas/[id]/page.tsx")
    expect(pagina).toContain('useState<PestanaDelCockpit>("consulta")')

    // …y esa rama monta la tira.
    const i = cockpit.indexOf('pestana === "consulta"')
    expect(i).toBeGreaterThan(-1)
    const j = cockpit.indexOf('pestana === "sugerencias"')
    expect(cockpit.slice(i, j)).toContain("<TiraEnVivo")
  })

  it("cuando el vivo no está, la pantalla lo dice — no se queda callada", () => {
    // Fallaba en silencio: `sesion.ts` hace `console.info` y nada más. Una `DEEPGRAM_API_KEY`
    // ausente en el servidor se veía EXACTAMENTE IGUAL que una consulta en silencio, y el vet no
    // tenía forma de distinguir «no habló nadie» de «esto no está grabando nada».
    const cockpit = leer("components/athos/cockpit.tsx")
    expect(cockpit).toContain("no está disponible")
    // Y aclara que el audio igual se transcribe entero al final: es cierto, y es lo que evita que
    // alguien corte la grabación creyendo que se perdió.
    expect(cockpit).toMatch(/transcribe\s+completa|se transcribe completa al acabar/)
  })
})

describe("una sola superficie de grabación", () => {
  it("el grabador de la ficha no tiene una rama de grabación en curso", () => {
    // Tenía dos —«Grabando consulta» con su transcripción en vivo, y «Guardando el audio…»— y las
    // dos eran INALCANZABLES: su condición era palabra por palabra la misma que decide mostrar el
    // Cockpit, así que perdían siempre. Hacían creer que la transcripción en vivo tenía dónde
    // pintarse, y que había dos superficies de grabación compitiendo.
    const rec = leer("components/consultation-recorder.tsx")
    expect(rec).not.toContain("consultaViva.detener")
    expect(rec).not.toContain("Detener y transcribir")
  })
})
