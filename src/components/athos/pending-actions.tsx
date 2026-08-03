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

import { useCallback, useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { ActionApprovalCard, type ProposedAction } from "@/components/athos/action-approval-card"

export function PendingActions({ recargarToken }: { recargarToken?: number }) {
  const [supabase] = useState(() => createClient())
  const [acciones, setAcciones] = useState<ProposedAction[]>([])

  const cargar = useCallback(async () => {
    // Sin filtro por conversación a propósito: una propuesta que quedó colgada de otro hilo (o de
    // la bandeja) igual es algo que el vet tiene pendiente, y esconderla es cómo se pierde.
    const { data } = await supabase
      .from("athos_actions")
      .select("id, tool_name, summary, payload, status, created_at")
      .eq("status", "proposed")
      .order("created_at", { ascending: false })
      .limit(5)
    setAcciones((data ?? []) as unknown as ProposedAction[])
  }, [supabase])

  useEffect(() => {
    // `cargar()` es async: su `setAcciones` ocurre después de un await, nunca síncrono dentro del
    // effect. El compilador de React no traza a través del async y lo marca igual — falso positivo,
    // el mismo que ya está anotado en `dashboard/consultas/[id]/page.tsx`. Se silencia acá porque
    // era el único error de lint del repo y dejaba el CI en rojo para todos.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar()
  }, [cargar, recargarToken])

  if (acciones.length === 0) return null

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <span className="text-xs font-medium text-muted-foreground">
        {acciones.length === 1 ? "Tenés 1 propuesta sin aprobar" : `Tenés ${acciones.length} propuestas sin aprobar`}
      </span>
      {acciones.map((a) => (
        <ActionApprovalCard
          key={a.id}
          action={a}
          onResolved={(id) => setAcciones((prev) => prev.filter((x) => x.id !== id))}
        />
      ))}
    </div>
  )
}
