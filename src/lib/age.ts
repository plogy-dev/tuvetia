// Edad del paciente — ÚNICA fuente de verdad para lista y ficha.
// Meses calendario reales (no 30.44 días/mes): en bordes como ~12 meses los dos algoritmos
// divergían y la lista podía decir "12 m" mientras la ficha decía "1 a".

export function ageInMonths(birth: string | null): number | null {
  if (!birth) return null
  const b = new Date(birth)
  if (Number.isNaN(b.getTime())) return null
  const now = new Date()
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth())
  if (now.getDate() < b.getDate()) months -= 1
  return months < 0 ? null : months
}

/** Formato corto para listados: "< 1 m", "6 m", "3 a". */
export function fmtAgeShort(birth: string | null): string {
  const months = ageInMonths(birth)
  if (months === null) return "—"
  if (months < 1) return "< 1 m"
  if (months < 12) return `${months} m`
  return `${Math.floor(months / 12)} a`
}

/** Formato largo para la ficha: "6 meses", "3 años", "3 a 4 m". */
export function fmtAgeLong(birth: string | null): string | null {
  const months = ageInMonths(birth)
  if (months === null) return null
  const years = Math.floor(months / 12)
  const rem = months % 12
  if (years === 0) return `${rem} ${rem === 1 ? "mes" : "meses"}`
  if (rem === 0) return `${years} ${years === 1 ? "año" : "años"}`
  return `${years} a ${rem} m`
}
