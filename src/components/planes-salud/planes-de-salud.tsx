"use client"

import * as React from "react"
import { HeartPulse, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatCOP } from "@/lib/facturacion/format"
import { archivarPlan, guardarPlan } from "@/lib/planes-salud/actions"
import type { PlanDeSalud } from "@/lib/planes-salud/consultas"

// Definir los planes de salud de la clínica.
//
// ── LO QUE INCLUYE SE ELIGE DEL CATÁLOGO ──────────────────────────────────────────────────────
//
// El selector de servicios NO es una lista escrita a mano: son los ítems activos de `catalog_items`,
// los mismos que se facturan. Es lo que permite que después la cuenta sepa que la línea está
// cubierta —compara `catalog_item_id`— y lo que evita que el plan prometa un servicio que la
// clínica no tiene cómo cobrar.
//
// ── EL PRECIO SE ESCRIBE EN PESOS Y SE GUARDA EN CENTAVOS ─────────────────────────────────────
//
// Como en todo el módulo de facturación. La conversión pasa una sola vez, en la acción de servidor.

type ItemCatalogo = { id: string; name: string; item_type: string; price_cents: number }

type LineaDelPlan = { catalogItemId: string; qty: number }

const VACIO = {
  id: null as string | null,
  nombre: "",
  descripcion: "",
  precio: "",
  meses: "12",
  items: [] as LineaDelPlan[],
}

