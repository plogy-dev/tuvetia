/**
 * Toda página de `/admin` comprueba el permiso ANTES de consultar nada.
 *
 * ── EL INCIDENTE (24-ago, producción) ─────────────────────────────────────────────────────────
 *
 * El panel tenía su gate en `admin/layout.tsx` —`if (!isPlatformAdmin(...)) notFound()`— y el
 * comentario decía «todas las páginas hijas asumen este gate». No se podía asumir: una petición
 * ANÓNIMA a `/admin/usuarios` devolvía **404 con 66 KB de cuerpo y 23 correos reales adentro**.
 * `/admin/clinicas` y `/admin/costos` filtraban los nombres de las clínicas igual.
 *
 * En el App Router el layout y la página se renderizan EN PARALELO: el `notFound()` corta la
 * interfaz, pero la página ya corrió sus consultas —con `service_role`, que se salta la RLS— y sus
 * datos quedan serializados en la respuesta. **El 404 es de la pantalla, no de los datos.**
 *
 * Los docs de Next lo advierten: «This pattern is not recommended since Next.js applications have
 * multiple entry points, which will not prevent nested route segments and Server Actions from being
 * accessed.»
 *
 * ── POR QUÉ ESTE TEST MIRA TEXTO ──────────────────────────────────────────────────────────────
 *
 * Porque lo que hay que fijar es el ORDEN de dos líneas dentro de un componente de servidor, y eso
 * no se observa desde un test unitario: haría falta renderizar el árbol de Next contra una petición
 * sin sesión, que es la suite e2e y no ésta. Lo que sí se puede exigir barato es que la llamada
 * exista y que sea el PRIMER `await` del componente — si aparece después de una consulta, lo que se
 * filtra es justo el resultado de esa consulta.
 *
 * Una página nueva en `/admin` que se olvide de la guarda pone esto en rojo. Es la única defensa
 * automática que tiene: el layout ya demostró que no alcanza.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const GUARDA = "requerirAdminDePlataforma()"

function paginasDe(dir: string, out: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada)
    if (statSync(p).isDirectory()) paginasDe(p, out)
    else if (entrada === "page.tsx") out.push(p)
  }
  return out
}

const paginas = paginasDe("src/app/admin")

describe("el panel de plataforma se cierra en cada página, no sólo en el layout", () => {
  it("hay páginas que revisar (si esto falla, el escaneo dejó de mirar donde debe)", () => {
    expect(paginas.length).toBeGreaterThan(0)
  })

  it.each(paginas)("%s llama a la guarda", (pagina) => {
    expect(readFileSync(pagina, "utf8")).toContain(GUARDA)
  })

  // EL ORDEN ES LA MITAD DEL ARREGLO. Con la guarda después de un `await` de datos, la consulta ya
  // corrió y su resultado ya está en la respuesta: el `notFound()` llega tarde.
  it.each(paginas)("%s la llama ANTES de cualquier otro await", (pagina) => {
    const texto = readFileSync(pagina, "utf8")
    const cuerpo = texto.slice(texto.indexOf("export default async function"))
    const posGuarda = cuerpo.indexOf(GUARDA)
    const primerAwait = cuerpo.search(/await\s+(?!requerirAdminDePlataforma)/)

    expect(posGuarda, `${pagina}: la guarda no está en el componente`).toBeGreaterThan(-1)
    if (primerAwait !== -1) {
      expect(
        posGuarda,
        `${pagina}: hay un await de datos antes de la guarda — eso es exactamente lo que se filtró`,
      ).toBeLessThan(primerAwait)
    }
  })

  // El layout sigue teniendo su gate: es lo que hace que la NAVEGACIÓN muestre 404 en vez de un
  // panel a medio pintar. Las páginas lo repiten porque él solo no impide que los datos salgan.
  it("el layout conserva el suyo — los dos, no uno u otro", () => {
    expect(readFileSync("src/app/admin/layout.tsx", "utf8")).toContain("isPlatformAdmin")
  })
})
