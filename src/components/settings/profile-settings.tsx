"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, LogOutIcon } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// Parte interactiva de Settings: editar el nombre (RLS: profiles_update = id == auth.uid()) y cerrar sesión.
export function ProfileSettings({ userId, initialName }: { userId: string; initialName: string }) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from("profiles").update({ full_name: name.trim() }).eq("id", userId)
    setSaving(false)
    if (error) {
      toast.error(`No se pudo guardar: ${error.message}`)
      return
    }
    toast.success("Perfil actualizado")
    router.refresh()
  }

  async function signOut() {
    setSigningOut(true)
    await supabase.auth.signOut()
    router.push("/")
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="settings-name">Tu nombre</FieldLabel>
          <Input
            id="settings-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <div>
          <Button type="submit" disabled={saving || name.trim() === initialName.trim()}>
            {saving && <Loader2Icon className="animate-spin" />} Guardar cambios
          </Button>
        </div>
      </form>

      <div className="border-t pt-4">
        <Button
          variant="outline"
          onClick={signOut}
          disabled={signingOut}
          className="text-destructive hover:text-destructive"
        >
          {signingOut ? <Loader2Icon className="animate-spin" /> : <LogOutIcon className="size-4" />}
          Cerrar sesión
        </Button>
      </div>
    </div>
  )
}
