"use client"

// Importar pacientes desde Excel (.xlsx/.xls), Google Sheets (exportado a .xlsx/.csv),
// CSV/TSV u ODS. SheetJS lee todos esos formatos de forma uniforme. Flujo: subir -> mapear
// columnas (auto-detección editable) -> previsualizar -> importar vía las MISMAS RPCs que el
// alta individual (create_owner / create_patient: SECURITY DEFINER, resuelven clinic_id + tenancy).

import { useCallback, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as XLSX from "xlsx"
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

type Field = {
  key: string
  label: string
  required?: boolean
  synonyms: string[]
}

// Campos destino + sinónimos de encabezado (normalizados) para auto-mapear.
const FIELDS: Field[] = [
  { key: "name", label: "Nombre de la mascota", required: true, synonyms: ["mascota", "nombre", "paciente", "pet", "name"] },
  { key: "species", label: "Especie", synonyms: ["especie", "tipo", "species", "animal"] },
  { key: "breed", label: "Raza", synonyms: ["raza", "breed"] },
  { key: "sex", label: "Sexo", synonyms: ["sexo", "genero", "sex", "gender"] },
  { key: "birth_date", label: "Fecha de nacimiento", synonyms: ["nacimiento", "fecha nac", "fecha de nacimiento", "birth", "birthdate", "nac"] },
  { key: "age", label: "Edad (si no hay fecha)", synonyms: ["edad", "age"] },
  { key: "weight_kg", label: "Peso (kg)", synonyms: ["peso", "weight", "kg"] },
  { key: "owner_name", label: "Titular (nombre)", synonyms: ["titular", "dueno", "propietario", "cliente", "owner", "responsable"] },
  { key: "owner_phone", label: "Teléfono del titular", synonyms: ["telefono", "celular", "tel", "phone", "movil", "contacto"] },
  { key: "owner_email", label: "Email del titular", synonyms: ["email", "correo", "mail", "e-mail"] },
  { key: "owner_document", label: "Documento del titular", synonyms: ["documento", "cedula", "dni", "cc", "identificacion", "nit"] },
]

const NONE = "__none__"

function norm(s: string): string {
  return (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
}

function autoMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  const used = new Set<string>()
  for (const f of FIELDS) {
    const hit = headers.find((h) => {
      const n = norm(h)
      return !used.has(h) && f.synonyms.some((s) => n === s || n.includes(s))
    })
    if (hit) {
      map[f.key] = hit
      used.add(hit)
    } else {
      map[f.key] = NONE
    }
  }
  return map
}

function normSex(v: string): "male" | "female" | "unknown" {
  const n = norm(v)
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
  const d = new Date(s)
  if (!isNaN(d.getTime()) && /\d{4}/.test(s)) return d.toISOString().slice(0, 10)
  return null
}

// "3", "3 a", "3 años", "6m", "6 meses" -> fecha de nacimiento aproximada (para llenar birth_date).
function ageToBirthISO(v: unknown, todayISO: string): string | null {
  if (!v) return null
  const s = norm(String(v))
  const num = parseFloat(s.replace(",", "."))
  if (isNaN(num)) return null
  const months = /\bm|mes/.test(s) && !/a|ano|year/.test(s) ? num : num * 12
  const base = new Date(todayISO + "T00:00:00Z")
  base.setUTCMonth(base.getUTCMonth() - Math.round(months))
  return base.toISOString().slice(0, 10)
}

type Summary = { created: number; reusedOwners: number; skipped: number; errors: string[] }

export default function ImportPatientsPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [summary, setSummary] = useState<Summary | null>(null)

  const parseFile = useCallback(async (file: File) => {
    setSummary(null)
    try {
      // CSV/TSV/TXT: leer como TEXTO (UTF-8) — si se lee como binario, SheetJS no detecta el
      // codepage y destroza los acentos (Michifú -> MichifÃº). Los binarios (xlsx/xls/ods) sí van
      // por arrayBuffer.
      const isText = /\.(csv|tsv|txt)$/i.test(file.name)
      const wb = isText
        ? XLSX.read(await file.text(), { type: "string" })
        : XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array", cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "" })
      if (!matrix.length) {
        toast.error("El archivo está vacío.")
        return
      }
      const hs = (matrix[0] as unknown[]).map((h) => String(h ?? "").trim())
      const body = matrix.slice(1).map((r) => {
        const obj: Record<string, unknown> = {}
        hs.forEach((h, i) => (obj[h] = (r as unknown[])[i]))
        return obj
      })
      // descarta filas totalmente vacías
      const clean = body.filter((r) => hs.some((h) => String(r[h] ?? "").trim() !== ""))
      setFileName(file.name)
      setHeaders(hs)
      setRows(clean)
      setMapping(autoMap(hs))
      toast.success(`${clean.length} filas leídas de "${file.name}"`)
    } catch (e) {
      toast.error(`No se pudo leer el archivo: ${(e as Error).message}`)
    }
  }, [])

  const nameCol = mapping.name
  const mapped = useMemo(() => {
    if (!nameCol || nameCol === NONE) return []
    const get = (r: Record<string, unknown>, key: string) => {
      const col = mapping[key]
      return col && col !== NONE ? r[col] : ""
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
      ownerCache.set(`${norm(o.full_name)}|${norm(o.phone ?? "")}`, o.id)
    }

    for (let i = 0; i < validRows.length; i++) {
      const m = validRows[i]
      try {
        let ownerId: string | null = null
        if (m.owner_name) {
          const key = `${norm(m.owner_name)}|${norm(m.owner_phone ?? "")}`
          const keyNoPhone = `${norm(m.owner_name)}|`
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
      {headers.length > 0 && (
        <section className="rounded-xl border bg-card p-4 md:p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <FileSpreadsheet className="size-4 text-muted-foreground" /> Mapeo de columnas ({rows.length}{" "}
            filas)
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-xs">
                <span className="font-medium">
                  {f.label} {f.required && <span className="text-destructive">*</span>}
                </span>
                <select
                  value={mapping[f.key] ?? NONE}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value={NONE}>— (ninguna) —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {(!nameCol || nameCol === NONE) && (
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
