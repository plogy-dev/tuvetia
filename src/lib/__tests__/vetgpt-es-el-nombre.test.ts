/**
 * De cara al usuario, el asistente se llama VetGPT. Por dentro sigue llamándose athos.
 *
 * ── LA DECISIÓN (25-ago, David) ───────────────────────────────────────────────────────────────
 *
 * «cambiemosle el nombre del athos a VetGPT». Alcance: primero la app (25-ago) y desde el 26-ago
 * TAMBIÉN la landing («vetgpt también en landing sí» — Felipe). NADA interno se toca: rutas
 * (`/api/athos`), tablas (`athos_messages`), carpetas, componentes (`AthosWidget`) y variables de
 * entorno — renombrarlas es riesgo puro sin nada que el usuario vea.
 *
 * ── LA EXCEPCIÓN CON NOMBRE PROPIO ────────────────────────────────────────────────────────────
 *
 * `landing/Nosotros.tsx` queda FUERA a propósito: ahí «Athos» no es el producto — es el bulldog
 * francés del fundador, la historia de origen de la empresa («Athos existe»). Renombrar al perro
 * en su propia historia sería reescribir el pasado de la marca.
 *
 * ── POR QUÉ EL CERROJO ────────────────────────────────────────────────────────────────────────
 *
 * Un renombre de 239 sitios no se rompe deshaciéndose: se rompe de a uno, cuando alguien copia un
 * texto viejo de un comentario o de la landing. Este test barre las superficies visibles y
 * denuncia al archivo exacto.
 *
 * El truco del patrón: `\bAthos\b` con mayúscula NO coincide con `AthosWidget`, `athos-widget`,
 * `/api/athos` ni `ATHOS_AGENT` — los identificadores quedan libres. Los comentarios se quitan
 * antes de buscar: hablan de internals y pueden decir lo que quieran.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, sep } from "node:path"

import { describe, expect, it } from "vitest"

/** Las superficies que el usuario de una clínica ve. Fuera: landing, /admin, docs, tests. */
const SUPERFICIES = [
  "src/app/dashboard",
  "src/app/bienvenida",
  "src/components/athos",
  "src/components/settings",
  "src/components/planes",
  "src/components/onboarding",
  "src/components/patient",
  "src/components/whatsapp",
  "src/components/calendar",
  "src/components/consultas",
  "src/lib/athos-agent/system-prompt.ts",
  "src/lib/athos.ts",
  "src/lib/planes/index.ts",
  "src/lib/tablero/widgets.ts",
  "src/components/site-header.tsx",
  "src/components/app-sidebar.tsx",
  "src/components/tab-bar-movil.tsx",
  "src/components/nav-main.tsx",
  // La landing (26-ago). Nosotros.tsx NO está: es la historia del perro, ver el encabezado.
  "src/components/subpages",
  "src/app/(marketing)",
]

/** El único archivo donde «Athos» es un nombre propio y se queda. */
const LA_HISTORIA_DEL_PERRO = "src/components/landing/Nosotros.tsx"

function archivos(ruta: string): string[] {
  const st = statSync(ruta)
  if (st.isFile()) return /\.tsx?$/.test(ruta) ? [ruta] : []
  return readdirSync(ruta, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "__tests__") return []
    return archivos(join(ruta, e.name))
  })
}

const sinComentarios = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")

describe("el nombre de cara al usuario", () => {
  it("ninguna superficie visible vuelve a decir «Athos»", () => {
    const culpables: string[] = []
    for (const raiz of [...SUPERFICIES, "src/components/landing"]) {
      for (const f of archivos(raiz)) {
        if (f.split(sep).join("/").endsWith(LA_HISTORIA_DEL_PERRO)) continue
        const codigo = sinComentarios(readFileSync(f, "utf8"))
        if (/\bAthos\b/.test(codigo)) culpables.push(f.split(sep).join("/"))
      }
    }
    expect(culpables, "estos archivos volvieron a nombrar Athos en texto visible").toEqual([])
  })

  it("el modelo se presenta como VetGPT", () => {
    // El prompt del sistema es cómo el asistente habla de sí mismo: si acá dice Athos, lo dirá en
    // cada respuesta aunque toda la UI diga otra cosa.
    const prompt = readFileSync("src/lib/athos-agent/system-prompt.ts", "utf8")
    expect(prompt).toContain("VetGPT")
  })

  it("el avatar de cada respuesta es el glifo de Tuvetia, no la chispa", () => {
    // «en vez de una estrella debe ser el logo de tuvetia» — la burbuja flotante ya estaba
    // (protegida por lo-que-se-usa-adelante); estos son los DOS avatares de la pantalla grande:
    // el de cada mensaje y el del estado pensando.
    const asistente = readFileSync("src/app/dashboard/asistente/assistant.tsx", "utf8")
    const glifos = asistente.match(/<BrandGlyph className="size-3\.5" fill="currentColor" \/>/g)
    expect(glifos?.length ?? 0, "el avatar del hilo perdió el glifo de marca").toBeGreaterThanOrEqual(2)
  })

  it("el perro se llama Athos y así se queda", () => {
    // La historia de origen no se reescribe: si un renombre masivo pisa Nosotros.tsx, esto lo
    // delata antes de que la landing cuente la vida de un perro que no existió.
    const nosotros = readFileSync(LA_HISTORIA_DEL_PERRO, "utf8")
    expect(nosotros).toContain("Athos")
    expect(nosotros).not.toContain("VetGPT, mi Bulldog")
  })

  it("lo interno NO se renombró — eso era riesgo sin nada que ver", () => {
    // El anti-objetivo, fijado: si alguien «completa» el renombre tocando la tabla o la carpeta,
    // este caso lo frena antes de que la migración rompa producción.
    const agente = readFileSync("src/app/api/athos/agent/route.ts", "utf8")
    expect(agente).toContain("athos_messages")
    expect(readFileSync("src/app/dashboard/asistente/assistant.tsx", "utf8")).toContain(
      "/api/athos/agent",
    )
  })
})
