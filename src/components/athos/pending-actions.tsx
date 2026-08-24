"use client"

// Propuestas de Athos que siguen esperando aprobación, mostradas SIEMPRE en el chat.
//
// POR QUÉ EXISTE. Las tarjetas que aparecen mientras Athos responde viven solo en ese streaming:
// `turnoAGuardar` (lib/athos-agent/conversacion.ts) persiste únicamente el TEXTO del turno, no las
// tool parts. Al recargar el hilo quedaba la frase "aprobálo en la tarjeta" y ninguna tarjeta —
// la propuesta seguía viva en `athos_actions`, pero era invisible. El vet no tenía forma de saber
// dónde estaba, ni de aprobarla.
//
// Esto lo lee de la fuente de verdad (la tabla), así que sobrevive a recargas, a cerrar el chat y a
// cambiar de conversación.

import { useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { ActionApprovalCard, type ProposedAction } from "@/components/athos/action-approval-card"

export function PendingActions({
  recargarToken,
  excluir,
}: {
  recargarToken?: number
  /** action_id que ya están pintados inline en el hilo vivo: no se repiten acá. */
  excluir?: Set<string>
}) {
  const [supabase] = useState(() => createClient())
  const [acciones, setAcciones] = useState<ProposedAction[]>([])

  useEffect(() => {
    // `vivo` evita pintar la respuesta de una consulta que quedó en el aire después de desmontar —
    // pasa al cambiar de conversación mientras la anterior todavía cargaba.
    let vivo = true
    // Sin filtro por conversación a propósito: una propuesta que quedó colgada de otro hilo (o de
    // la bandeja) igual es algo que el vet tiene pendiente, y esconderla es cómo se pierde.
    supabase
      .from("athos_actions")
      .select("id, tool_name, summary, payload, status, created_at")
      .eq("status", "proposed")
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (vivo) setAcciones((data ?? []) as unknown as ProposedAction[])
      })
    return () => {
      vivo = false
    }
    // Sin `void cargar()` en un useCallback: así el setState queda visiblemente detrás del `.then`
    // y el compilador de React no lo marca. La alternativa que había —silenciar la regla con un
    // eslint-disable— dejaba en pie el otro problema: pintar la respuesta de una consulta que
    // quedó en el aire después de desmontar, que es lo que evita `vivo`.
  }, [supabase, recargarToken])

  // No repetir las que ya están pintadas inline en el hilo vivo (mismo action_id).
  const visibles = excluir ? acciones.filter((a) => !excluir.has(a.id)) : acciones
  if (visibles.length === 0) return null

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <span className="text-xs font-medium text-muted-foreground">
        {visibles.length === 1 ? "Tenés 1 propuesta sin aprobar" : `Tenés ${visibles.length} propuestas sin aprobar`}
      </span>
      {visibles.map((a) => (
        <ActionApprovalCard
          key={a.id}
          action={a}
          onResolved={(id) => setAcciones((prev) => prev.filter((x) => x.id !== id))}
        />
      ))}
    </div>
  )
}
