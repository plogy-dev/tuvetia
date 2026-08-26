/**
 * De cara al usuario, el asistente se llama VetGPT. Por dentro sigue llamándose athos.
 *
 * ── LA DECISIÓN (25-ago, David) ───────────────────────────────────────────────────────────────
 *
 * «cambiemosle el nombre del athos a VetGPT». Alcance acordado: SÓLO la app — los textos del
 * dashboard, el prompt del sistema (cómo se presenta el modelo) y los mensajes de error que el
 * usuario lee. La landing pública sigue diciendo Athos hasta que se decida la marca de cara al
 * mercado, y NADA interno se toca: rutas (`/api/athos`), tablas (`athos_messages`), carpetas,
 * componentes (`AthosWidget`) y variables de entorno — renombrarlas es riesgo puro sin nada que
 * el usuario vea.
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
]

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
    for (const raiz of SUPERFICIES) {
      for (const f of archivos(raiz)) {
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
