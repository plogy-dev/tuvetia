"use client"

// Archivos del paciente (exámenes, radiografías, resultados de laboratorio…).
// Bucket PRIVADO `patient-attachments` (ruta <clinic_id>/<patient_id>/<uuid>.<ext>,
// RLS de Storage por clínica) + fila en public.patient_attachments (file_url = la ruta).
// Al abrir se pide una signed URL temporal — mismo patrón que el audio de consulta.

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  FileIcon,
  FileTextIcon,
  ImageIcon,
  Loader2Icon,
  PaperclipIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

const BUCKET = "patient-attachments"
const SIGNED_URL_TTL = 60 * 60 // 1 h
const MAX_MB = 25

export type PatientAttachment = {
  id: string
  label: string
  file_url: string
  file_type: string | null
  file_size: number | null
  created_at: string
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return ""
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })
}

function TypeIcon({ type }: { type: string | null }) {
  if (type?.startsWith("image/")) return <ImageIcon className="size-4" />
  if (type === "application/pdf") return <FileTextIcon className="size-4" />
  return <FileIcon className="size-4" />
}

export function PatientAttachments({
  clinicId,
  patientId,
  attachments,
}: {
  clinicId: string
  patientId: string
  attachments: PatientAttachment[]
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (inputRef.current) inputRef.current.value = ""
    if (!file) return
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`El archivo supera ${MAX_MB} MB.`)
      return
    }
    setUploading(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const ext = file.name.split(".").pop()?.toLowerCase() || "bin"
      const path = `${clinicId}/${patientId}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false })
      if (upErr) throw new Error(upErr.message)
      const { error: rowErr } = await supabase.from("patient_attachments").insert({
        clinic_id: clinicId,
        patient_id: patientId,
        label: file.name,
        file_url: path,
        file_type: file.type || null,
        file_size: file.size,
        uploaded_by: user?.id ?? null,
      })
      if (rowErr) {
        await supabase.storage.from(BUCKET).remove([path]) // no dejar huérfanos
        throw new Error(rowErr.message)
      }
      toast.success(`"${file.name}" adjuntado a la historia`)
      router.refresh()
    } catch (err) {
      toast.error(`No se pudo subir el archivo: ${(err as Error).message}`)
    } finally {
      setUploading(false)
    }
  }

  async function openFile(a: PatientAttachment) {
    setOpening(a.id)
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(a.file_url, SIGNED_URL_TTL)
    setOpening(null)
    if (error || !data?.signedUrl) {
      toast.error(`No se pudo abrir el archivo: ${error?.message ?? "URL no disponible"}`)
      return
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer")
  }

  async function deleteFile(a: PatientAttachment) {
    setDeleting(a.id)
    const { error: rowErr } = await supabase.from("patient_attachments").delete().eq("id", a.id)
    if (rowErr) {
      setDeleting(null)
      toast.error(`No se pudo eliminar: ${rowErr.message}`)
      return
    }
    await supabase.storage.from(BUCKET).remove([a.file_url])
    setDeleting(null)
    setConfirmDelete(null)
    toast.success(`"${a.label}" eliminado`)
    router.refresh()
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <PaperclipIcon className="size-4 text-muted-foreground" /> Archivos y exámenes (
          {attachments.length})
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.dcm"
          onChange={handleUpload}
        />
        <Button size="sm" variant="outline" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2Icon className="size-4 animate-spin" /> : <UploadIcon className="size-4" />}
          Subir archivo
        </Button>
      </div>

      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin archivos adjuntos. Sube exámenes médicos, radiografías o resultados de laboratorio —
          quedan guardados en la historia del paciente.
        </p>
      ) : (
        <ul className="divide-y">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-secondary text-muted-foreground">
                <TypeIcon type={a.file_type} />
              </span>
              <button
                type="button"
                onClick={() => openFile(a)}
                className="min-w-0 flex-1 text-left"
                title="Abrir en una pestaña nueva"
              >
                <span className="block truncate text-sm font-medium underline-offset-2 hover:underline">
                  {a.label}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {fmtDate(a.created_at)}
                  {a.file_size ? ` · ${fmtSize(a.file_size)}` : ""}
                </span>
              </button>
              {opening === a.id && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
              {confirmDelete === a.id ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={deleting === a.id}
                    onClick={() => deleteFile(a)}
                  >
                    {deleting === a.id ? <Loader2Icon className="size-4 animate-spin" /> : "Eliminar"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Eliminar ${a.label}`}
                  onClick={() => setConfirmDelete(a.id)}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
