// Edad del paciente — ÚNICA fuente de verdad para lista y ficha.
// Meses calendario reales (no 30.44 días/mes): en bordes como ~12 meses los dos algoritmos
// divergían y la lista podía decir "12 m" mientras la ficha decía "1 a".
//
// ── POR QUÉ NO SE CONSTRUYE UN `Date` CON LA FECHA DE NACIMIENTO ──────────────────────────────
//
// `birth_date` es una columna DATE: PostgREST la devuelve como "2026-03-01", y un string así
// **se parsea como UTC por especificación**. `new Date("2026-03-01").getMonth()` da 2 en el
// servidor (UTC) y 1 en el navegador de un vet en Bogotá (UTC-5), donde ese instante todavía es el
// 28 de febrero a las 19:00.
//
// Y esa diferencia rompía justamente lo que este archivo viene a garantizar: la LISTA es un
// componente de cliente y la FICHA uno de servidor, así que el mismo gatito podía figurar con
// 6 meses en una y 5 en la otra. Medido: nacido el 2026-03-01, mirado el 2026-08-29, la lista
// decía 6 m y la realidad —y la ficha— eran 5 m. En un cachorro eso no es cosmética: la edad en
// meses es lo que ordena el plan de vacunación.
//
// La cura es no dejar que ninguna zona toque la fecha: se parten los tres números del string. Y
// "hoy" se pide en Bogotá, que es la zona del negocio, para que las dos mitades comparen contra el
// mismo día.
//
// Es el mismo defecto que ya se corrigió en `due_date` y en `expires_on`. Éste es el tercero.

import { bogotaTodayISO } from "@/lib/date-utils"

/** Los tres números de un "YYYY-MM-DD" (tolera un timestamp completo). `null` si no lo es. */
function partes(fecha: string): [number, number, number] | null {
  const n = fecha.slice(0, 10).split("-").map(Number)
  if (n.length !== 3 || n.some((x) => !Number.isFinite(x))) return null
  return [n[0], n[1], n[2]]
}

export function ageInMonths(birth: string | null, hoyISO: string = bogotaTodayISO()): number | null {
  if (!birth) return null
  const nacio = partes(birth)
  const hoy = partes(hoyISO)
  if (!nacio || !hoy) return null
  const [by, bm, bd] = nacio
  const [hy, hm, hd] = hoy
  let months = (hy - by) * 12 + (hm - bm)
  if (hd < bd) months -= 1
  return months < 0 ? null : months
}

/** Formato corto para listados: "< 1 m", "6 m", "3 a". */
export function fmtAgeShort(birth: string | null, hoyISO?: string): string {
  const months = ageInMonths(birth, hoyISO)
  if (months === null) return "—"
  if (months < 1) return "< 1 m"
  if (months < 12) return `${months} m`
  return `${Math.floor(months / 12)} a`
}

/** Formato largo para la ficha: "6 meses", "3 años", "3 a 4 m". */
export function fmtAgeLong(birth: string | null, hoyISO?: string): string | null {
  const months = ageInMonths(birth, hoyISO)
  if (months === null) return null
  const years = Math.floor(months / 12)
  const rem = months % 12
  if (years === 0) return `${rem} ${rem === 1 ? "mes" : "meses"}`
  if (rem === 0) return `${years} ${years === 1 ? "año" : "años"}`
  return `${years} a ${rem} m`
}
