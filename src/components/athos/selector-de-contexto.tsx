"use client"

// El contexto de Athos: qué paciente está mirando, y cómo cambiarlo.
//
// LO QUE REEMPLAZA. Un `<Select>` que pintaba hasta 500 pacientes de corrido y un `<Badge>` que
// mostraba sólo lo que el vet había elegido a mano. Las dos cosas salieron en la reunión del 17-ago:
//
//     Luciano: "en el momento en que yo tenga 200 pacientes, ¿cómo carajo le voy a decir al man qué
//               contexto tiene? Imposible… Athos debería reconocer el contexto y traerlo dependiendo
//               de la conversación"
//     Jesús:   "si tú tienes 7 perros que tienen leucemia… la característica específica se te llega
//               a escapar conversacionalmente, y llegas a dar un mal diagnóstico"
//
// El acuerdo no le dio la razón a ninguno de los dos, y esta pantalla lo implementa tal cual:
//
//   1. **El selector se queda.** Textual: "esta opción no se tiene que quitar".
//   2. **Se ve qué detectó Athos**, aunque el vet no haya elegido nada — "como tipo Claude, cuando
//      el man está pensando… ya tengo el contexto completo de Manchita".
//   3. **Se puede corregir**, que es lo que responde a la objeción clínica: una detección que no se
//      puede ver ni contradecir es justamente la que termina en un mal diagnóstico.
//   4. **Deja de ser un desplegable y pasa a ser un mini-CRM sobre la pantalla** — propuesta de
//      Felipe en la reunión, aceptada ahí mismo ("Me gusta, me gusta").

import { useMemo, useState } from "react"
import { Check, PawPrint, Search, User } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { buscarPacientes, type PacienteBuscable } from "@/lib/athos-context/buscar-pacientes"
import { discrepa, type PacienteDetectado } from "@/lib/athos-context/detectado"

export type PacienteDelSelector = PacienteBuscable

/** Fila del mini-CRM. Nombre grande, especie y titular debajo: es lo que distingue dos "Manchita". */
function Fila({
  paciente,
  activo,
  onElegir,
}: {
  paciente: PacienteDelSelector
  activo: boolean
  onElegir: () => void
}) {
  return (
    <button
      type="button"
      onClick={onElegir}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
        activo ? "bg-brand-soft" : ""
      }`}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-fg-faint">
        <PawPrint className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{paciente.name}</span>
        <span className="block truncate text-xs text-fg-muted">
          {paciente.species}
          {paciente.owner ? ` · ${paciente.owner}` : ""}
        </span>
      </span>
      {activo && <Check className="size-4 shrink-0 text-brand-text" aria-hidden />}
    </button>
  )
}

export function SelectorDeContexto({
  pacientes,
  patientId,
  onElegir,
  detectado,
  hayConversacion,
}: {
  pacientes: readonly PacienteDelSelector[]
  /** `null` = consulta general. */
  patientId: string | null
  onElegir: (id: string | null) => void
  /** Lo que Athos resolvió por su cuenta, leído de sus llamadas a herramientas. */
  detectado: PacienteDetectado | null
  /** Si hay turnos en el hilo actual. Cambiar de paciente lo cambia por el de ese paciente. */
  hayConversacion: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [consulta, setConsulta] = useState("")

  const elegido = pacientes.find((p) => p.id === patientId) ?? null
  const resultados = useMemo(() => buscarPacientes(pacientes, consulta), [pacientes, consulta])
  const hayQueAvisar = discrepa(patientId, detectado)

  function elegir(id: string | null) {
    setAbierto(false)
    setConsulta("")
    if (id !== patientId) onElegir(id)
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {elegido ? (
          <Badge variant="secondary">
            Contexto · {elegido.name}
          </Badge>
        ) : (
          <Badge variant="outline">Consulta general</Badge>
        )}
        <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
          <Search className="size-3.5" aria-hidden />
          Cambiar contexto
        </Button>
      </div>

      {/* LA DETECCIÓN, VISIBLE. Sólo se dice cuando NO coincide con lo elegido: repetir "Athos está
          usando Manchita" debajo de un chip que ya dice Manchita es ruido. Lo que hay que sacar a la
          luz es la discrepancia — el caso en el que el vet cree una cosa y Athos está haciendo otra. */}
      {hayQueAvisar && detectado && (
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-fg-muted">
          <span>
            Athos está trabajando con{" "}
            <span className="font-medium text-fg">{detectado.nombre}</span>
            {detectado.especie ? ` · ${detectado.especie}` : ""}
            {/* De dónde lo sacó, porque no es lo mismo haber abierto la ficha que haber acertado
                una búsqueda. El vet decide cuánto creerle con ese dato a la vista. */}
            <span className="text-fg-faint">
              {detectado.via === "ficha" ? " (abrió su ficha)" : " (lo encontró buscando)"}
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => elegir(detectado.id)}
          >
            Fijarlo
          </Button>
        </div>
      )}

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-w-xl gap-0 p-0">
          <DialogHeader className="border-b border-line-soft p-5 pb-4">
            <DialogTitle>Contexto de la conversación</DialogTitle>
            <DialogDescription>
              {hayConversacion
                ? "Cada paciente tiene su propio hilo: al cambiar, se abre la conversación de ese paciente y ésta queda guardada."
                : "Elegí con qué paciente querés que Athos trabaje."}
            </DialogDescription>
          </DialogHeader>

          <div className="border-b border-line-soft p-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-faint"
                aria-hidden
              />
              <Input
                autoFocus
                value={consulta}
                onChange={(e) => setConsulta(e.target.value)}
                placeholder="Buscar por mascota, especie o titular…"
                className="pl-9"
              />
            </div>
          </div>

          {/* Alto acotado y scroll propio: con 500 pacientes el diálogo se saldría de la pantalla. */}
          <div className="flex max-h-[50svh] flex-col gap-0.5 overflow-y-auto p-2">
            <button
              type="button"
              onClick={() => elegir(null)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                patientId === null ? "bg-brand-soft" : ""
              }`}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-fg-faint">
                <User className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">Consulta general</span>
                <span className="block text-xs text-fg-muted">Sin paciente ni ficha clínica</span>
              </span>
              {patientId === null && <Check className="size-4 shrink-0 text-brand-text" aria-hidden />}
            </button>

            {resultados.map((p) => (
              <Fila
                key={p.id}
                paciente={p}
                activo={p.id === patientId}
                onElegir={() => elegir(p.id)}
              />
            ))}

            {consulta.trim() !== "" && resultados.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-fg-muted">
                Ningún paciente coincide con «{consulta.trim()}».
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
