"use client"

// Búsqueda + filtro por especie + tabla de pacientes, TODO client-side sobre el listado que ya
// vino del server. Antes la búsqueda navegaba con ?q= en cada tecla y re-corría las 5 queries del
// server component con un `q` que ni participaba en el SQL: tormenta de queries sin beneficio.

import { useMemo, useState } from "react"
import Link from "next/link"
import { FileTextIcon, PawPrintIcon, SearchIcon } from "lucide-react"

import { CreatePatientDrawer } from "@/components/create-patient-drawer"
import { ExportCsvButton } from "@/components/export-csv-button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { FilterChip, FilterChips } from "@/components/ui/filter-chips"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fmtAgeShort } from "@/lib/age"

export type PatientRow = {
  id: string
  name: string
  species: string
  breed: string | null
  sex: string
  birth_date: string | null
  photo_url: string | null
  // PostgREST devuelve el embed to-one (owner_id -> owners.id) como objeto,
  // pero el query builder no tipado lo infiere como arreglo.
  owner: { full_name: string; phone: string | null } | null
  /** Embed to-many. Alimenta la alerta del listado; puede faltar en filas viejas del caché. */
  allergies?: { allergen: string; severity: string }[] | null
}

/**
 * La alerta clínica del listado.
 *
 * Sale del mockup y es lo mejor que trae: la alergia se ve ANTES de abrir la ficha, que es cuando
 * todavía sirve para no equivocarse. Muestra la más grave y, si hay varias, cuántas más.
 *
 * `severe` se pinta en rojo y el resto en ámbar: una alergia leve no puede gritar lo mismo que una
 * anafilaxia, o el rojo deja de significar algo.
 */
function AlertaClinica({ alergias }: { alergias: { allergen: string; severity: string }[] }) {
  if (alergias.length === 0) {
    return <span className="text-xs text-fg-faint">—</span>
  }
  const grave = alergias.some((a) => a.severity === "severe")
  const peor = alergias.find((a) => a.severity === "severe") ?? alergias[0]
  const resto = alergias.length - 1

  return (
    <span
      title={alergias.map((a) => `${a.allergen} (${a.severity})`).join(" · ")}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
        grave ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn"
      }`}
    >
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${grave ? "bg-danger" : "bg-warn"}`} />
      <span className="truncate">
        {peor.allergen}
        {resto > 0 && ` +${resto}`}
      </span>
    </span>
  )
}

const SEX_LABELS: Record<string, string> = {
  male: "Macho",
  female: "Hembra",
  unknown: "—",
}

const ESPECIE_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "perros", label: "Perros" },
  { value: "gatos", label: "Gatos" },
  { value: "otros", label: "Otros" },
]

function especieBucket(species: string): string {
  const s = (species || "").trim().toLowerCase()
  if (s.startsWith("perr")) return "perros"
  if (s.startsWith("gat")) return "gatos"
  return "otros"
}

// LA ESCALA DE LA TABLA, MEDIDA CONTRA EL PROTOTIPO DEL CLIENTE (22-ago).
//
// El diagnóstico ya estaba escrito en `docs/entrega/4-EL-REPO-DE-LUCIANO.md`: el sistema declara
// 10px de radio y nosotros renderizamos 18, y nuestro texto es ~11% más grande en las superficies
// densas. Sumado, es lo que Luciano llamó "efecto ladrillo" — y lo dijo mirando listas como ésta.
//
// Estas dos constantes son las medidas de su tabla, no una aproximación: `px-[14px] py-[9px]` en la
// cabecera y `px-[14px] py-[11px]` en las celdas. El primitivo compartido (`ui/table`) trae `px-2`,
// que en una tabla de ocho columnas aprieta el texto contra el borde. NO se toca ese primitivo: lo
// usan veinte tablas y esto es una depuración de Pacientes, no del sistema.
const CABECERA = "px-[14px] py-[9px] text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
const CELDA = "px-[14px] py-[11px]"

