"use client"

// El panel donde cada quien arma su tablero.
//
// LO QUE SE PIDIÓ, tres veces: *"dashboard modular"* (18-ago), *"que sea la vista predeterminada"*
// (Luciano, 19-ago) y *"los clientes quieren que sea prácticamente personalizable"*.
//
// ── SE ARRASTRA **Y** SE MUEVE CON BOTONES, y las dos cosas hacen falta ─────────────────────────
//
// Arrastrar es lo que la gente espera y lo que se pidió. Pero un tablero que SÓLO se arrastra queda
// fuera del alcance de quien navega con teclado, y esta app ya tiene un test que vigila que todo lo
// interactivo tenga foco visible — sería incoherente enviar la pantalla de personalizar como la
// única cosa que no se puede usar sin mouse.
//
// dnd-kit trae `KeyboardSensor`, así que el arrastre en sí es accesible; los botones de subir y
// bajar quedan igual porque en una lista corta son más rápidos y en touch no fallan.
//
// SE GUARDA AL CERRAR, no en cada movimiento. Reordenar cinco bloques son cinco escrituras si se
// guarda al vuelo, y ninguna de las cuatro intermedias le importa a nadie.

import { useState } from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Building2, ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  alternar,
  mover,
  porDefecto,
  reordenar,
  widgetDe,
  type IdDeWidget,
  type Puesto,
} from "@/lib/tablero/widgets"

function Fila({
  puesto,
  primero,
  ultimo,
  onSubir,
  onBajar,
  onAlternar,
}: {
  puesto: Puesto
  primero: boolean
  ultimo: boolean
  onSubir: () => void
  onBajar: () => void
  onAlternar: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: puesto.id,
  })
  const w = widgetDe(puesto.id)
  if (!w) return null

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-xl border border-line-soft bg-surface p-2.5 ${
        isDragging ? "opacity-60 shadow-popover" : ""
      } ${puesto.visible ? "" : "opacity-55"}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab rounded-[7px] p-1 text-fg-faint hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
        aria-label={`Mover ${w.titulo}`}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{w.titulo}</span>
        {/* LA DESCRIPCIÓN NO ES ADORNO: es lo único que se lee al decidir si tener un bloque o no.
            Cinco títulos sueltos obligan a probar y ver. */}
        <span className="block text-[12px] leading-snug text-fg-muted">{w.descripcion}</span>
      </span>

      <span className="flex shrink-0 items-center gap-0.5">
        <Button size="icon" variant="ghost" onClick={onSubir} disabled={primero} aria-label={`Subir ${w.titulo}`}>
          <ChevronUp className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" onClick={onBajar} disabled={ultimo} aria-label={`Bajar ${w.titulo}`}>
          <ChevronDown className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onAlternar}
          aria-pressed={puesto.visible}
          aria-label={puesto.visible ? `Ocultar ${w.titulo}` : `Mostrar ${w.titulo}`}
        >
          {puesto.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </Button>
      </span>
    </li>
  )
}

