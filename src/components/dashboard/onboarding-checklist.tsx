"use client"

// Tarjeta "Primeros pasos" del dashboard: checks calculados con DATOS REALES de la clínica
// (los pasa la página server). Se auto-oculta al completar los 3 pasos; también se puede
// descartar (localStorage). Incluye "Borrar datos de ejemplo" mientras exista el demo.

import { useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckCircle2, Circle, ListChecks, Loader2, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

const DISMISS_KEY = "tuvetia_checklist_dismissed"

const noopSubscribe = () => () => {}
const readDismissed = () => typeof window !== "undefined" && localStorage.getItem(DISMISS_KEY) === "1"

export function OnboardingChecklist({
  hasPatient,
  hasRecording,
  hasApprovedNote,
  hasDemo,
}: {
  hasPatient: boolean
  hasRecording: boolean
  hasApprovedNote: boolean
  hasDemo: boolean
}) {
  const router = useRouter()
  const storedDismiss = useSyncExternalStore(noopSubscribe, readDismissed, () => false)
  const [hidden, setHidden] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const items = [
    { done: hasPatient, label: "Crear tu primer paciente", href: "/dashboard/patients" },
    { done: hasRecording, label: "Grabar una consulta (Modo Fantasma)", href: "/dashboard/consultas" },
    { done: hasApprovedNote, label: "Revisar y aprobar una nota clínica", href: "/dashboard/consultas" },
  ]
  const allDone = items.every((i) => i.done)

  if ((allDone && !hasDemo) || storedDismiss || hidden) return null

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1")
    setHidden(true)
  }

  async function deleteDemo() {
    setDeleting(true)
    try {
      const res = await fetch("/api/onboarding/demo-data", { method: "DELETE" })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      toast.success("Datos de ejemplo eliminados")
      router.refresh()
    } catch (e) {
      toast.error(`No se pudo borrar el ejemplo: ${(e as Error).message}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-4 rounded-xl border bg-card p-4 lg:mx-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ListChecks className="size-4 text-muted-foreground" /> Primeros pasos
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Ocultar primeros pasos"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((i) => (
          <li key={i.label}>
            <Link
              href={i.href}
              className={`flex items-center gap-2 text-sm ${i.done ? "text-muted-foreground line-through" : "hover:underline"}`}
            >
              {i.done ? (
                <CheckCircle2 className="size-4 text-green-600" />
              ) : (
                <Circle className="size-4 text-muted-foreground" />
              )}
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
      {hasDemo && (
        <Button
          size="sm"
          variant="ghost"
          onClick={deleteDemo}
          disabled={deleting}
          className="mt-2 text-destructive hover:text-destructive"
        >
          {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          Borrar datos de ejemplo
        </Button>
      )}
    </div>
  )
}
