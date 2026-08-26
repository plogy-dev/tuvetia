"use client"

// Importar pacientes desde Excel (.xlsx/.xls), Google Sheets (exportado a .xlsx/.csv),
// CSV/TSV u ODS. SheetJS lee todos esos formatos de forma uniforme. Flujo: subir -> mapear
// columnas (auto-detección editable) -> previsualizar -> importar vía las MISMAS RPCs que el
// alta individual (create_owner / create_patient: SECURITY DEFINER, resuelven clinic_id + tenancy).

import { useCallback, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { filaDeCabecera } from "@/lib/importar/cabecera"
import { comoTexto } from "@/lib/importar/texto"
import {
  CAMPOS,
  SIN_MAPEAR,
  columnasDe,
  mapearColumnas,
  normalizar,
  type Columna,
} from "@/lib/pacientes/columnas-del-archivo"

/**
 * ¿Esta celda parece un encabezado de pacientes?
 *
 * Es la señal fuerte con la que `filaDeCabecera` distingue la tabla de una fila de título. Se
 * apoya en el MISMO puntaje que después hace el mapeo —no en una segunda lista de sinónimos que
 * se desincronizaría— pasándole una columna sola: si algún campo la reclama, es un encabezado.
 */
const esEncabezadoDePaciente = (celda: string) =>
  Object.values(mapearColumnas(columnasDe([celda]))).some((v) => v !== SIN_MAPEAR)

function normSex(v: string): "male" | "female" | "unknown" {
  const n = normalizar(v)
  if (["m", "macho", "male", "masculino"].includes(n) || n.startsWith("mach")) return "male"
  if (["h", "f", "hembra", "female", "femenino"].includes(n) || n.startsWith("hemb")) return "female"
  return "unknown"
}

function normSpecies(v: string): string {
  const s = (v ?? "").toString().trim()
  if (!s) return "Otro"
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

// Excel guarda fechas como número de serie; SheetJS con cellDates las trae como Date.
function toISODate(v: unknown): string | null {
  if (!v) return null
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  // «05/08/2020» acá es 5 de agosto: DD/MM, como se escribe en Colombia. Sin esta rama,
  // `new Date(string)` lo leía MM/DD y con día ≤ 12 el nacimiento quedaba con día y mes
  // intercambiados EN SILENCIO — y la edad gobierna el plan vacunal (revisión del 26-ago).
  const barras = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (barras) {
    const d = new Date(Date.UTC(Number(barras[3]), Number(barras[2]) - 1, Number(barras[1])))
    const valida = d.getUTCMonth() === Number(barras[2]) - 1 && d.getUTCDate() === Number(barras[1])
    return valida ? d.toISOString().slice(0, 10) : null
  }
  const d = new Date(s)
  if (!isNaN(d.getTime()) && /\d{4}/.test(s)) return d.toISOString().slice(0, 10)
  return null
}

// "3", "3 a", "3 años", "6m", "6 meses" -> fecha de nacimiento aproximada (para llenar birth_date).
function ageToBirthISO(v: unknown, todayISO: string): string | null {
  if (!v) return null
  // SIN `normalizar` A PROPÓSITO, y con motivo: esa función convierte todo lo que no es letra ni
  // número en espacio —hace falta para comparar ENCABEZADOS— y acá eso partiría "3,5" en "3 5",
  // que `parseFloat` lee como 3. Una edad de tres años y medio se volvería de tres.
  const s = String(v)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
  const num = parseFloat(s.replace(",", "."))
  if (isNaN(num)) return null
  // meses si dice "mes" o la unidad es "m" pegada/junto al número ("6m", "6 m") y NO años.
  const isMonths = /mes|\d\s*m\b|\d\s*m$/.test(s) && !/(a[nñ]o|year)/.test(s)
  const months = isMonths ? num : num * 12
  const base = new Date(todayISO + "T00:00:00Z")
  base.setUTCMonth(base.getUTCMonth() - Math.round(months))
  return base.toISOString().slice(0, 10)
}

type Summary = { created: number; reusedOwners: number; skipped: number; errors: string[] }

export default function ImportPatientsPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [columnas, setColumnas] = useState<Columna[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [summary, setSummary] = useState<Summary | null>(null)

  const parseFile = useCallback(async (file: File) => {
    setSummary(null)
    try {
      // SheetJS (~1 MB) se carga recién acá, cuando el usuario ya eligió un archivo — no al
      // entrar a la página.
      const XLSX = await import("xlsx")
      // CSV/TSV/TXT: leer como TEXTO — si se lee como binario, SheetJS no detecta el codepage y
      // destroza los acentos (Michifú -> MichifÃº). Los binarios (xlsx/xls/ods) sí van por
      // arrayBuffer.
      //
      // Y EL TEXTO PASA POR `comoTexto`, no por `file.text()`: `File.text()` decodifica SIEMPRE
      // como UTF-8, y Excel en Windows guarda "CSV" en Windows-1252. Con `file.text()` la ó de
      // "Teléfono"/"Dirección" llegaba como `�` y esa columna no mapeaba con ninguna regla —
      // medido en el barrido de formatos del 21-ago sobre el importador de inventario, que tenía
      // exactamente el mismo defecto.
      const isText = /\.(csv|tsv|txt)$/i.test(file.name)
      const bytes = new Uint8Array(await file.arrayBuffer())
      const wb = isText
        ? XLSX.read(comoTexto(bytes), { type: "string" })
        : XLSX.read(bytes, { type: "array", cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "" })
      if (!matrix.length) {
        toast.error("El archivo está vacío.")
        return
      }
      // DÓNDE EMPIEZA LA TABLA. Antes se tomaba `matrix[0]` sin más, y una planilla con fila de
      // título arriba —"LISTADO DE PACIENTES"— metía los encabezados reales como si fueran un
      // paciente y dejaba las columnas sin nombre. Es el caso que más rompía en el barrido del
      // 21-ago, y es el mismo módulo que usa el importador de inventario.
      const texto = (f: unknown[]) => (f as unknown[]).map((h) => String(h ?? ""))
      const inicio = filaDeCabecera(matrix.map(texto), esEncabezadoDePaciente)

      // LAS FILAS SE INDEXAN POR POSICIÓN, no por el texto del encabezado. Una planilla exportada
      // trae encabezados repetidos ("Teléfono" dos veces) y encabezados vacíos: con el texto como
      // clave, la segunda columna pisaba a la primera y los datos de una aparecían bajo el nombre
      // de otra. Es la otra mitad de "mezcla las columnas" que reportó David.
      const cols = columnasDe(texto(matrix[inicio] as unknown[]))
      const body = matrix.slice(inicio + 1).map((r) => {
        const obj: Record<string, unknown> = {}
        cols.forEach((c, i) => (obj[c.id] = (r as unknown[])[i]))
        return obj
      })
      // descarta filas totalmente vacías
      const clean = body.filter((r) => cols.some((c) => String(r[c.id] ?? "").trim() !== ""))
      setFileName(file.name)
      setColumnas(cols)
      setRows(clean)
      setMapping(mapearColumnas(cols))
      toast.success(`${clean.length} filas leídas de "${file.name}"`)
    } catch (e) {
      toast.error(`No se pudo leer el archivo: ${(e as Error).message}`)
    }
  }, [])

  const nameCol = mapping.name
  const mapped = useMemo(() => {
    if (!nameCol || nameCol === SIN_MAPEAR) return []
    const get = (r: Record<string, unknown>, key: string) => {
      const col = mapping[key]
      return col && col !== SIN_MAPEAR ? r[col] : ""
    }
    const todayISO = new Date().toISOString().slice(0, 10)
    return rows.map((r) => {
      const name = String(get(r, "name") ?? "").trim()
      const birth =
        toISODate(get(r, "birth_date")) ?? ageToBirthISO(get(r, "age"), todayISO)
      const w = parseFloat(String(get(r, "weight_kg") ?? "").replace(",", "."))
      return {
        name,
        species: normSpecies(String(get(r, "species") ?? "")),
        breed: String(get(r, "breed") ?? "").trim() || null,
        sex: normSex(String(get(r, "sex") ?? "")),
        birth_date: birth,
        weight_kg: isNaN(w) ? null : w,
        owner_name: String(get(r, "owner_name") ?? "").trim(),
        owner_phone: String(get(r, "owner_phone") ?? "").trim() || null,
        owner_email: String(get(r, "owner_email") ?? "").trim() || null,
        owner_document: String(get(r, "owner_document") ?? "").trim() || null,
      }
    })
  }, [rows, mapping, nameCol])

  const validRows = useMemo(() => mapped.filter((m) => m.name), [mapped])

  async function runImport() {
    if (!validRows.length) return
    setImporting(true)
    setProgress(0)
    const supabase = createClient()
    const sum: Summary = { created: 0, reusedOwners: 0, skipped: 0, errors: [] }

    // Dedup de titulares: cache por (nombre|teléfono) — reusa existentes y no duplica dentro del archivo.
    const { data: existing } = await supabase.from("owners").select("id, full_name, phone")
    const ownerCache = new Map<string, string>()
    for (const o of (existing as { id: string; full_name: string; phone: string | null }[] | null) ?? []) {
      ownerCache.set(`${normalizar(o.full_name)}|${normalizar(o.phone ?? "")}`, o.id)
    }

    for (let i = 0; i < validRows.length; i++) {
      const m = validRows[i]
      try {
        let ownerId: string | null = null
        if (m.owner_name) {
          const key = `${normalizar(m.owner_name)}|${normalizar(m.owner_phone ?? "")}`
          const keyNoPhone = `${normalizar(m.owner_name)}|`
          ownerId = ownerCache.get(key) ?? ownerCache.get(keyNoPhone) ?? null
          if (!ownerId) {
            const { data: newOwner, error } = await supabase.rpc("create_owner", {
              p_full_name: m.owner_name,
              p_phone: m.owner_phone,
              p_email: m.owner_email,
              p_document_id: m.owner_document,
            })
            if (error || !newOwner) throw new Error(`titular "${m.owner_name}": ${error?.message}`)
            ownerId = newOwner as string
            ownerCache.set(key, ownerId)
            sum.reusedOwners += 0
          } else {
            sum.reusedOwners += 1
          }
        }
        if (!ownerId) {
          // Sin titular en el archivo: crea uno mínimo con el mismo nombre de la mascota como referencia.
          const { data: newOwner, error } = await supabase.rpc("create_owner", {
            p_full_name: `Titular de ${m.name}`,
          })
          if (error || !newOwner) throw new Error(`titular de ${m.name}: ${error?.message}`)
          ownerId = newOwner as string
        }
        const { error: pErr } = await supabase.rpc("create_patient", {
          p_owner_id: ownerId,
          p_name: m.name,
          p_species: m.species,
          p_sex: m.sex,
          p_breed: m.breed,
          p_birth_date: m.birth_date,
          p_weight_kg: m.weight_kg,
        })
        if (pErr) throw new Error(`"${m.name}": ${pErr.message}`)
        sum.created += 1
      } catch (e) {
        sum.skipped += 1
        if (sum.errors.length < 10) sum.errors.push((e as Error).message)
      }
      setProgress(Math.round(((i + 1) / validRows.length) * 100))
    }

    setImporting(false)
    setSummary(sum)
    if (sum.created) {
      toast.success(`${sum.created} paciente(s) importado(s)`)
      router.refresh()
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-4 md:py-6 lg:px-6">
      <Link
        href="/dashboard/patients"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Volver a pacientes
      </Link>

      <div>
        <h1 className="text-lg font-semibold">Importar pacientes</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Sube el listado que ya tienes en <b>Excel</b> (.xlsx/.xls), <b>Google Sheets</b>{" "}
          (descárgalo como Excel o CSV), <b>CSV/TSV</b> u <b>ODS</b>. Detectamos las columnas
          automáticamente; revisa el mapeo y confirma. Los titulares se reutilizan si ya existen.
        </p>
      </div>

      {/* Paso 1: archivo */}
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.tsv,.ods,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (inputRef.current) inputRef.current.value = ""
          if (f) parseFile(f)
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card p-8 text-center transition-colors hover:bg-muted/50"
      >
        <UploadCloud className="size-8 text-muted-foreground" />
        <span className="text-sm font-medium">
          {fileName ? `Archivo: ${fileName}` : "Haz clic para elegir un archivo"}
        </span>
        <span className="text-xs text-muted-foreground">Excel, Google Sheets (exportado), CSV, TSV u ODS · hasta ~5.000 filas</span>
      </button>

      {/* Paso 2: mapeo de columnas */}
      {columnas.length > 0 && (
        <section className="rounded-xl border bg-card p-4 md:p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <FileSpreadsheet className="size-4 text-muted-foreground" /> Mapeo de columnas ({rows.length}{" "}
            filas)
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CAMPOS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-xs">
                <span className="font-medium">
                  {f.label} {f.required && <span className="text-destructive">*</span>}
                </span>
                <select
                  value={mapping[f.key] ?? SIN_MAPEAR}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value={SIN_MAPEAR}>— (ninguna) —</option>
                  {columnas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.etiqueta}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {(!nameCol || nameCol === SIN_MAPEAR) && (
            <p className="mt-3 text-xs text-destructive">
              Asigna al menos la columna del <b>nombre de la mascota</b> para continuar.
            </p>
          )}
        </section>
      )}

      {/* Paso 3: vista previa */}
      {validRows.length > 0 && (
        <section className="rounded-xl border bg-card p-4 md:p-5">
          <div className="mb-3 text-sm font-semibold">
            Vista previa — {validRows.length} paciente(s) válido(s)
            {mapped.length - validRows.length > 0 && (
              <span className="text-muted-foreground">
                {" "}
                · {mapped.length - validRows.length} sin nombre (se omiten)
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-3">Mascota</th>
                  <th className="py-1.5 pr-3">Especie</th>
                  <th className="py-1.5 pr-3">Raza</th>
                  <th className="py-1.5 pr-3">Sexo</th>
                  <th className="py-1.5 pr-3">Nacim.</th>
                  <th className="py-1.5 pr-3">Peso</th>
                  <th className="py-1.5 pr-3">Titular</th>
                  <th className="py-1.5 pr-3">Teléfono</th>
                </tr>
              </thead>
              <tbody>
                {validRows.slice(0, 8).map((m, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{m.name}</td>
                    <td className="py-1.5 pr-3">{m.species}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{m.breed ?? "—"}</td>
                    <td className="py-1.5 pr-3">
                      {m.sex === "male" ? "Macho" : m.sex === "female" ? "Hembra" : "—"}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{m.birth_date ?? "—"}</td>
                    <td className="py-1.5 pr-3">{m.weight_kg ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{m.owner_name || "—"}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{m.owner_phone ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {validRows.length > 8 && (
              <p className="mt-2 text-xs text-muted-foreground">…y {validRows.length - 8} más.</p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={runImport} disabled={importing}>
              {importing ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Importar {validRows.length} paciente(s)
            </Button>
            {importing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-2 w-40 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                </div>
                {progress}%
              </div>
            )}
          </div>
        </section>
      )}

      {/* Resultado */}
      {summary && (
        <section className="rounded-xl border bg-card p-4 md:p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="size-4 text-foreground" /> Importación finalizada
          </div>
          <p className="text-sm">
            <b>{summary.created}</b> paciente(s) creado(s) ·{" "}
            <span className="text-muted-foreground">{summary.reusedOwners} titular(es) reutilizado(s)</span>
            {summary.skipped > 0 && (
              <span className="text-destructive"> · {summary.skipped} con error</span>
            )}
          </p>
          {summary.errors.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-xs text-destructive">
              {summary.errors.map((e, i) => (
                <li key={i}>• {e}</li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <Button variant="outline" size="sm" render={<Link href="/dashboard/patients" />}>
              Ver pacientes
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
