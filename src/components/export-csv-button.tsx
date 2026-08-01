"use client"

// Exporta filas (ya filtradas por el servidor) a un CSV descargable — todo en el cliente.
import { DownloadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

// Además de `;`, comillas y saltos de línea, se neutraliza el PREFIJO de fórmula (`= + - @`): una
// celda que empieza por "=" se EJECUTA al abrir el CSV en Excel/LibreOffice (CSV injection). El
// apóstrofo inicial es el escape estándar de hoja de cálculo — el texto se muestra tal cual.
//
// La auditoría del 30-jul cerró esto en las dos exportaciones de facturación
// (`facturacion/domain/finance.ts`, `MovementsExport.tsx`) pero no en este componente genérico, que
// es el que usa el export de Pacientes: sus nombres de paciente y de titular son texto libre y
// además los rellena la importación con IA.
export function csvEscape(v: unknown): string {
  const s = String(v ?? "")
  const seguro = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n;]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro
}

export function ExportCsvButton({
  filename,
  headers,
  rows,
}: {
  filename: string
  headers: string[]
  rows: (string | number | null)[][]
}) {
  function download() {
    const lines = [headers, ...rows].map((r) => r.map(csvEscape).join(";"))
    // BOM para que Excel abra bien los acentos
    const blob = new Blob(["﻿" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Button variant="outline" size="sm" onClick={download}>
      <DownloadIcon className="size-4" /> Exportar
    </Button>
  )
}