export function PersonalizarTablero({
  disposicion,
  clinicId,
  abierto,
  alCerrar,
  esAdmin,
}: {
  disposicion: Puesto[]
  clinicId: string
  abierto: boolean
  alCerrar: () => void
  /**
   * Un admin puede además dejar esta disposición como el tablero de ENTRADA de la clínica (0075).
   *
   * Gobierna si se OFRECE la acción, no si se permite: quien decide eso es la RLS, que exige
   * `admin` en las tres policies de escritura. Esconder un botón no es una autorización.
   */
  esAdmin?: boolean
}) {
  const [d, setD] = useState<Puesto[]>(disposicion)
  const [guardando, setGuardando] = useState(false)

  const sensores = useSensors(
    // 6px antes de empezar a arrastrar: sin esa distancia, un clic en el asa se lee como arrastre
    // y los botones de al lado se vuelven difíciles de acertar.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function alSoltar(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setD((prev) =>
      reordenar(
        prev,
        prev.findIndex((p) => p.id === active.id),
        prev.findIndex((p) => p.id === over.id),
      ),
    )
  }

  /**
   * Deja esta disposición como el punto de partida de la clínica (0075).
   *
   * NO PISA EL TABLERO DE NADIE. Quien ya armó el suyo sigue con el suyo — lo decide
   * `disposicionEfectiva`, que elige la preferencia personal cuando existe. Esto sólo cambia con
   * qué entra quien todavía no la tiene, y el `title` del botón lo dice antes de apretarlo.
   */
  async function dejarComoEntradaDeLaClinica() {
    setGuardando(true)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { error } = await supabase
      .from("tablero_default_clinica")
      .upsert(
        {
          clinic_id: clinicId,
          widgets: d,
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "clinic_id" },
      )
    setGuardando(false)
    if (error) {
      // La RLS es la que decide de verdad: si esta persona dejó de ser admin entre que se pintó el
      // botón y se apretó, el error viene de ahí y hay que mostrarlo tal cual.
      toast.error(`No se pudo dejar como entrada de la clínica: ${error.message}`)
      return
    }
    toast.success("Quien no haya armado su tablero entrará con éste")
  }

  async function guardarYCerrar() {
    setGuardando(true)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setGuardando(false)
      toast.error("Se cerró la sesión")
      return
    }
    // `upsert` sobre la clave (usuario, clínica): la primera vez inserta, después actualiza. Sin
    // esto habría que preguntar antes si existe, que es un viaje de más en el 100% de los casos.
    const { error } = await supabase
      .from("tablero_preferencias")
      .upsert(
        { user_id: user.id, clinic_id: clinicId, widgets: d, updated_at: new Date().toISOString() },
        { onConflict: "user_id,clinic_id" },
      )
    setGuardando(false)
    if (error) {
      toast.error(`No se pudo guardar: ${error.message}`)
      return
    }
    toast.success("Tu tablero quedó así")
    alCerrar()
    // Recarga dura y no `router.refresh()`: el tablero es un server component que lee la
    // preferencia al renderizar, y lo que cambió es el orden de los bloques, no sus datos.
    window.location.reload()
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && alCerrar()}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="border-b border-line-soft p-5 pb-4">
          <DialogTitle>Armá tu tablero</DialogTitle>
          <DialogDescription>
            Arrastrá para ordenar y apagá lo que no mires. Es tuyo: no cambia el de nadie más.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55svh] overflow-y-auto p-3">
          <DndContext
            sensors={sensores}
            collisionDetection={closestCenter}
            onDragEnd={alSoltar}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          >
            <SortableContext items={d.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-1.5">
                {d.map((p, i) => (
                  <Fila
                    key={p.id}
                    puesto={p}
                    primero={i === 0}
                    ultimo={i === d.length - 1}
                    onSubir={() => setD((prev) => mover(prev, p.id as IdDeWidget, -1))}
                    onBajar={() => setD((prev) => mover(prev, p.id as IdDeWidget, 1))}
                    onAlternar={() => setD((prev) => alternar(prev, p.id as IdDeWidget))}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft p-4">
          <Button variant="ghost" size="sm" onClick={() => setD(porDefecto())}>
            <RotateCcw className="size-3.5" />
            Como venía
          </Button>
          {/* LA ACCIÓN DEL ADMIN, y va SEPARADA de "Guardar" a propósito. Son dos cosas distintas
              —una cambia tu pantalla, la otra la de todo el equipo— y un solo botón con una casilla
              al lado invita a marcarla sin leerla. El texto dice a quién le cambia la vista. */}
          {esAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={dejarComoEntradaDeLaClinica}
              disabled={guardando}
              title="Quien todavía no armó su tablero entrará con esta disposición. A quien ya armó el suyo no le cambia nada."
            >
              <Building2 className="size-3.5" />
              Dejar como entrada de la clínica
            </Button>
          )}
          <Button className="ml-auto" onClick={guardarYCerrar} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
