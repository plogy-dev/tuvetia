// Cómo se LEE el cupo de IA de la clínica. Sin `server-only` a propósito: lo consumen el riel de
// la conversación y la tira móvil, que viajan al navegador.
//
// La decisión de CORTAR vive en `athos-agent/presupuesto.ts`, que sí es de servidor y es el único
// que habla con la base. Acá sólo está la clasificación que decide qué se pinta — y está separada
// porque el umbral se necesitaba en dos lugares y se había escrito dos veces con formas distintas
// (`>= 0.85` en el riel, `<= 0.15` en la tira). Dos escrituras de la misma regla es la manera
// estándar de que dentro de un mes digan cosas distintas.

/** Lo que la interfaz necesita saber del cupo. Subconjunto de `Presupuesto`. */
export type CupoVisible = {
  tope: number | null
  usadas: number
  restantes: number | null
  reinicia: string
}

export type EstadoCupo =
  /** No hay tope configurado: no se pinta NADA. Es el estado de hoy en todas las clínicas. */
  | "sin-tope"
  /** Sobra cupo. La cifra alcanza; no se gasta espacio en una barra. */
  | "holgado"
  /** Queda poco: se muestra la barra y la fecha de reinicio. */
  | "escaso"
  /** Se acabó. */
  | "agotado"

/**
 * A partir de qué punto se avisa.
 *
 * 15% y no 5%: el aviso sirve si todavía queda margen para hacer algo —espaciar el uso, pedir
 * ampliación— y al 5% ya no se puede reaccionar. Con un tope de 500 son 75 consultas de aviso.
 */
export const UMBRAL_ESCASO = 0.15

export function estadoDelCupo(p: CupoVisible | null | undefined): EstadoCupo {
  if (!p || p.tope === null || p.restantes === null) return "sin-tope"
  if (p.restantes === 0) return "agotado"
  // Un tope de 0 con restantes 0 ya salió arriba; acá `tope` es > 0 y la división es segura.
  if (p.tope > 0 && p.restantes / p.tope <= UMBRAL_ESCASO) return "escaso"
  return "holgado"
}

/**
 * Qué fracción del cupo se gastó, entre 0 y 1 — el ancho de la barra.
 *
 * Topada en 1 porque la cuenta va un turno atrás y una clínica puede pasarse por unas pocas
 * llamadas: una barra al 103% se sale de su caja.
 */
export function proporcionUsada(p: CupoVisible): number {
  if (p.tope === null) return 0
  if (p.tope === 0) return 1
  return Math.min(1, Math.max(0, p.usadas / p.tope))
}
