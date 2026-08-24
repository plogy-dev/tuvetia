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
import {
  alternarMetrica,
  catalogoOfrecido,
  metricaDe,
  metricasEfectivas,
  moverMetrica,
  type PuestoDeMetrica,
} from "@/lib/tablero/metricas"

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

/**
 * Una cifra de la tira, en la lista donde se eligen.
 *
 * SIN ARRASTRAR, a diferencia de los bloques, y es deliberado: dos áreas de drag-and-drop dentro
 * del mismo diálogo compiten por el mismo gesto —el que arrastra una cifra hacia abajo termina
 * soltándola sobre la lista de bloques— y el orden de una tira horizontal se ajusta con dos clics,
 * no con una maniobra. Las flechas alcanzan y son accesibles con teclado sin ningún trabajo extra.
 */
function FilaDeMetrica({
  puesto,
  primero,
  ultimo,
  onSubir,
  onBajar,
  onAlternar,
}: {
  puesto: PuestoDeMetrica
  primero: boolean
  ultimo: boolean
  onSubir: () => void
  onBajar: () => void
  onAlternar: () => void
}) {
  const m = metricaDe(puesto.id)
  if (!m) return null

  return (
    <li
      className={`flex items-center gap-2 rounded-xl border border-line-soft bg-surface p-2.5 ${
        puesto.visible ? "" : "opacity-55"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{m.label}</span>
        <span className="block text-[12px] leading-snug text-fg-muted">{m.descripcion}</span>
      </span>

      <span className="flex shrink-0 items-center gap-0.5">
        <Button size="icon" variant="ghost" onClick={onSubir} disabled={primero} aria-label={`Subir ${m.label}`}>
          <ChevronUp className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" onClick={onBajar} disabled={ultimo} aria-label={`Bajar ${m.label}`}>
          <ChevronDown className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onAlternar}
          aria-pressed={puesto.visible}
          aria-label={puesto.visible ? `Quitar ${m.label}` : `Agregar ${m.label}`}
        >
          {puesto.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </Button>
      </span>
    </li>
  )
}

export function PersonalizarTablero({
  disposicion,
  metricas,
  facturacionActiva,
  clinicId,
  abierto,
  alCerrar,
  esAdmin,
}: {
  disposicion: Puesto[]
  /** Las cifras de la tira, con las apagadas incluidas (0080). */
  metricas: PuestoDeMetrica[]
  /** Sin facturación activa, las cifras de plata ni se ofrecen: serían ceros permanentes. */
  facturacionActiva: boolean
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
  const [m, setM] = useState<PuestoDeMetrica[]>(metricas)
  const [guardando, setGuardando] = useState(false)

  // Lo que se le ofrece a ESTA clínica. Filtrar acá y no en el `map` de abajo deja bien las flechas:
  // "primero" y "último" tienen que serlo de la lista que se VE, no de la completa.
  const ofrecidas = new Set(catalogoOfrecido(facturacionActiva).map((x) => x.id))
  const metricasVisiblesEnLaLista = m.filter((p) => ofrecidas.has(p.id))

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
        // Los dos en el MISMO upsert, y por eso viven en la misma fila (0080): si fueran dos
        // escrituras, la primera vez que una fallara el tablero quedaría con los bloques de hoy y
        // las cifras de ayer, sin nada que lo revirtiera.
        {
          user_id: user.id,
          clinic_id: clinicId,
          widgets: d,
          metricas: m,
          updated_at: new Date().toISOString(),
        },
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

          {/* ── LAS CIFRAS DE LA TIRA ──────────────────────────────────────────────────────────
              Van en la MISMA hoja que los bloques y no en una pestaña aparte: son la misma
              decisión —cómo quiero mi tablero— y separarlas obligaría a descubrir que existe una
              segunda pantalla. El rótulo y la línea alcanzan para que no se lean como una lista
              sola de doce cosas. */}
          <div className="mt-5 border-t border-line-soft pt-4">
            <p className="px-0.5 text-[11px] font-semibold tracking-[0.06em] text-fg-faint uppercase">
              Las cifras de arriba
            </p>
            <p className="mt-1 mb-2.5 px-0.5 text-[12px] leading-snug text-fg-muted">
              Elegí cuáles querés ver. Cada una se abre para mirar el detalle.
            </p>
            <ul className="flex flex-col gap-1.5">
              {metricasVisiblesEnLaLista.map((p, i) => (
                <FilaDeMetrica
                  key={p.id}
                  puesto={p}
                  primero={i === 0}
                  ultimo={i === metricasVisiblesEnLaLista.length - 1}
                  onSubir={() => setM((prev) => moverMetrica(prev, p.id, -1))}
                  onBajar={() => setM((prev) => moverMetrica(prev, p.id, 1))}
                  onAlternar={() => setM((prev) => alternarMetrica(prev, p.id))}
                />
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft p-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setD(porDefecto())
              // `metricasEfectivas(null)` es exactamente "nadie eligió nunca": las de fábrica
              // encendidas y el resto apagado. Restablecer sólo los bloques dejaría la tira con las
              // cifras de antes, que no es lo que promete el botón.
              setM(metricasEfectivas(null))
            }}
          >
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