export function PlanesDeSalud({
  planes,
  catalogo,
  puedeEditar,
}: {
  planes: PlanDeSalud[]
  catalogo: ItemCatalogo[]
  puedeEditar: boolean
}) {
  const [abierto, setAbierto] = React.useState(false)
  const [guardando, setGuardando] = React.useState(false)
  const [form, setForm] = React.useState(VACIO)

  const porId = React.useMemo(() => new Map(catalogo.map((i) => [i.id, i])), [catalogo])

  // Lo que suman los servicios incluidos, a precio de catálogo. No es el precio del plan —es lo que
  // costaría suelto—, y verlo al lado es lo que deja decidir cuánto descuento está regalando la
  // clínica. Sin este número el precio del plan se pone a ojo.
  const sueltoCents = form.items.reduce(
    (acc, l) => acc + (porId.get(l.catalogItemId)?.price_cents ?? 0) * l.qty,
    0,
  )

  function abrirNuevo() {
    setForm(VACIO)
    setAbierto(true)
  }

  function abrirEdicion(p: PlanDeSalud) {
    setForm({
      id: p.id,
      nombre: p.name,
      descripcion: p.description ?? "",
      precio: String(p.price_cents / 100),
      meses: String(p.months),
      items: p.items.map((i) => ({ catalogItemId: i.catalog_item_id, qty: i.qty })),
    })
    setAbierto(true)
  }

  function agregarLinea() {
    // El primer ítem del catálogo que no esté ya en el plan: agregar uno repetido lo rechazaría la
    // acción, y ofrecerlo sería ofrecer un error.
    const libre = catalogo.find((i) => !form.items.some((l) => l.catalogItemId === i.id))
    if (!libre) {
      toast.info("Ya agregaste todos los servicios del catálogo.")
      return
    }
    setForm((f) => ({ ...f, items: [...f.items, { catalogItemId: libre.id, qty: 1 }] }))
  }

  async function onGuardar() {
    setGuardando(true)
    try {
      const r = await guardarPlan({
        id: form.id,
        nombre: form.nombre,
        descripcion: form.descripcion,
        precioPesos: Number(form.precio) || 0,
        meses: Number(form.meses) || 12,
        items: form.items,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(form.id ? "Plan actualizado" : "Plan creado")
      setAbierto(false)
    } finally {
      setGuardando(false)
    }
  }

  async function onArchivar(p: PlanDeSalud) {
    const r = await archivarPlan({ id: p.id, activo: !p.active })
    if (!r.ok) toast.error(r.error)
    else toast.success(p.active ? "Plan archivado" : "Plan reactivado")
  }

  return (
    <div className="flex flex-col gap-4">
      {puedeEditar && (
        <div className="flex justify-end">
          <Button onClick={abrirNuevo}>
            <Plus className="size-4" /> Nuevo plan
          </Button>
        </div>
      )}

      {planes.length === 0 ? (
        <EmptyState
          icon={<HeartPulse className="size-6" />}
          title="Todavía no hay planes de salud"
          description="Un plan es un paquete de servicios con un precio y una vigencia: «3 consultas y 2 vacunas al año». Se le vende a un paciente y la cuenta avisa cuando algo está cubierto."
          action={
            puedeEditar ? (
              <Button onClick={abrirNuevo}>
                <Plus className="size-4" /> Crear el primero
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {planes.map((p) => (
            <div
              key={p.id}
              className={
                "rounded-xl border bg-card p-4" + (p.active ? "" : " opacity-60")
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {p.name}
                    {!p.active && <Badge variant="outline">Archivado</Badge>}
                  </div>
                  {p.description && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{p.description}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold">{formatCOP(p.price_cents)}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.months} {p.months === 1 ? "mes" : "meses"}
                  </div>
                </div>
              </div>

              <ul className="mt-3 space-y-1 text-sm">
                {p.items.map((i) => (
                  <li key={i.catalog_item_id} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate text-muted-foreground">{i.nombre}</span>
                    <span className="shrink-0 tabular-nums">×{i.qty}</span>
                  </li>
                ))}
              </ul>

              {puedeEditar && (
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => abrirEdicion(p)}>
                    Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onArchivar(p)}>
                    {p.active ? "Archivar" : "Reactivar"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar plan" : "Nuevo plan de salud"}</DialogTitle>
            <DialogDescription>
              Editar un plan cambia lo que cubre también para quien ya lo tiene. Lo que NO cambia es
              el precio que pagó.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="plan-nombre">Nombre</Label>
              <Input
                id="plan-nombre"
                value={form.nombre}
                placeholder="Plan bienestar anual"
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="plan-precio">Precio</Label>
                <Input
                  id="plan-precio"
                  inputMode="numeric"
                  value={form.precio}
                  placeholder="300000"
                  onChange={(e) => setForm((f) => ({ ...f, precio: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="plan-meses">Vigencia (meses)</Label>
                <Input
                  id="plan-meses"
                  inputMode="numeric"
                  value={form.meses}
                  onChange={(e) => setForm((f) => ({ ...f, meses: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="plan-desc">Descripción (opcional)</Label>
              <Textarea
                id="plan-desc"
                rows={2}
                value={form.descripcion}
                onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
              />
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label>Qué incluye</Label>
                <Button size="sm" variant="outline" onClick={agregarLinea}>
                  <Plus className="size-4" /> Agregar servicio
                </Button>
              </div>

              {form.items.length === 0 ? (
                <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  Un plan sin servicios no cubre nada. Agregá al menos uno del catálogo.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {form.items.map((l, idx) => (
                    <div key={l.catalogItemId} className="flex items-center gap-2">
                      <select
                        className="h-9 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-sm"
                        value={l.catalogItemId}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            items: f.items.map((x, i) =>
                              i === idx ? { ...x, catalogItemId: e.target.value } : x,
                            ),
                          }))
                        }
                      >
                        {catalogo.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                      </select>
                      <Input
                        className="w-20"
                        inputMode="numeric"
                        value={String(l.qty)}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            items: f.items.map((x, i) =>
                              i === idx ? { ...x, qty: Number(e.target.value) || 1 } : x,
                            ),
                          }))
                        }
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Quitar servicio"
                        onClick={() =>
                          setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}

                  <p className="text-xs text-muted-foreground">
                    Suelto costaría {formatCOP(sueltoCents)}.
                  </p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button onClick={onGuardar} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
