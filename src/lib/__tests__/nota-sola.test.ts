/**
 * La nota del Fantasma se pide sola — y nadie puede volver a dejarla esperando un clic.
 *
 * ── POR QUÉ ESTE CERROJO EXISTE ───────────────────────────────────────────────────────────────
 *
 * `generating_note` acumuló consultas colgadas DOS veces: 4 el 22-ago (se arregló la etiqueta) y
 * 6 el 25-ago, tres de ellas posteriores a ese arreglo. La lección medida es que un paso que sólo
 * avanza a mano se queda quieto, así que la generación pasó a dispararse al abrir la consulta.
 *
 * La regresión probable no es borrar la función: es que un refactor de `load()` la deje de llamar
 * — compila igual, la pantalla se ve igual, y las consultas vuelven a colgarse en silencio hasta
 * que alguien mida la base otra vez. Por eso la segunda mitad escanea la pantalla.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { laGrabacionNoCapturoNada, laNotaSePideSola } from "@/lib/consultas/nota-sola"

describe("cuándo se pide sola", () => {
  it("transcrita y sin nota: se pide", () => {
    expect(
      laNotaSePideSola({ status: "generating_note", hayTranscripcion: true, hayNota: false }),
    ).toBe(true)
  })

  it("con nota ya hecha, jamás — pisaría lo que el vet pudo haber editado", () => {
    expect(
      laNotaSePideSola({ status: "generating_note", hayTranscripcion: true, hayNota: true }),
    ).toBe(false)
    expect(laNotaSePideSola({ status: "review", hayTranscripcion: true, hayNota: true })).toBe(false)
  })

  it("sin transcripción no hay de dónde generar", () => {
    expect(
      laNotaSePideSola({ status: "generating_note", hayTranscripcion: false, hayNota: false }),
    ).toBe(false)
  })

  it("abrir una consulta sin grabar no dispara nada", () => {
    // `open` es el estado de la consulta recién creada: entrar a mirarla no puede costar una
    // llamada de IA sobre nada.
    expect(laNotaSePideSola({ status: "open", hayTranscripcion: false, hayNota: false })).toBe(false)
    expect(laNotaSePideSola({ status: "transcribing", hayTranscripcion: false, hayNota: false })).toBe(
      false,
    )
  })
})

describe("una grabación en blanco no se queda callada", () => {
  /**
   * ── LA CUARTA VUELTA SOBRE EL MISMO ATASCO ───────────────────────────────────────────────────
   *
   * Los tres arreglos anteriores —dos de etiqueta, uno de automatización— dejaron el mismo hueco:
   * la automatización se apoya en `laNotaSePideSola`, que exige transcripción, y una transcripción
   * VACÍA no cuenta. Con razón: pedirle un SOAP a un texto en blanco es lo que producía las notas
   * que se disculpaban por no tener información.
   *
   * Pero al apagarse la condición no quedaba NADA: ni nota, ni error, ni cambio de estado, y la
   * lista siguiendo con «se genera al abrirla». Medido el 27-ago: cuatro de las nueve colgadas eran
   * de éstas, con audio de 6 a 26 segundos y una fila de transcripción en blanco detrás.
   *
   * Las dos ramas tienen que cubrir todo el espacio: o se genera, o se dice por qué no.
   */
  it("audio subido, transcripción en blanco: se nombra la situación", () => {
    const foto = {
      status: "generating_note",
      hayTranscripcion: false,
      hayNota: false,
      transcripcionVacia: true,
    }
    expect(laGrabacionNoCapturoNada(foto)).toBe(true)
    // Y sigue SIN pedirse la nota: no hay nada que resumir. Las dos cosas a la vez es el arreglo.
    expect(laNotaSePideSola(foto)).toBe(false)
  })

  it("no se confunde con «todavía no se transcribió»", () => {
    // Sin fila de transcripción el flujo sigue su curso: el backend todavía puede escribirla.
    expect(
      laGrabacionNoCapturoNada({
        status: "generating_note",
        hayTranscripcion: false,
        hayNota: false,
        transcripcionVacia: false,
      }),
    ).toBe(false)
  })

  it("con texto de verdad no aplica: eso se genera", () => {
    const foto = {
      status: "generating_note",
      hayTranscripcion: true,
      hayNota: false,
      transcripcionVacia: false,
    }
    expect(laGrabacionNoCapturoNada(foto)).toBe(false)
    expect(laNotaSePideSola(foto)).toBe(true)
  })

  it("con nota ya hecha no se anuncia ningún fallo", () => {
    expect(
      laGrabacionNoCapturoNada({
        status: "generating_note",
        hayTranscripcion: false,
        hayNota: true,
        transcripcionVacia: true,
      }),
    ).toBe(false)
  })

  it("las dos ramas son excluyentes y cubren el estado entero", () => {
    // Lo que dejó las cuatro muertas fue justamente un hueco entre las dos. Se recorren las cuatro
    // combinaciones posibles dentro de `generating_note` sin nota: ninguna puede quedar sin rama, y
    // ninguna puede caer en las dos.
    for (const hayTranscripcion of [true, false]) {
      for (const transcripcionVacia of [true, false]) {
        const foto = { status: "generating_note", hayNota: false, hayTranscripcion, transcripcionVacia }
        const genera = laNotaSePideSola(foto)
        const avisa = laGrabacionNoCapturoNada(foto)
        expect(genera && avisa, `ambas para ${JSON.stringify(foto)}`).toBe(false)
        // El único hueco legítimo es «todavía no hay fila»: ahí el backend sigue trabajando.
        const esperandoAlBackend = !hayTranscripcion && !transcripcionVacia
        expect(genera || avisa || esperandoAlBackend, `hueco en ${JSON.stringify(foto)}`).toBe(true)
      }
    }
  })
})

