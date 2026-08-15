"use client"

// El cuaderno de la consulta: el texto que el vet escribe MIENTRAS atiende.
//
// POR QUÉ ES UN MÓDULO Y NO ESTADO DE UN COMPONENTE. El cuaderno se escribe desde dos lugares —el
// panel flotante del Modo Fantasma y la pantalla de la consulta— y el panel SE DESMONTA al
// minimizarlo (`PanelModoFantasma` devuelve null cuando está cerrado). Con el estado dentro del
// componente, minimizar mientras se escribe perdía lo tecleado desde el último guardado.
//
// Por eso el guardado pendiente se vacía en el desmontaje, y el texto se conserva en memoria del
// módulo mientras la pestaña viva: reabrir el panel muestra lo último escrito sin esperar a la red.

import { useCallback, useEffect, useRef, useState } from "react"

import { createClient } from "@/lib/supabase/client"

/** Cuánto se espera desde la última tecla antes de guardar. */
const ESPERA_MS = 1200

export type EstadoDelCuaderno = "limpio" | "escribiendo" | "guardando" | "guardado" | "error"

/**
 * Última versión conocida por consulta, viva mientras la pestaña lo esté.
 *
 * Sirve para dos cosas: que reabrir el panel no muestre un cuadro vacío mientras la lectura viaja,
 * y que el vaciado del desmontaje sepa qué escribir sin depender del estado de un componente que
 * ya no existe.
 */
const enMemoria = new Map<string, string>()

/** Lo que quedó por guardar cuando el componente se fue. Se vacía en el próximo tick. */
const pendiente = new Map<string, string>()

async function guardar(consultaId: string, texto: string): Promise<void> {
  const { error } = await createClient()
    .from("consultations")
    .update({ notebook: texto, updated_at: new Date().toISOString() })
    .eq("id", consultaId)
  if (error) throw new Error(error.message)
}

/**
 * Vacía lo pendiente de una consulta. Se llama al desmontar y no se espera: el componente ya se
 * está yendo, y bloquear su desmontaje por una petición de red congelaría la interfaz.
 *
 * Si falla, el texto se queda en `enMemoria`, así que reabrir el panel lo muestra y el siguiente
 * guardado lo reintenta. No se pierde por un fallo de red.
 */
function vaciar(consultaId: string): void {
  const texto = pendiente.get(consultaId)
  if (texto === undefined) return
  pendiente.delete(consultaId)
  void guardar(consultaId, texto).catch((e) => {
    console.error("[cuaderno] no se pudo guardar al cerrar:", e)
    pendiente.set(consultaId, texto)
  })
}

/**
 * El cuaderno de una consulta, con autoguardado.
 *
 * `consultaId` en null (no hay consulta viva) devuelve un cuaderno inerte: sin lecturas, sin
 * escrituras y con el texto vacío.
 */
export function useCuaderno(consultaId: string | null) {
  const [texto, setTexto] = useState<string>(() =>
    consultaId ? (enMemoria.get(consultaId) ?? "") : "",
  )
  const [estado, setEstado] = useState<EstadoDelCuaderno>("limpio")
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Lectura inicial. Sólo pisa lo que haya en memoria si la base trae algo: el vet pudo haber
  // escrito y minimizado antes de que esta lectura volviera, y sobrescribirlo con lo de la base
  // sería borrarle lo que acaba de teclear.
  useEffect(() => {
    if (!consultaId) return
    let vivo = true
    void createClient()
      .from("consultations")
      .select("notebook")
      .eq("id", consultaId)
      .maybeSingle()
      .then(({ data }) => {
        if (!vivo) return
        const guardado = (data as { notebook: string | null } | null)?.notebook ?? ""
        if (!enMemoria.has(consultaId) && guardado) {
          enMemoria.set(consultaId, guardado)
          setTexto(guardado)
        }
      })
    return () => {
      vivo = false
    }
  }, [consultaId])

  // Al desmontar: cancelar el temporizador y vaciar lo pendiente. Es lo que hace que minimizar el
  // panel a mitad de una frase no pierda nada.
  //
  // Depende de `consultaId` y no de `[]`: así también vacía al CAMBIAR de consulta. Con `[]` la
  // limpieza sólo corría al desmontar, y para entonces el id ya era el de la consulta nueva —
  // lo pendiente de la anterior no se guardaba nunca. El cierre captura el id de su propio render,
  // que es justamente el que hay que vaciar.
  useEffect(() => {
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
      if (consultaId) vaciar(consultaId)
    }
  }, [consultaId])

  const escribir = useCallback(
    (nuevo: string) => {
      setTexto(nuevo)
      if (!consultaId) return
      enMemoria.set(consultaId, nuevo)
      pendiente.set(consultaId, nuevo)
      setEstado("escribiendo")
      if (temporizador.current) clearTimeout(temporizador.current)
      temporizador.current = setTimeout(() => {
        const porGuardar = pendiente.get(consultaId)
        if (porGuardar === undefined) return
        pendiente.delete(consultaId)
        setEstado("guardando")
        void guardar(consultaId, porGuardar)
          .then(() => setEstado("guardado"))
          .catch((e) => {
            console.error("[cuaderno] no se pudo guardar:", e)
            // Vuelve a la cola: el próximo guardado lo reintenta y el aviso queda en pantalla.
            pendiente.set(consultaId, porGuardar)
            setEstado("error")
          })
      }, ESPERA_MS)
    },
    [consultaId],
  )

  return { texto, escribir, estado }
}
