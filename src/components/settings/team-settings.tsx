"use client"

// Equipo de la clínica (Settings): miembros, invitaciones pendientes y "Invitar colega".
// Crear invitación = RPC create_invitation (solo admins, valida en BD) -> link para compartir
// (WhatsApp/como sea) + intento de email automático best-effort (/api/team/invite-email).

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Copy, Loader2, Mail, Trash2, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const ROLE_LABELS: Record<string, string> = { admin: "Administrador", vet: "Veterinario" }

export type TeamMember = { id: string; full_name: string | null; role: string }
export type PendingInvitation = { id: string; email: string; role: string; expires_at: string }

export function TeamSettings({
  isAdmin,
  members,
  invitations,
}: {
  isAdmin: boolean
  members: TeamMember[]
  invitations: PendingInvitation[]
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"vet" | "admin">("vet")
  const [creating, setCreating] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setInviteLink(null)
    const { data: token, error } = await supabase.rpc("create_invitation", {
      p_email: email.trim(),
      p_role: role,
    })
    setCreating(false)
    if (error || !token) {
      toast.error(`No se pudo crear la invitación: ${error?.message ?? "desconocido"}`)
      return
    }
    const link = `${window.location.origin}/invitar/${token}`
    setInviteLink(link)
    toast.success("Invitación creada — compartí el link")
    router.refresh()
    // Email automático best-effort: si falla, el link sigue siendo el camino.
    void fetch("/api/team/invite-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).then(async (r) => {
      const j = (await r.json().catch(() => ({}))) as { sent?: boolean }
      if (j.sent) toast.success("También le enviamos la invitación por email")
    })
  }

  async function copyLink() {
    if (!inviteLink) return
    await navigator.clipboard.writeText(inviteLink)
    toast.success("Link copiado")
  }

  async function revoke(id: string) {
    const { error } = await supabase.from("invitations").delete().eq("id", id)
    if (error) toast.error(`No se pudo revocar: ${error.message}`)
    else {
      toast.success("Invitación revocada")
      router.refresh()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Miembros */}
      <ul className="flex flex-col gap-1.5 text-sm">
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2">
            <span className="font-medium">{m.full_name ?? "—"}</span>
            <span className="text-xs text-muted-foreground">{ROLE_LABELS[m.role] ?? m.role}</span>
          </li>
        ))}
      </ul>

      {isAdmin && (
        <>
          {/* Invitaciones pendientes */}
          {invitations.length > 0 && (
            <div className="border-t pt-3">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                Invitaciones pendientes
              </div>
              <ul className="flex flex-col gap-1.5 text-sm">
                {invitations.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate">{i.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {ROLE_LABELS[i.role] ?? i.role}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => revoke(i.id)}
                      aria-label={`Revocar invitación a ${i.email}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Invitar colega */}
          <form onSubmit={invite} className="flex flex-col gap-3 border-t pt-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <UserPlus className="size-4 text-muted-foreground" /> Invitar colega
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field>
                <FieldLabel htmlFor="invite-email">Email del colega</FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colega@clinica.com"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="invite-role">Rol</FieldLabel>
                <Select value={role} onValueChange={(v) => setRole(((v as string) ?? "vet") as "vet" | "admin")}>
                  <SelectTrigger id="invite-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="vet">Veterinario</SelectItem>
                      <SelectItem value="admin">Administrador</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={creating}>
                {creating ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                Crear invitación
              </Button>
              {inviteLink && (
                <>
                  <Input readOnly value={inviteLink} className="max-w-xs font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button type="button" variant="outline" onClick={copyLink}>
                    <Copy className="size-4" /> Copiar link
                  </Button>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              El link vence en 7 días. Compartilo por WhatsApp o email; al aceptarlo, tu colega entra
              a esta clínica con acceso a sus datos.
            </p>
          </form>
        </>
      )}
    </div>
  )
}
