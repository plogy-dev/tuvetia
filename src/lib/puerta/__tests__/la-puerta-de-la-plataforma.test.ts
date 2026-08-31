/**
 * La puerta de la plataforma, la mitad que se puede probar sin base.
 *
 * Lo que NO se puede probar acá está dicho para que no se confunda con cobertura: el corte de
 * verdad —«sin pase no se aprovisiona clínica»— vive en `private.ensure_clinic_membership` y en
 * `public.create_clinic` (migración 0100), o sea en Postgres. Esto cubre la otra mitad: que el
 * código que el vet teclea y el que el servidor compara sean SIEMPRE el mismo, y que un código
 * apagado, vencido o agotado no pase por ninguno de los dos lados.
 *
 * `normalizarCodigo` es la que más importa de todas y es la más aburrida: se ejecuta en el campo
 * del formulario Y en las dos server actions, y el día que las dos versiones dejen de coincidir el
 * síntoma es un vet mirando un código correcto que "no existe".
 */
import { describe, expect, it } from "vitest"

import {
  FORMA_DEL_CODIGO,
  MOTIVOS,
  type CodigoDeAcceso,
  enlaceDelCodigo,
  generarCodigo,
  normalizarCodigo,
  veredictoDelCodigo,
} from "@/lib/puerta"

const AHORA = new Date("2026-08-30T12:00:00Z")

const codigo = (parche: Partial<CodigoDeAcceso> = {}): CodigoDeAcceso => ({
  codigo: "VETS2026",
  dias: 7,
  max_usos: 25,
  usos: 0,
  expira_en: null,
  activo: true,
  ...parche,
})

describe("normalizarCodigo — el mismo código de los dos lados", () => {
  it("sube a mayúsculas: el vet teclea en minúscula y el enlace viene en mayúscula", () => {
    expect(normalizarCodigo("vets2026")).toBe("VETS2026")
  })

  it("se traga los espacios de pegar desde un mensaje", () => {
    // Es el caso real: el código llega por WhatsApp y se copia con el espacio de al lado.
    expect(normalizarCodigo("  VETS 2026 ")).toBe("VETS2026")
  })

  it("descarta lo que no sobrevive a dictar un código por teléfono", () => {
    expect(normalizarCodigo("vets_2026!")).toBe("VETS2026")
  })

  it("conserva el guion, que sí es parte del alfabeto", () => {
    expect(normalizarCodigo("demo-bogota")).toBe("DEMO-BOGOTA")
  })

  it("no explota con vacío ni con null", () => {
    expect(normalizarCodigo("")).toBe("")
    expect(normalizarCodigo(null)).toBe("")
    expect(normalizarCodigo(undefined)).toBe("")
  })

  it("corta en 32, que es el tope de la columna", () => {
    // Sin el corte, un pegado largo llega a la base y la rebota con un error de constraint que el
    // vet no puede interpretar.
    expect(normalizarCodigo("A".repeat(50))).toHaveLength(32)
  })
})

describe("veredictoDelCodigo — las cuatro formas de no servir", () => {
  it("uno recién creado sirve", () => {
    expect(veredictoDelCodigo(codigo(), AHORA)).toEqual({ sirve: true })
  })

  it("el que no existe se distingue del que existe y está apagado", () => {
    // Los dos motivos mandan al vet a hacer cosas distintas: uno a revisar lo que escribió, el otro
    // a pedir uno nuevo. Un "código inválido" para los dos obliga a adivinar.
    expect(veredictoDelCodigo(null, AHORA)).toEqual({ sirve: false, motivo: "no-existe" })
    expect(veredictoDelCodigo(codigo({ activo: false }), AHORA)).toEqual({
      sirve: false,
      motivo: "desactivado",
    })
  })

  it("vence al llegar la fecha, no después", () => {
    const justo = codigo({ expira_en: AHORA.toISOString() })
    expect(veredictoDelCodigo(justo, AHORA)).toEqual({ sirve: false, motivo: "vencido" })

    const manana = codigo({ expira_en: "2026-08-31T00:00:00Z" })
    expect(veredictoDelCodigo(manana, AHORA)).toEqual({ sirve: true })
  })

  it("se agota EN el tope, no pasándolo", () => {
    // El off-by-one acá regala un cupo por código. Con `max_usos = 5` repartido a cinco clínicas,
    // entra una sexta que nadie invitó.
    expect(veredictoDelCodigo(codigo({ usos: 24, max_usos: 25 }), AHORA)).toEqual({ sirve: true })
    expect(veredictoDelCodigo(codigo({ usos: 25, max_usos: 25 }), AHORA)).toEqual({
      sirve: false,
      motivo: "agotado",
    })
  })

  it("cada motivo tiene su mensaje, y ninguno queda mudo", () => {
    for (const fila of [
      null,
      codigo({ activo: false }),
      codigo({ expira_en: "2026-01-01T00:00:00Z" }),
      codigo({ usos: 99, max_usos: 1 }),
    ]) {
      const v = veredictoDelCodigo(fila, AHORA)
      expect(v.sirve).toBe(false)
      if (!v.sirve) expect(MOTIVOS[v.motivo]).toBeTruthy()
    }
  })
})

describe("generarCodigo — el que se dicta por teléfono", () => {
  it("sale con la forma que la base acepta", () => {
    // La migración tiene el MISMO check. Si esta prueba pasa y la base rechaza, es que las dos
    // expresiones se desincronizaron.
    for (let i = 0; i < 50; i++) {
      expect(FORMA_DEL_CODIGO.test(generarCodigo())).toBe(true)
    }
  })

  it("no usa letras que se confundan al leerlas en voz alta", () => {
    // O/0, I/1 y L son la mitad de los "me pasaste mal el código".
    const muchos = Array.from({ length: 200 }, () => generarCodigo("")).join("")
    expect(muchos).not.toMatch(/[O0I1L]/)
  })

  it("respeta el prefijo, para los códigos con nombre", () => {
    expect(generarCodigo("DEMO", () => 0)).toMatch(/^DEMO[A-Z2-9]{6}$/)
  })
})

describe("enlaceDelCodigo — lo que se comparte", () => {
  it("apunta a /signup con el código puesto", () => {
    expect(enlaceDelCodigo("https://tuvetia.vercel.app", "vets2026")).toBe(
      "https://tuvetia.vercel.app/signup?codigo=VETS2026",
    )
  })

  it("no duplica la barra cuando el origen viene con una", () => {
    // `window.location.origin` no la trae, pero una env configurada a mano sí puede — y `//signup`
    // es una ruta que no existe.
    expect(enlaceDelCodigo("https://tuvetia.vercel.app/", "VETS2026")).toBe(
      "https://tuvetia.vercel.app/signup?codigo=VETS2026",
    )
  })
})
