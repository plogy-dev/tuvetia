// Las notas que quedaron en borrador, con nombre.
//
// LA CIFRA YA ESTABA y no alcanzaba: "3 notas por revisar" no dice cuáles, así que para hacer algo
// con ese número había que irse a la lista de consultas y filtrar. Este bloque las nombra y cada
// una lleva a su consulta.
//
// POR QUÉ IMPORTA MÁS DE LO QUE PARECE: ninguna nota entra a la historia clínica hasta que el vet
// la firma (regla 5). Una que se queda en borrador no es una tarea pendiente cualquiera — es una
// consulta que, a efectos del expediente, no ocurrió.

import Link from "next/link"
import { FileClock } from "lucide-react"

import { bogotaDateTime } from "@/lib/date-utils"

export type NotaEnBorrador = {
  id: string
  created_at: string
  consultation: { id: string; patient: { name: string } | null } | null
}

export function NotasPorAprobar({ notas }: { notas: NotaEnBorrador[] }) {
  // `p-4` como los demás paneles del tablero (gráfico y donas): era el único en `p-5`.
  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-line-soft bg-panel p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg-muted">
        {/* El ámbar de lo pendiente — el mismo de la pastilla «Notas por revisar». */}
        <FileClock className="size-3.5" style={{ color: "var(--chart-2)" }} aria-hidden />
        Notas por aprobar
      </p>

      {notas.length === 0 ? (
        <p className="text-sm text-fg-muted">
          Ninguna pendiente. Todas las consultas tienen su nota firmada.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {notas.map((n) => (
            <li key={n.id}>
              <Link
                href={`/dashboard/consultas/${n.consultation?.id ?? ""}`}
                className="flex items-center gap-3 rounded-[7px] px-2 py-1.5 transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                  {n.consultation?.patient?.name ?? "Consulta"}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-faint">
                  {bogotaDateTime(n.created_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/dashboard/consultas?nota=draft"
        className="mt-auto pt-1 text-[13px] font-medium text-brand-text hover:underline"
      >
        Ver todas
      </Link>
    </div>
  )
}
