/**
 * Tuvetia instalada en el teléfono: la cáscara y el contrato del alcance lite.
 *
 * ── LO QUE SE PROTEGE ───────────────────────────────────────────────────────────────────────────
 *
 * La instalabilidad depende de piezas que no fallan en tests de unidad: un manifest que Next sirve
 * por convención de archivo, PNGs que iOS exige aunque el manifest declare SVGs, y una línea de
 * viewport que ENCIENDE código ya escrito. Ninguna revienta el build si falta — fallan en el
 * teléfono del vet, semanas después. Por eso cerrojos.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import manifest from "@/app/manifest"
import { ALCANCE_LITE, FUERA_DEL_LITE, exclusionDe } from "@/lib/movil/lite"

const RAIZ = process.cwd()

describe("el manifiesto", () => {
  const m = manifest()

  it("abre en la agenda, sin barra de navegador", () => {
    // `start_url` queda CLAVADA en cada teléfono instalado: cambiarla después no actualiza los
    // accesos existentes. Que este test falle es el momento de pensarlo dos veces.
    expect(m.start_url).toBe("/dashboard/calendario")
    expect(m.display).toBe("standalone")
  })

  it("cada icono declarado existe como archivo", () => {
    // El manifest puede declarar lo que quiera; iOS y Android piden los bytes. Un 404 acá es un
    // icono genérico en la pantalla de inicio y nadie se entera hasta instalar.
    for (const icono of m.icons ?? []) {
      expect(existsSync(join(RAIZ, "public", icono.src)), `falta ${icono.src}`).toBe(true)
    }
    expect((m.icons ?? []).some((i) => i.purpose === "maskable")).toBe(true)
  })

  it("los colores son los tokens de la marca, no inventos", () => {
    expect(m.background_color).toBe("#ffffff")
    expect(m.theme_color).toBe("#0c1613") // --tv-graphite, el tile del icono
  })

  it("el proxy no intercepta el manifiesto", () => {
    // `.webmanifest` está excluido del matcher desde antes de que el archivo existiera. Si alguien
    // «limpia» esa exclusión, el manifest pasa por el chequeo de sesión y la instalación muere
    // con una redirección a /login.
    const proxy = readFileSync(join(RAIZ, "src", "proxy.ts"), "utf8")
    expect(proxy).toContain("webmanifest")
  })
})

describe("la cáscara del layout", () => {
  const layout = readFileSync(join(RAIZ, "src", "app", "layout.tsx"), "utf8")

  it("viewportFit cover — la línea que enciende la safe-area ya escrita", () => {
    // `tab-bar-movil.tsx` y `athos-dock.tsx` usan env(safe-area-inset-*) desde hace semanas y
    // valía CERO siempre: sin `viewport-fit=cover` el navegador no expone los insets. Quitar esta
    // línea deja la barra inferior debajo del indicador de gestos del iPhone, sin error alguno.
    expect(layout).toContain('viewportFit: "cover"')
  })

  it("el apple-icon está declarado y existe", () => {
    // iOS ignora los icons del manifest para «Añadir a pantalla de inicio»: sin este PNG el icono
    // instalado es una captura de la página en un marco.
    expect(layout).toContain("apple-icon-180.png")
    expect(existsSync(join(RAIZ, "public", "icons", "apple-icon-180.png"))).toBe(true)
  })
})

describe("el alcance lite dice, no esconde", () => {
  it("toda exclusión lleva su razón, en frase completa", () => {
    // La razón ES el producto de este módulo: sin ella, la exclusión vuelve a ser una función que
    // desaparece y parece rota.
    for (const e of FUERA_DEL_LITE) {
      expect(e.razon.length, `${e.nombre} necesita una razón de verdad`).toBeGreaterThan(40)
      expect(e.razon).toContain("computador")
    }
    expect(ALCANCE_LITE.length).toBeGreaterThan(0)
  })

  it("facturación se cubre por ruta; grabar no, porque su sección SÍ entra", () => {
    expect(exclusionDe("/dashboard/facturacion/inventario")?.nombre).toContain("facturación")
    // Ver consultas y leer notas ES «consultar»: la exclusión del Fantasma es la ACCIÓN de grabar,
    // no la sección — cubrirla por ruta taparía pantallas que el alcance promete.
    expect(exclusionDe("/dashboard/consultas")).toBeNull()
    expect(exclusionDe("/dashboard/calendario")).toBeNull()
  })

  it("el login instalado tiene el canje del código de 6 dígitos", () => {
    // Sin `verifyOtp`, el enlace del correo abre en Safari y la sesión queda AFUERA de la app:
    // el vet instala, no puede entrar, y concluye que no sirve. Es el bloqueante que hace cierta
    // la frase «conectada a la cuenta del vet».
    const login = readFileSync(join(RAIZ, "src", "components", "login-form.tsx"), "utf8")
    expect(login).toContain("verifyOtp")
    // Y el campo le pide al sistema el autocompletado del código que llegó por correo.
    expect(login).toContain('autoComplete="one-time-code"')
  })
})

describe("las instrucciones de instalar no se rompen antes del paso 2", () => {
  /**
   * ── «NO ES CLARO AÚN» (Felipe, 27-ago) ────────────────────────────────────────────────────────
   *
   * Tres cosas hacían fallar al vet ANTES de llegar al segundo paso, y ninguna se decía:
   *
   *   1. El primer paso lo mandaba a abrir la URL EN LA QUE YA ESTABA leyendo.
   *   2. En iPhone fuera de Safari no hay nada que hacer —«Añadir a pantalla de inicio» no existe
   *      en Chrome ni Firefox de iOS— y eso viajaba entre paréntesis. Seguía los tres pasos, no
   *      encontraba el botón, y concluía que la app no funciona.
   *   3. Nadie contaba que al abrir el icono la app pide entrar otra vez. Eso se lee como que la
   *      instalación falló.
   */
  const tarjeta = readFileSync(
    join(process.cwd(), "src", "components", "movil", "instalar-app.tsx"),
    "utf8",
  )
  const sinComentarios = tarjeta
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

  it("distingue Safari de los otros navegadores de iPhone", () => {
    // En iOS todos los navegadores usan WebKit y dicen «Safari» en su UA: lo que los delata es su
    // propia marca. Sin esto, Chrome de iPhone recibe pasos que no puede seguir.
    expect(sinComentarios).toMatch(/CriOS/)
    expect(sinComentarios).toMatch(/FxiOS/)
    expect(sinComentarios).toContain("ios-otro")
  })

  it("y en ese caso NO da pasos: avisa", () => {
    const i = sinComentarios.indexOf('plataforma === "ios-otro"')
    expect(i, "no existe la rama del navegador equivocado").toBeGreaterThan(-1)
    const rama = sinComentarios.slice(i, i + 900)
    expect(rama).toMatch(/sólo Safari|solo Safari/i)
    // Lo importante es que no cargue la culpa en el producto: es una limitación de iOS.
    expect(rama).toMatch(/de iOS|limitación de Tuvetia/i)
  })

  it("ningún paso empieza mandando a abrir la URL en la que ya estás", () => {
    // El vet lee esto DESDE el teléfono, en la app. «Abrí tuvetia.vercel.app» ya está cumplido, y
    // leerlo hace dudar de si uno está en el lugar correcto.
    const i = sinComentarios.indexOf("const PASOS")
    const bloque = sinComentarios.slice(i, sinComentarios.indexOf("}", sinComentarios.indexOf("android:")) + 400)
    expect(bloque).not.toMatch(/Abrí .*\.app|Abrí .*\.com/)
  })

  it("cada paso dice DÓNDE está el botón, no sólo cuál es", () => {
    // «Tocá el botón Compartir» no ayuda a quien no sabe cuál es. El `donde` es el arreglo.
    expect(sinComentarios).toMatch(/donde\?: string/)
    expect(sinComentarios).toMatch(/barra de ABAJO/i)
  })

  it("dice qué pasa al abrir el icono la primera vez", () => {
    // La app instalada abre en su propia sesión: no hereda la del navegador.
    expect(sinComentarios).toMatch(/c[oó]digo de seis d[ií]gitos/i)
  })

  it("desde el computador no da pasos que no se pueden seguir ahí", () => {
    const i = sinComentarios.indexOf('plataforma === "escritorio"')
    expect(i, "no existe la rama de escritorio").toBeGreaterThan(-1)
    expect(sinComentarios.slice(i, i + 900)).toMatch(/desde el tel[eé]fono/i)
  })

  it("el QR lo genera el servidor, no el cliente", () => {
    // `qrcode` pesa; meterlo al bundle por una imagen que se mira una vez sería caro. La tarjeta lo
    // recibe ya renderizado.
    expect(sinComentarios).toMatch(/qrSvg\?: string \| null/)
    expect(sinComentarios).not.toMatch(/from ["']qrcode["']/)
    const pagina = readFileSync(
      join(process.cwd(), "src", "app", "dashboard", "administracion", "clinica", "page.tsx"),
      "utf8",
    )
    expect(pagina).toMatch(/QRCode\.toString\(/)
    // Y un fallo generándolo no puede tumbar Configuración entera.
    expect(pagina).toMatch(/\.catch\(\(\) => null\)/)
  })
})
