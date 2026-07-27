"use client"

// Pantalla única de onboarding (reemplaza el wizard de 5 pasos): logo + nombre de la clínica.
// La clínica YA existe en este punto (la crea el trigger de BD on_auth_user_confirmed con un
// nombre placeholder) — esto solo la personaliza y marca setup_completed_at.

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
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
}: {
  clinicId: string
  initialClinicName: string
  initialLogoUrl: string | null
}) {
  const router = useRouter()
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

      const { error: setupErr } = await supabase.rpc("mark_setup_completed")
      if (setupErr) throw new Error(setupErr.message)

      router.push("/dashboard")
      router.refresh()
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`)
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Building2 className="size-5" />
        </div>
        <h1 className="text-xl font-bold">Configura tu clínica</h1>
        <p className="text-sm text-muted-foreground">
          Estos datos identifican tu clínica en TuvetIA — los puedes cambiar después.
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
