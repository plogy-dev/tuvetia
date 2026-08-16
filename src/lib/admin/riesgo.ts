// El orden en que conviene REVISAR las cuentas.
//
// PARA QUÉ. El acta pide una revisión manual "ordenada por riesgo". Hoy la tabla de /admin/usuarios
// sale por fecha de alta, que responde "quién llegó último" — una pregunta distinta de "a quién
// tengo que mirar". Con 17 cuentas da igual; con 300 el orden ES la revisión, porque nadie baja
// hasta el final.
//
// QUÉ NO ES ESTO. No es un detector de fraude y no decide nada: no desactiva, no avisa, no bloquea.
// Sólo reordena una tabla que una persona va a leer igual. Esa persona sigue tomando la decisión.
//
// LO QUE ESTE PUNTAJE NO PUEDE VER, y conviene tenerlo presente antes de confiar en él:
//
//   · El consumo de IA. Vive en `athos_agent_usage` y está agregado POR CLÍNICA, no por usuario, así
//     que "esta persona quema tokens" no es una pregunta que estos datos contesten. Eso se mira en
//     /admin/uso y /admin/costos.
//   · Correos parecidos entre sí, o el mismo dominio repetido. Es la señal de multicuenta que pide
//     el acta y sale de comparar usuarios ENTRE SÍ, no de mirar uno solo. Queda para después.
//   · La IP. Depende de la retención de `auth.audit_log_entries`, sin verificar.
//
// Es decir: esto ordena por señales de cuenta, no de abuso. Es la primera capa.

import type { PlatformUser } from "@/lib/admin/users"

/** Días sin entrar a partir de los cuales una cuenta cuenta como dormida. */
export const DIAS_PARA_DORMIDA = 60

export type SeñalDeRiesgo = "nunca-entro" | "sin-clinica" | "sin-correo" | "dormida"

export const ETIQUETA_SEÑAL: Record<SeñalDeRiesgo, string> = {
  "nunca-entro": "nunca entró",
  "sin-clinica": "sin clínica",
  "sin-correo": "sin correo",
  dormida: `+${DIAS_PARA_DORMIDA} días sin entrar`,
}

/**
 * Peso de cada señal. Los números son ORDINALES, no una probabilidad: sirven para ordenar y no
 * significan nada por separado.
 *
 * "Nunca entró" pesa más que todo lo demás porque es la única que aparece SIEMPRE en un registro
 * automatizado — y también en un onboarding roto, que es la otra cosa que hay que mirar. En ambos
 * casos la respuesta correcta es la misma: revisarla.
 */
const PESO: Record<SeñalDeRiesgo, number> = {
  "nunca-entro": 4,
  "sin-clinica": 3,
  "sin-correo": 2,
  dormida: 1,
}

function diasDesde(iso: string | null, ahora: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (ahora.getTime() - t) / 86_400_000
}

/** Qué llama la atención de esta cuenta. Vacío = nada que mirar. */
export function señalesDe(u: PlatformUser, ahora: Date = new Date()): SeñalDeRiesgo[] {
  const s: SeñalDeRiesgo[] = []

  if (u.nuncaEntro) s.push("nunca-entro")
  // Registrarse y no quedar en ninguna clínica: el usuario no llegó a ninguna parte. Puede ser una
  // invitación a medias o una cuenta creada sólo para tenerla.
  if (u.clinics.length === 0) s.push("sin-clinica")
  if (!u.email) s.push("sin-correo")

  // "Dormida" sólo aplica a quien SÍ entró alguna vez: para el resto ya está "nunca entró", y
  // contar las dos sería contar el mismo hecho dos veces.
  if (!u.nuncaEntro) {
    const d = diasDesde(u.lastSignInAt, ahora)
    if (d !== null && d >= DIAS_PARA_DORMIDA) s.push("dormida")
  }

  return s
}

/** Suma de los pesos. Más alto = antes en la lista. */
export function puntajeDe(u: PlatformUser, ahora: Date = new Date()): number {
  return señalesDe(u, ahora).reduce((n, s) => n + PESO[s], 0)
}

/**
 * La lista ordenada para revisar, sin mutar la original.
 *
 * LAS DESACTIVADAS VAN AL FONDO, incluso si acumulan señales. Ya se actuó sobre ellas: dejarlas
 * arriba llenaría la cabecera de la tabla con el trabajo ya hecho, que es exactamente lo que hace
 * que una lista de revisión se deje de leer.
 *
 * A igual puntaje manda la fecha de alta, más nueva primero — que es el orden que la tabla tenía y
 * el que se espera cuando no hay nada que distinga a dos filas.
 */
export function ordenarPorRiesgo(users: PlatformUser[], ahora: Date = new Date()): PlatformUser[] {
  return [...users].sort((a, b) => {
    const desactivadaA = a.isActive === false ? 1 : 0
    const desactivadaB = b.isActive === false ? 1 : 0
    if (desactivadaA !== desactivadaB) return desactivadaA - desactivadaB

    const dif = puntajeDe(b, ahora) - puntajeDe(a, ahora)
    if (dif !== 0) return dif

    return (a.createdAt ?? "") < (b.createdAt ?? "") ? 1 : -1
  })
}
