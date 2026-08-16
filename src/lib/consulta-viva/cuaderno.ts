// El cuaderno de la consulta: el texto que el vet escribe MIENTRAS atiende.
//
// UNA SOLA FUENTE DE VERDAD, y ése es el cambio importante. El cuaderno se pinta en DOS lugares a la
// vez —la pantalla de la consulta y el panel flotante del Modo Fantasma— y antes cada uno tenía su
// propio `useState`. Con el panel abierto sobre la pantalla, escribir en uno no actualizaba el otro:
// sólo convergían al remontar. Dos cuadros de texto del mismo cuaderno mostrando cosas distintas.
//
// Ahora el texto vive acá y los componentes se suscriben. Es el mismo patrón que `sesion.ts`: la
// lógica en un `.ts` sin React —testeable con vitest, que corre en `environment: "node"`— y el
// puente a React en `usar-cuaderno.ts`.
//
// POR QUÉ UN MAPA Y NO UN ÚNICO ESTADO. La pantalla monta el cuaderno de la consulta de la URL y el
// panel el de la consulta que se está grabando, y no tienen por qué ser la misma. Con un solo estado
// global los dos se pisarían.

import { createClient } from "@/lib/supabase/client"

/** Cuánto se espera desde la última tecla antes de guardar. */
const ESPERA_MS = 1200

export type EstadoDelCuaderno = "limpio" | "escribiendo" | "guardando" | "guardado" | "error"

export type EntradaDeCuaderno = {
  texto: string
  estado: EstadoDelCuaderno
}

/**
 * La entrada que se devuelve cuando no hay consulta.
 *
 * Es una constante y no un objeto nuevo cada vez: `useSyncExternalStore` compara por REFERENCIA y
 * entra en bucle infinito si `getSnapshot` devuelve un objeto distinto en cada llamada.
 */
const VACIA: EntradaDeCuaderno = { texto: "", estado: "limpio" }

const entradas = new Map<string, EntradaDeCuaderno>()
/** Lo que quedó por guardar. Sobrevive al desmontaje del componente. */
const pendiente = new Map<string, string>()
const temporizadores = new Map<string, ReturnType<typeof setTimeout>>()
/** Consultas cuya lectura inicial ya se pidió, para no repetirla en cada montaje. */
const cargadas = new Set<string>()

const oyentes = new Set<() => void>()

function emitir(): void {
  for (const fn of oyentes) fn()
}

/** Reemplaza la entrada por un OBJETO NUEVO: es lo que hace que los suscriptos se enteren. */
function poner(consultaId: string, cambios: Partial<EntradaDeCuaderno>): void {
  const previa = entradas.get(consultaId) ?? VACIA
  entradas.set(consultaId, { ...previa, ...cambios })
  emitir()
}

async function guardarEnLaBase(consultaId: string, texto: string): Promise<void> {
  const { error } = await createClient()
    .from("consultations")
    .update({ notebook: texto, updated_at: new Date().toISOString() })
    .eq("id", consultaId)
  if (error) throw new Error(error.message)
}

export const cuaderno = {
  suscribir(fn: () => void): () => void {
    oyentes.add(fn)
    return () => {
      oyentes.delete(fn)
    }
  },

  /**
   * La entrada de una consulta. Devuelve SIEMPRE la misma referencia mientras nada cambie, que es
   * lo que `useSyncExternalStore` exige.
   */
  leer(consultaId: string | null): EntradaDeCuaderno {
    if (!consultaId) return VACIA
    return entradas.get(consultaId) ?? VACIA
  },

  /** En el servidor no hay cuaderno: no se ha escrito nada todavía. */
  leerEnServidor(): EntradaDeCuaderno {
    return VACIA
  },

  /**
   * Trae lo guardado, UNA sola vez por consulta.
   *
   * No pisa lo que ya haya en memoria: el vet pudo escribir y minimizar antes de que esta lectura
   * volviera, y sobrescribirlo con lo de la base sería borrarle lo que acaba de teclear.
   */
  async cargar(consultaId: string): Promise<void> {
    if (cargadas.has(consultaId)) return
    cargadas.add(consultaId)
    try {
      const { data } = await createClient()
        .from("consultations")
        .select("notebook")
        .eq("id", consultaId)
        .maybeSingle()
      const guardado = (data as { notebook: string | null } | null)?.notebook ?? ""
      if (guardado && !entradas.has(consultaId)) poner(consultaId, { texto: guardado })
    } catch (e) {
      // Sin cuaderno previo se sigue igual: el vet escribe y se guarda. Que la lectura falle no
      // puede impedir escribir.
      cargadas.delete(consultaId)
      console.error("[cuaderno] no se pudo leer lo guardado:", e)
    }
  },

  escribir(consultaId: string | null, texto: string): void {
    if (!consultaId) return
    poner(consultaId, { texto, estado: "escribiendo" })
    pendiente.set(consultaId, texto)

    const previo = temporizadores.get(consultaId)
    if (previo) clearTimeout(previo)
    temporizadores.set(
      consultaId,
      setTimeout(() => {
        temporizadores.delete(consultaId)
        void cuaderno.vaciar(consultaId)
      }, ESPERA_MS),
    )
  },

  /**
   * Guarda lo pendiente. Se llama por el temporizador y también al desmontar.
   *
   * Ante un fallo el texto VUELVE a la cola en vez de descartarse: el próximo guardado lo reintenta
   * y el aviso queda en pantalla. Es lo que hace que minimizar el panel a mitad de una frase, o
   * perder la red un segundo, no cuesten lo escrito.
   */
  async vaciar(consultaId: string): Promise<void> {
    const texto = pendiente.get(consultaId)
    if (texto === undefined) return
    pendiente.delete(consultaId)
    poner(consultaId, { estado: "guardando" })
    try {
      await guardarEnLaBase(consultaId, texto)
      poner(consultaId, { estado: "guardado" })
    } catch (e) {
      pendiente.set(consultaId, texto)
      poner(consultaId, { estado: "error" })
      console.error("[cuaderno] no se pudo guardar:", e)
    }
  },

  /** Cancela el guardado en espera de una consulta. Se usa al desmontar, antes de vaciar. */
  cancelarEspera(consultaId: string): void {
    const t = temporizadores.get(consultaId)
    if (t) {
      clearTimeout(t)
      temporizadores.delete(consultaId)
    }
  },
}

/** Sólo para los tests: devuelve el módulo a cero entre casos. */
export function _reiniciarCuaderno(): void {
  entradas.clear()
  pendiente.clear()
  for (const t of temporizadores.values()) clearTimeout(t)
  temporizadores.clear()
  cargadas.clear()
  oyentes.clear()
}
