"use client"

import * as React from "react"
import { PawPrint, Search, ShoppingBag, UserRound } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import { buscarPacientes, normalizar } from "@/lib/athos-context/buscar-pacientes"

// A quién se le vende, elegido SIN salir de la cuenta.
//
// ── EL FLUJO QUE PIDIÓ DAVID, LITERAL (25-ago) ────────────────────────────────────────────────
//
// «se oprime el botón y sale la opción de venta a persona indeterminada o venta a
// cliente/paciente, imagínatelo como dos papeletas, y después si escoge cliente, que salga una
// lupa para escribir ahí encima».
//
// Antes «Editar» era un <Link> a /dashboard/facturacion/nueva: NAVEGABA, el carrito se
// desmontaba, y todo lo tecleado —líneas, descuento, observaciones— se perdía. «No está
// funcionando de forma dinámica» era exactamente eso.
//
// ── LOS DATOS SE CARGAN AL ABRIR, UNA VEZ ─────────────────────────────────────────────────────
//
// Pacientes y titulares de la clínica completos, filtrados en memoria con el mismo matcher del
// selector de contexto de Athos (tildes, ñ, titular). No es un lujo dudoso: la clínica más grande
// del principal tiene 25 pacientes y 74 titulares hay en TODO el sistema — un ilike por tecla
// sería más código para ser más lento. El día que una clínica tenga miles, este es el sitio a
// revisar (y `buscarPacientes` ya acota a 50 resultados).

export type ClienteElegido = {
  ownerId: string | null
  ownerName: string | null
  patientId: string | null
  patientName: string | null
}

type Candidato = {
  tipo: "paciente" | "titular"
  /** Para la lupa: nombre + especie + titular (paciente) o nombre + documento (titular). */
  id: string
  name: string
  species: string
  owner: string | null
  eleccion: ClienteElegido
}

export function SelectorDeCliente({
  open,
  onOpenChange,
  onElegir,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onElegir: (c: ClienteElegido) => void
}) {
  // null = todavía en las dos papeletas; true = eligió «cliente o paciente» y está en la lupa.
  const [enLupa, setEnLupa] = React.useState(false)
  const [busqueda, setBusqueda] = React.useState("")
  const [candidatos, setCandidatos] = React.useState<Candidato[] | null>(null)

  // Al cerrar se vuelve a las papeletas: la próxima venta arranca desde la pregunta, no desde la
  // lupa del cliente anterior. Va en el HANDLER de apertura y no en un useEffect —
  // `react-hooks/set-state-in-effect` lo rechaza con razón: cerrar es un evento, no un efecto.
  function cambiarOpen(v: boolean) {
    if (!v) {
      setEnLupa(false)
      setBusqueda("")
    }
    onOpenChange(v)
  }

  async function cargar() {
    if (candidatos !== null) return
    const supabase = createClient()
    const [{ data: pacientes }, { data: titulares }] = await Promise.all([
      supabase
        .from("patients")
        .select("id, name, species, owner_id, owner:owners(full_name)")
        .order("name"),
      supabase.from("owners").select("id, full_name, document_id, phone").order("full_name"),
    ])

    const dePacientes: Candidato[] = (
      (pacientes as unknown as
        | {
            id: string
            name: string
            species: string
            owner_id: string | null
            owner: { full_name: string | null } | null
          }[]
        | null) ?? []
    ).map((p) => ({
      tipo: "paciente",
      id: `p-${p.id}`,
      name: p.name,
      species: p.species,
      owner: p.owner?.full_name ?? null,
      eleccion: {
        ownerId: p.owner_id,
        ownerName: p.owner?.full_name ?? null,
        patientId: p.id,
        patientName: p.name,
      },
    }))

    // Los titulares entran al MISMO matcher disfrazados de `PacienteBuscable`: su documento y su
    // teléfono viajan en `species`, que el matcher también recorre — así «31045» encuentra al
    // titular por celular sin un segundo camino de búsqueda.
    const deTitulares: Candidato[] = (
      (titulares as unknown as
        | { id: string; full_name: string | null; document_id: string | null; phone: string | null }[]
        | null) ?? []
    ).map((o) => ({
      tipo: "titular",
      id: `o-${o.id}`,
      name: o.full_name ?? "—",
      species: [o.document_id, o.phone].filter(Boolean).join(" "),
      owner: null,
      eleccion: {
        ownerId: o.id,
        ownerName: o.full_name ?? null,
        patientId: null,
        patientName: null,
      },
    }))

    setCandidatos([...dePacientes, ...deTitulares])
  }

  const resultados = React.useMemo(() => {
    if (!candidatos) return []
    if (!normalizar(busqueda)) return candidatos.slice(0, 50)
    return buscarPacientes(candidatos, busqueda)
  }, [candidatos, busqueda])

  function elegir(c: ClienteElegido) {
    onElegir(c)
    cambiarOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={cambiarOpen}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="border-b border-line-soft p-5 pb-4">
          <DialogTitle>¿A quién le vendés?</DialogTitle>
          <DialogDescription>
            {enLupa
              ? "Buscá por mascota, titular, cédula o celular."
              : "Con cliente, la cuenta entra a cartera y tiene a dónde mandarse."}
          </DialogDescription>
        </DialogHeader>

        {!enLupa ? (
          /* Las dos papeletas. */
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            <button
              type="button"
              onClick={() =>
                elegir({ ownerId: null, ownerName: null, patientId: null, patientName: null })
              }
              className="flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors hover:border-brand/40 hover:bg-accent/40"
            >
              <ShoppingBag className="size-5 text-muted-foreground" aria-hidden />
              <span className="text-sm font-semibold">Venta a persona indeterminada</span>
              <span className="text-xs text-muted-foreground">
                Mostrador: consumidor final, sin cliente.
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setEnLupa(true)
                void cargar()
              }}
              className="flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors hover:border-brand/40 hover:bg-accent/40"
            >
              <UserRound className="size-5 text-muted-foreground" aria-hidden />
              <span className="text-sm font-semibold">Venta a cliente o paciente</span>
              <span className="text-xs text-muted-foreground">
                Con nombre: entra a cartera y recibe su factura.
              </span>
            </button>
          </div>
        ) : (
          /* La lupa. */
          <div className="flex flex-col gap-3 p-5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                autoFocus
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Mascota, titular, cédula o celular…"
                autoComplete="off"
                className="pl-8"
              />
            </div>

            <div
              role="listbox"
              aria-label="Clientes y pacientes"
              className="max-h-[45svh] overflow-y-auto rounded-lg border"
            >
              {candidatos === null && (
                <p className="px-3 py-4 text-sm text-muted-foreground">Cargando…</p>
              )}
              {resultados.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => elegir(c.eleccion)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50"
                >
                  {c.tipo === "paciente" ? (
                    <PawPrint className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {c.tipo === "paciente"
                      ? `${c.species}${c.owner ? ` · ${c.owner}` : ""}`
                      : c.species || "titular"}
                  </span>
                </button>
              ))}
              {candidatos !== null && resultados.length === 0 && (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  Nadie coincide con «{busqueda}».
                </p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