describe("la pantalla de consulta la usa de verdad", () => {
  const fuente = readFileSync(
    join("src", "app", "dashboard", "consultas", "[id]", "page.tsx"),
    "utf8",
  )
    // Los comentarios de este repo narran lo que el código hace: sin quitarlos, el test se
    // satisface a sí mismo leyendo la prosa. Cuarta vez que un escáner se muerde la cola así.
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")

  it("load() decide con la función y dispara generate", () => {
    const i = fuente.indexOf("laNotaSePideSola(")
    expect(i, "la pantalla ya no consulta laNotaSePideSola: las consultas vuelven a colgarse").toBeGreaterThan(-1)
    // La LLAMADA («void generate(»), no cualquier «generate(»: a 300 caracteres el escáner
    // alcanzaba la DECLARACIÓN `async function generate(` que viene después del useCallback, y un
    // mutante que reemplazó la llamada por un console.log pasó el test entero. Verificado.
    expect(fuente.slice(i, i + 300)).toContain("void generate(")
  })

  it("con una guarda de un solo intento — un fallo del servicio no puede ser un bucle", () => {
    expect(fuente).toContain("autoPedida.current = true")
  })

  it("y el botón manual sigue existiendo como reintento", () => {
    expect(fuente).toContain("Generar sugerencia (Modo Fantasma)")
  })
})

describe("y la pantalla saca a la consulta del limbo", () => {
  const fuente = readFileSync(
    join("src", "app", "dashboard", "consultas", "[id]", "page.tsx"),
    "utf8",
  )
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")

  it("distingue la grabación en blanco en vez de ofrecer un botón que no puede funcionar", () => {
    // Antes, con transcripción vacía, la pantalla ofrecía «Generar sugerencia A PARTIR DE LA
    // TRANSCRIPCIÓN»: la única acción disponible era la que no podía servir.
    expect(fuente).toContain("laGrabacionNoCapturoNada(")
    expect(fuente).toContain("La grabación no capturó voz")
  })

  it("«Grabar de nuevo» devuelve el estado a open, y no sólo abre el panel", () => {
    // Sin esto la consulta sigue colgada en `generating_note` para siempre y la LISTA sigue
    // prometiendo «se genera al abrirla». Las nueve del 27-ago llevaban hasta seis días así.
    const i = fuente.indexOf("async function volverAGrabar")
    expect(i, "no existe la salida: la consulta se queda colgada").toBeGreaterThan(-1)
    const cuerpo = fuente.slice(i, i + 700)
    expect(cuerpo).toContain('status: "open"')
    expect(cuerpo).toContain("from(\"consultations\")")
  })

  it("y si ese cambio de estado falla, se dice", () => {
    // Un fallo silencioso acá devuelve exactamente el defecto: la consulta reaparece colgada
    // mañana y nadie sabe por qué.
    const i = fuente.indexOf("async function volverAGrabar")
    expect(fuente.slice(i, i + 900)).toContain("toast.error")
  })
})
