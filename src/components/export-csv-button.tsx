"use client"

// Exporta filas (ya filtradas por el servidor) a un CSV descargable — todo en el cliente.
import { DownloadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

function csvEscape(v: unknown): string {
  const s = String(v ?? "")
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
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