export function PatientsExplorer({
  rows,
  listError,
  initialQuery = "",
}: {
  rows: PatientRow[]
  listError: boolean
  /** Sólo el valor INICIAL, del `?q=` del buscador global de la cabecera. Teclear sigue sin navegar
   *  ni re-consultar: la nota de arriba sobre la tormenta de queries sigue vigente. */
  initialQuery?: string
}) {
  const [q, setQ] = useState(initialQuery)
  const [especie, setEspecie] = useState("")

  const query = q.trim().toLowerCase()
  const patients = useMemo(
    () =>
      rows.filter((p) => {
        if (especie && especieBucket(p.species) !== especie) return false
        if (!query) return true
        return (
          p.name.toLowerCase().includes(query) ||
          (p.owner?.full_name ?? "").toLowerCase().includes(query) ||
          (p.owner?.phone ?? "").toLowerCase().includes(query)
        )
      }),
    [rows, query, especie],
  )

  return (
    <>
      {/* Búsqueda + filtro por especie (locales) + export de lo filtrado */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por mascota, titular o teléfono…"
            className="pl-8"
            aria-label="Buscar pacientes"
          />
        </div>
        <FilterChips>
          {ESPECIE_FILTERS.map((f) => (
            <FilterChip
              key={f.value || "todos"}
              onClick={() => setEspecie(f.value)}
              active={especie === f.value}
            >
              {f.label}
            </FilterChip>
          ))}
        </FilterChips>
        <ExportCsvButton
          filename="pacientes.csv"
          headers={["Mascota", "Especie", "Raza", "Sexo", "Edad", "Titular", "Teléfono"]}
          rows={patients.map((p) => [
            p.name,
            p.species,
            p.breed ?? "",
            SEX_LABELS[p.sex] ?? p.sex,
            fmtAgeShort(p.birth_date),
            p.owner?.full_name ?? "",
            p.owner?.phone ?? "",
          ])}
        />
      </div>

      {/* Tabla de pacientes. Un bloque con borde y filas separadas por línea —sin sombra, sin fondo
          en la cabecera— que es la gramática de listas del mockup. La cabecera va en versalitas de
          11px como el resto del sistema. */}
      {/* DEPURADO CONTRA EL PROTOTIPO (22-ago). Tres medidas, todas del suyo:
          `rounded-lg` y no `rounded-xl` —18px contra los 10px que declara el sistema, que es de
          donde sale el "efecto ladrillo"—, `border-line-soft` en vez de `border-line`, y la
          superficie de tarjeta con su sombra. */}
      {/* `overflow-x-auto`, NO `overflow-hidden`. Con `hidden`, en una ventana angosta la última
          columna no se desplazaba: SE RECORTABA. Es lo que reportó David el 25-ago con una captura
          donde «Historia» quedaba cortada contra el borde — y lo peor del caso es que no había
          ninguna señal de que faltaba algo. */}
      <div className="overflow-x-auto rounded-lg border border-line-soft bg-card shadow-sm">
        {/* 13px y no 14: la tabla de ellos es `text-[13px]`. En una lista de ocho columnas ese
            punto es la diferencia entre leerla de un vistazo y tener que recorrerla. */}
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {/* HISTORIA VA PRIMERA. Lo pidió David el 25-ago: «historia clínica debe resaltar
                  como función, debe ir de primera ahí para espichar».

                  Tiene razón por dos motivos que se suman: es LA acción de la fila —lo que el vet
                  viene a abrir— y estando última era además la que se recortaba en pantallas
                  angostas. Adelante se ve siempre, sin desplazar. */}
              <TableHead className={`${CABECERA} w-28`}>
                Historia
              </TableHead>
              <TableHead className={CABECERA}>
                Paciente
              </TableHead>
              {/* "Estado" reemplaza a "Especie": la especie ya se lee en el nombre y en la raza, y
                  esta columna es la que el mockup usa para la alerta clínica. */}
              <TableHead className={CABECERA}>
                Estado
              </TableHead>
              <TableHead className={`${CABECERA} hidden md:table-cell`}>
                Raza
              </TableHead>
              <TableHead className={CABECERA}>
                Sexo
              </TableHead>
              <TableHead className={CABECERA}>
                Edad
              </TableHead>
              <TableHead className={`${CABECERA} hidden sm:table-cell`}>
                Titular
              </TableHead>
              <TableHead className={`${CABECERA} hidden lg:table-cell`}>
                Teléfono
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {patients.length ? (
              patients.map((patient) => (
                <TableRow key={patient.id}>
                  {/* Primera, por lo mismo que la cabecera: es la acción de la fila. */}
                  <TableCell className={CELDA}>
                    <Button
                      variant="outline"
                      size="sm"
                      render={<Link href={`/dashboard/patients/${patient.id}`} />}
                    >
                      <FileTextIcon className="size-3.5" /> Historia
                    </Button>
                  </TableCell>
                  <TableCell className={`${CELDA} font-medium`}>
                    <Link
                      href={`/dashboard/patients/${patient.id}`}
                      className="group/nombre flex items-center gap-[9px]"
                    >
                      <Avatar className="size-8">
                        <AvatarImage src={patient.photo_url ?? undefined} alt={patient.name} />
                        <AvatarFallback>
                          <PawPrintIcon className="size-4" />
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold transition-colors group-hover/nombre:text-brand">
                          {patient.name}
                        </span>
                        <span className="block truncate text-xs font-normal text-fg-muted">
                          {patient.species}
                        </span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className={CELDA}>
                    <AlertaClinica alergias={patient.allergies ?? []} />
                  </TableCell>
                  <TableCell className={`${CELDA} hidden text-fg-muted md:table-cell`}>
                    {patient.breed ?? "—"}
                  </TableCell>
                  <TableCell className={`${CELDA} text-fg-muted`}>{SEX_LABELS[patient.sex] ?? patient.sex}</TableCell>
                  <TableCell className={`${CELDA} font-mono text-xs tabular-nums text-fg-muted`}>{fmtAgeShort(patient.birth_date)}</TableCell>
                  <TableCell className={`${CELDA} hidden text-fg-muted sm:table-cell`}>
                    {patient.owner?.full_name ?? "—"}
                  </TableCell>
                  <TableCell className={`${CELDA} hidden font-mono text-xs tabular-nums text-muted-foreground lg:table-cell`}>
                    {patient.owner?.phone ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  {listError ? (
                    "No se pudieron cargar los pacientes. Recarga la página para reintentar."
                  ) : query || especie ? (
                    // Acá no hay nada que crear: lo que toca es soltar el filtro, y eso es lo que
                    // se ofrece.
                    <div className="flex flex-col items-center gap-2">
                      <span>Ningún paciente coincide con esos filtros.</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setQ("")
                          setEspecie("")
                        }}
                      >
                        Quitar los filtros
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <span>Todavía no hay pacientes registrados.</span>
                      <CreatePatientDrawer
                        label="Registrar el primer paciente"
                        trigger={<Button variant="outline" size="sm" />}
                      />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
