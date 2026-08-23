/**
 * Un embed de PostgREST entre dos tablas con MÁS DE UNA clave foránea tiene que nombrar cuál usa.
 *
 * ── EL INCIDENTE QUE LO ORIGINA (23-ago, producción) ──────────────────────────────────────────
 *
 * El layout del dashboard pasó de consultar `clinics` aparte a traerla embebida en el perfil, para
 * ahorrarse un viaje de red. La consulta quedó así:
 *
 *     .select("full_name, ..., clinic:clinics(name, logo_url, plan)")
 *
 * Y entre `profiles` y `clinics` hay DOS claves foráneas: `profiles.clinic_id` apunta a `clinics`, y
 * `clinics.owner_id` apunta a `profiles`. Con dos caminos posibles PostgREST no adivina: rechaza el
 * embed. Y como la consulta termina en `.single()`, ese rechazo NO se ve como un error — vuelve como
 * `data: null`. El perfil queda vacío, `estadoDeAcceso` lo lee como "sin onboarding", y el layout
 * redirige a /bienvenida. **La app entera dejó de abrir, para todos.**
 *
 * Nada lo detuvo antes de producción: compila, pasa el lint, pasan los 1.640 tests y el build sale
 * limpio. Vive sólo en la conversación entre PostgREST y el esquema.
 *
 * La forma correcta ya estaba escrita en el repo — `clinica-de-la-sesion.ts` traía
 * `clinic:clinics!profiles_clinic_id_fkey(plan)` — y la pista se perdió al copiar el patrón.
 *
 * ── POR QUÉ ESTE TEST MIRA TEXTO, QUE NORMALMENTE ES MALA IDEA ────────────────────────────────
 *
 * Porque la alternativa es no tener nada. Un cliente de Supabase falso devuelve lo que se le diga y
 * nunca va a reproducir una ambigüedad de relaciones; hacerlo de verdad pide una base con el esquema
 * cargado, que es la suite del backend y no ésta. Lo único observable desde acá es el `select`.
 *
 * ── ALCANCE: `clinics`, NO TODOS LOS EMBEDS ───────────────────────────────────────────────────
 *
 * Estos son los pares con más de una FK en el esquema, consultados el 23-ago:
 *
 *     appointments ↔ profiles        (3: vet_id, created_by, calendar_owner_id)
 *     clinics ↔ profiles             (2: profiles.clinic_id, clinics.owner_id)   ← el del incidente
 *     athos_actions ↔ profiles       (2: created_by, reviewed_by)
 *     clinical_notes ↔ profiles      (2: approved_by, locked_by)
 *     email_integrations ↔ profiles  (2: created_by, user_id)
 *     email_messages ↔ profiles      (2: sent_by, user_id)
 *     human_tasks ↔ profiles         (2: created_by, resolved_by)
 *     glossary_relation ↔ glossary_term  (2: from_term, to_term)
 *     catalog_items ↔ service_consumptions (2: service_id, component_id)
 *
 * Para regenerar la lista:
 *
 *     with pares as (select least(conrelid::regclass::text, confrelid::regclass::text) a,
 *                           greatest(conrelid::regclass::text, confrelid::regclass::text) b
 *                    from pg_constraint where contype='f' and connamespace='public'::regnamespace)
 *     select a, b, count(*) from pares group by 1,2 having count(*) > 1;
 *
 * El test exige la pista SÓLO en los embeds de `clinics`, que es el par que rompió la app y el único
 * de la lista que hoy se embebe en código. Los demás pares existen pero nadie los embebe todavía;
 * ampliar el cerrojo cuando alguien lo haga es trabajo de ese momento, no de un test que hoy
 * marcaría en rojo una docena de consultas que funcionan.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

function archivosDe(dir: string, out: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada)
    if (statSync(p).isDirectory()) archivosDe(p, out)
    else if (/\.tsx?$/.test(entrada)) out.push(p)
  }
  return out
}

describe("embeds de PostgREST sobre relaciones ambiguas", () => {
  const archivos = [...archivosDe("src/app"), ...archivosDe("src/lib")].filter(
    (f) => !f.includes("__tests__"),
  )

  it("todo embed de `clinics` nombra por qué clave embebe", () => {
    const infractores: string[] = []

    for (const archivo of archivos) {
      for (const [i, linea] of readFileSync(archivo, "utf8").split("\n").entries()) {
        // Los comentarios no consultan nada: `clinica-de-la-sesion.ts` menciona la forma corta en
        // prosa para explicarla, y marcarla sería ruido que enseña a ignorar este test.
        const limpia = linea.trim()
        if (limpia.startsWith("//") || limpia.startsWith("*") || limpia.startsWith("/*")) continue
        // `algo:clinics(` sin un `!clave` entre la tabla y el paréntesis.
        for (const m of limpia.matchAll(/([a-z_][a-z0-9_]*):clinics(!?\w*)\(/gi)) {
          if (!m[2].startsWith("!")) {
            infractores.push(`${archivo}:${i + 1}  ${m[0]}  → falta !profiles_clinic_id_fkey`)
          }
        }
      }
    }

    expect(
      infractores,
      "Entre `profiles` y `clinics` hay dos claves foráneas: sin nombrar cuál, PostgREST rechaza " +
        "el embed y con `.single()` eso se ve como un perfil vacío, no como un error. Es lo que " +
        "tumbó el dashboard el 23-ago:\n" +
        infractores.join("\n"),
    ).toEqual([])
  })

  // El sitio exacto donde ocurrió, fijado aparte: si alguien reescribe esa consulta, que tenga que
  // borrar este test a mano y enterarse de por qué existe.
  it("el layout del dashboard, que fue el que rompió, la tiene", () => {
    expect(readFileSync("src/app/dashboard/layout.tsx", "utf8")).toContain(
      "clinic:clinics!profiles_clinic_id_fkey(",
    )
  })
})
