"use client"

// PASO 1 del onboarding: logo + nombre de la clínica.
//
// La clínica YA existe en este punto (la crea el trigger de BD on_auth_user_confirmed con un
// nombre placeholder) — esto solo la personaliza. Es el único paso obligatorio del wizard.
//
// No marca `setup_completed_at` ni redirige: de eso se encarga el wizard al terminar
// (`welcome-wizard.tsx`). Así los pasos opcionales que siguen —primer paciente, datos de ejemplo,
// invitar al equipo— no quedan inalcanzables por cerrar el flujo acá.

import { useRef, useState } from "react"
import { Building2, Loader2, UploadIcon } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

const BUCKET = "clinic-logos"
const MAX_MB = 10

export function WorkspaceSetup({
  clinicId,
  initialClinicName,
  initialLogoUrl,
  onSaved,
}: {
  clinicId: string
  initialClinicName: string
  initialLogoUrl: string | null
  /** Lo llama el wizard para avanzar al paso siguiente, con el nombre ya guardado. */
  onSaved: (clinicName: string) => void
}) {
  const [supabase] = useState(() => createClient())
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(initialClinicName)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(initialLogoUrl)
  const [busy, setBusy] = useState(false)

  function pickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (inputRef.current) inputRef.current.value = ""
    if (!file) return
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`El logo supera ${MAX_MB} MB.`)
      return
    }
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  async function continueSetup() {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      let logoUrl = initialLogoUrl
      if (logoFile) {
        const ext = logoFile.name.split(".").pop()?.toLowerCase() || "png"
        const path = `${clinicId}/logo.${ext}`
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, logoFile, { upsert: true, contentType: logoFile.type || "image/png" })
        if (upErr) throw new Error(upErr.message)
        logoUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
      }

      const { error: clinicErr } = await supabase
        .from("clinics")
        .update({ name: trimmed, logo_url: logoUrl })
        .eq("id", clinicId)
      if (clinicErr) throw new Error(clinicErr.message)

      setBusy(false)
      onSaved(trimmed)
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`)
      setBusy(false)
    }
  }

  return (
    // Sin `min-h-svh` ni centrado: el marco lo pone el wizard. Antes este componente era la
    // pantalla entera y se lo quedaba para él.
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Building2 className="size-5" />
        </div>
        <h1 className="text-xl font-bold">Configura tu clínica</h1>
        <p className="text-sm text-muted-foreground">
          Estos datos identifican tu clínica en Tuvetia — los puedes cambiar después.
        </p>
      </div>

      <Field>
        <FieldLabel>Logo</FieldLabel>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed bg-muted text-muted-foreground"
            aria-label="Subir logo"
          >
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="" className="size-full object-cover" />
            ) : (
              <UploadIcon className="size-5" />
            )}
          </button>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={pickLogo} />
          <div className="flex flex-col gap-1">
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              Subir
            </Button>
            <FieldDescription>Tamaño recomendado 1:1, hasta {MAX_MB}MB.</FieldDescription>
          </div>
        </div>
      </Field>

      <Field>
        <FieldLabel htmlFor="workspace-name">Nombre de la veterinaria</FieldLabel>
        <Input id="workspace-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>

      <Button onClick={continueSetup} disabled={busy || !name.trim()}>
        {busy && <Loader2 className="size-4 animate-spin" />} Continuar
      </Button>
    </div>
  )
}
