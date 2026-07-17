import Link from "next/link"
import { ChevronRightIcon, GhostIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { createClient } from "@/lib/supabase/server"

const CONSULTATION_STATUS: Record<string, string> = {
  open: "Abierta",
  transcribing: "Transcribiendo",
  generating_note: "Generando nota",
  review: "En revisión",
  completed: "Completada",
}

const NOTE_STATUS: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  draft: { label: "Borrador", variant: "secondary" },
  approved: { label: "Aprobada", variant: "default" },
  locked: { label: "Bloqueada", variant: "outline" },
}

type ConsultationRow = {
  id: string
  status: string
  chief_complaint: string | null
  started_at: string
  // PostgREST devuelve el embed to-one (patient_id -> patients.id) como objeto,
  // pero el query builder no tipado lo infiere como arreglo.
  patient: { name: string; species: string } | null
  notes: { id: string; status: string }[] | null
}

export default async function ConsultasPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from("consultations")
    .select(
      "id, status, chief_complaint, started_at, patient:patients(name, species), notes:clinical_notes(id, status)"
    )
    .order("started_at", { ascending: false })
    .limit(50)
  const consultas = (data as unknown as ConsultationRow[] | null) ?? []

  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <div className="flex items-center gap-2">
        <GhostIcon className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Modo fantasma — notas de consulta</h1>
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Al cerrar una consulta, Athos redacta una nota SOAP con citas verificables de
        literatura veterinaria. Revísala, edítala y apruébala: ninguna nota entra a la
        historia clínica sin tu aprobación.
      </p>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead>Paciente</TableHead>
              <TableHead>Motivo de consulta</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Nota</TableHead>
              <TableHead className="w-16 text-right">Revisar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {consultas.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-12 text-center text-muted-foreground"
                >
                  No hay consultas todavía. Cuando el Modo Fantasma cierre una consulta,
                  aparecerá aquí para tu revisión.
                </TableCell>
              </TableRow>
            )}
            {consultas.map((c) => {
              const note = c.notes?.[0]
              const noteMeta = note ? NOTE_STATUS[note.status] : null
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.patient?.name ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {c.chief_complaint ?? "—"}
                  </TableCell>
                  <TableCell>{CONSULTATION_STATUS[c.status] ?? c.status}</TableCell>
                  <TableCell>
                    {noteMeta ? (
                      <Badge variant={noteMeta.variant}>{noteMeta.label}</Badge>
                    ) : (
                      <span className="text-muted-foreground">Sin nota</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/dashboard/consultas/${c.id}`}
                      className="inline-flex items-center justify-end text-primary hover:underline"
                      aria-label="Revisar consulta"
                    >
                      <ChevronRightIcon className="size-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
