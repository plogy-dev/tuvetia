"use client"

import * as React from "react"
import { HeartPulse } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { contratarPlan } from "@/lib/planes-salud/actions"
import { formatCOP } from "@/lib/facturacion/format"
import type { PlanDelPaciente } from "@/lib/planes-salud/consultas"

// El plan de salud en la ficha del paciente: qué tiene y qué le queda.
//
// ── POR QUÉ VA ACÁ Y NO SÓLO EN ADMINISTRACIÓN ────────────────────────────────────────────────
//
// En administración se DEFINEN los planes; acá se ve el de este animal. Son dos preguntas
// distintas y las hace gente distinta: la primera la hace el dueño de la clínica una vez, la
// segunda la hace quien atiende, cada vez.
//
// Y es donde se contrata, porque contratar un plan es algo que pasa mirando a un paciente concreto.
// Sin esta tarjeta, `contratarPlan` sería una acción sin puerta — justo lo que el cerrojo de
// pantallas huérfanas existe para impedir.

export function PlanDelPacienteCard({
  patientId,
  plan,
  planesDisponibles,
  puedeContratar,
}: {
  patientId: string
  plan: PlanDelPaciente | null
  planesDisponibles: { id: string; name: string; price_cents: number; months: number }[]
  puedeContratar: boolean
}) {
  const router = useRouter()
  const [enviando, setEnviando] = React.useState(false)
  const [elegido, setElegido] = React.useState("")

  async function onContratar() {
    if (!elegido) return
    setEnviando(true)
    try {
      const r = await contratarPlan({ patientId, planId: elegido })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Plan contratado")
      setElegido("")
      router.refresh()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <HeartPulse className="size-4 text-muted-foreground" /> Plan de salud
        {plan && !plan.vigente && <Badge variant="outline">Vencido</Badge>}
      </div>

      {plan ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{plan.planNombre}</span>
            <span className="text-xs text-muted-foreground">
              {plan.desde} → {plan.hasta}
            </span>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {plan.cobertura.map((c) => (
              <li key={c.catalogItemId} className="flex justify-between gap-2">
                <span className="min-w-0 truncate text-muted-foreground">{c.nombre}</span>
                <span
                  className={
                    "shrink-0 tabular-nums " + (c.restantes === 0 ? "text-fg-faint" : "text-fg")
                  }
                >
                  {c.restantes} de {c.incluidas}
                </span>
              </li>
            ))}
          </ul>
          {!plan.vigente && (
            <p className="mt-3 text-xs text-muted-foreground">
              La vigencia terminó: lo que quede ya no se cubre. Se puede contratar otro.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Este paciente no tiene plan de salud.
        </p>
      )}

      {puedeContratar && (plan === null || !plan.vigente) && (
        <div className="mt-3 flex items-center gap-2">
          <select
            aria-label="Plan a contratar"
            className="h-9 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-sm"
            value={elegido}
            onChange={(e) => setElegido(e.target.value)}
          >
            <option value="">Contratar un plan…</option>
            {planesDisponibles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {formatCOP(p.price_cents)} / {p.months} meses
              </option>
            ))}
          </select>
          <Button size="sm" onClick={onContratar} disabled={!elegido || enviando}>
            {enviando ? "…" : "Contratar"}
          </Button>
        </div>
      )}
    </div>
  )
}
