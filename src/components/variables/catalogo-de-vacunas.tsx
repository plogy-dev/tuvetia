"use client"

import * as React from "react"
import { Plus, Syringe } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { archivarVacuna, crearVacuna, sembrarVacunasComunes } from "@/lib/variables/vacunas-actions"

// El catálogo de vacunas: una lista con alta inline. Sin diálogo — agregar una vacuna son dos
// campos, y un modal para dos campos es ceremonia.

export type VacunaDelCatalogo = {
  id: string
  name: string
  species: string | null
  active: boolean
}

export function CatalogoDeVacunas({
  vacunas,
  puedeEditar,
}: {
  vacunas: VacunaDelCatalogo[]
  puedeEditar: boolean
}) {
  const [nombre, setNombre] = React.useState("")
  const [especie, setEspecie] = React.useState("")
  const [ocupado, setOcupado] = React.useState(false)

  async function agregar(e: React.FormEvent) {
    e.preventDefault()
    setOcupado(true)
    try {
      const r = await crearVacuna({ nombre, especie: especie || null })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setNombre("")
      setEspecie("")
      toast.success("Vacuna agregada al catálogo")
    } finally {
      setOcupado(false)
    }
  }

  async function sembrar() {
    setOcupado(true)
    try {
      const r = await sembrarVacunasComunes()
      if (!r.ok) toast.error(r.error)
      else toast.success(`${r.sembradas} vacunas comunes sembradas — editalas a tu gusto`)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {puedeEditar && (
        <form onSubmit={agregar} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="vacuna-nombre" className="mb-1 block text-xs font-medium text-muted-foreground">
              Vacuna
            </label>
            <Input
              id="vacuna-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Rabia"
              required
            />
          </div>
          <div className="w-40">
            <label htmlFor="vacuna-especie" className="mb-1 block text-xs font-medium text-muted-foreground">
              Especie (opcional)
            </label>
            <Input
              id="vacuna-especie"
              value={especie}
              onChange={(e) => setEspecie(e.target.value)}
              placeholder="Perro"
            />
          </div>
          <Button type="submit" disabled={ocupado || nombre.trim().length < 2}>
            <Plus className="size-4" /> Agregar
          </Button>
        </form>
      )}

      {vacunas.length === 0 ? (
        <EmptyState
          icon={<Syringe className="size-6" />}
          title="El catálogo está vacío"
          description="Con catálogo, registrar una vacuna es elegirla de la lista en vez de teclearla — y «Rabia» deja de convivir con «rabia » como si fueran dos."
          action={
            puedeEditar ? (
              <Button onClick={sembrar} disabled={ocupado}>
                Sembrar las comunes de Colombia
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {vacunas.map((v) => (
            <li key={v.id} className={"flex items-center gap-3 px-4 py-2.5" + (v.active ? "" : " opacity-60")}>
              <Syringe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{v.name}</span>
              {v.species && (
                <span className="shrink-0 text-xs text-muted-foreground">{v.species}</span>
              )}
              {!v.active && <Badge variant="outline">Archivada</Badge>}
              {puedeEditar && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={ocupado}
                  onClick={async () => {
                    const r = await archivarVacuna({ id: v.id, activa: !v.active })
                    if (!r.ok) toast.error(r.error)
                  }}
                >
                  {v.active ? "Archivar" : "Reactivar"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
