"use client"

// Equipo de la clínica (Settings): miembros, invitaciones pendientes y "Invitar colega".
// Crear invitación = RPC create_invitation (solo admins, valida en BD) -> link, con dos caminos
// para hacérselo llegar al colega, los dos a un clic y los dos explícitos: COPIAR el link (para
// mandarlo por WhatsApp o donde sea) o ENVIAR la invitación al correo con el que se creó, que sale
// por Resend (/api/team/invite-email).
//
// El envío es un botón y no algo automático a propósito: antes salía solo, en segundo plano, y el
// admin no sabía si había llegado ni podía reintentar. Ahora el resultado se dice —y si falla, el
// link sigue ahí, que es el camino garantizado.
//
// Quitar miembro = RPC remove_clinic_member (solo admins, valida en BD: no a uno mismo, no al
// único admin restante).

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarDays, Copy, Loader2, Mail, Send, Trash2, UserPlus, UserX } from "lucide-react"
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

export type TeamMember = {
  id: string
  full_name: string | null
  email: string
  role: string
  /** Permiso otorgable de ver la agenda de toda la clínica (0070). */
  ve_agenda_completa?: boolean | null
}
export type PendingInvitation = { id: string; email: string; role: string; expires_at: string }

function initialsOf(name: string | null, fallback: string) {
  const source = name?.trim() || fallback
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("")
}

/** Las dos opciones de rol, para los dos selects de esta pantalla.
 *
 * `items` NO es decorativo: Base UI lo usa para que `<SelectValue />` muestre la ETIQUETA y no el
 * valor. Sin él se lee "vet" donde va "Veterinario" — que es lo que pasaba en la lista del equipo.
 */
const ROLES = [
  { label: "Veterinario", value: "vet" },
  { label: "Administrador", value: "admin" },
]

export function TeamSettings({
  isAdmin,
  members,
  invitations,
  currentUserId,
}: {
  isAdmin: boolean
  members: TeamMember[]
  invitations: PendingInvitation[]
  currentUserId: string
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"vet" | "admin">("vet")
  const [creating, setCreating] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  // El permiso de agenda, optimista y por persona: `id` mientras la RPC va en camino.
  const [permisos, setPermisos] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(members.map((m) => [m.id, m.ve_agenda_completa === true])),
  )
  const [cambiandoPermiso, setCambiandoPermiso] = useState<string | null>(null)
  const [cambiandoRol, setCambiandoRol] = useState<string | null>(null)
  // La invitación recién creada: el link para copiar y el token+email para poder enviarla.
  const [invite, setInvite] = useState<{ token: string; email: string; link: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function createInvite(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setInvite(null)
    setSent(false)
    const destino = email.trim()
    const { data: token, error } = await supabase.rpc("create_invitation", {
      p_email: destino,
      p_role: role,
    })
    setCreating(false)
    if (error || !token) {
      toast.error(`No se pudo crear la invitación: ${error?.message ?? "desconocido"}`)
      return
    }
    setInvite({ token, email: destino, link: `${window.location.origin}/invitar/${token}` })
    toast.success("Invitación creada — enviala por correo o copiá el link")
    router.refresh()
  }

  async function copyLink() {
    if (!invite) return
    await navigator.clipboard.writeText(invite.link)
    toast.success("Link copiado")
  }

  async function sendInvite() {
    if (!invite) return
    setSending(true)
    const res = await fetch("/api/team/invite-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: invite.token }),
    }).catch(() => null)
    const body = (await res?.json().catch(() => ({}))) as { sent?: boolean; reason?: string }
    setSending(false)
    if (body.sent) {
      setSent(true)
      toast.success(`Invitación enviada a ${invite.email}`)
      return
    }
    // El correo no salió, pero la invitación existe: el link de al lado sigue sirviendo.
    toast.error(
      body.reason
        ? `No se pudo enviar el correo: ${body.reason}`
        : "No se pudo enviar el correo. Copiá el link y mandáselo por otro medio.",
    )
  }

  async function revoke(id: string) {
    const { error } = await supabase.from("invitations").delete().eq("id", id)
    if (error) toast.error(`No se pudo revocar: ${error.message}`)
    else {
      toast.success("Invitación revocada")
      router.refresh()
    }
  }

  /**
   * Otorga o quita el permiso de ver la agenda de toda la clínica.
   *
   * VA POR RPC Y NO POR UN UPDATE DIRECTO, y no es una preferencia de estilo: un trigger en
   * `profiles` bloquea que esta columna se escriba desde el cliente (0070). Sin eso, cualquiera
   * podría dárselo a sí mismo desde la consola del navegador — la policy de `profiles` deja que
   * cada uno edite su propio perfil.
   */
  async function cambiarPermisoDeAgenda(member: TeamMember, puede: boolean) {
    setCambiandoPermiso(member.id)
    const antes = permisos[member.id] === true
    setPermisos((p) => ({ ...p, [member.id]: puede }))
    const { error } = await supabase.rpc("otorgar_agenda_completa", {
      p_vet_id: member.id,
      p_puede: puede,
    })
    setCambiandoPermiso(null)
    if (error) {
      setPermisos((p) => ({ ...p, [member.id]: antes }))
      toast.error(`No se pudo cambiar el permiso: ${error.message}`)
      return
    }
    toast.success(
      puede
        ? `${member.full_name ?? member.email} ya ve la agenda de toda la clínica`
        : `${member.full_name ?? member.email} vuelve a ver sólo su agenda`,
    )
    router.refresh()
  }

  /**
   * Asciende o baja a alguien del equipo.
   *
   * SIN CONFIRMACIÓN, a diferencia de quitar. Cambiar un rol es reversible con el mismo control y
   * en el mismo lugar; quitar a alguien lo saca de la clínica y hay que reinvitarlo. Pedir
   * confirmación para lo reversible enseña a apretar "sí" sin leer, y así el día que aparezca la
   * de quitar tampoco se lee.
   *
   * LA RPC ES LA QUE DECIDE. Acá se esconde el control sobre uno mismo, pero eso es comodidad, no
   * autorización: `cambiar_rol_de_miembro` rechaza igual cambiarse el rol propio, tocar a alguien
   * de otra clínica, y dejar la clínica sin administrador.
   */
  async function cambiarRol(member: TeamMember, rol: "vet" | "admin") {
    if (rol === member.role) return
    setCambiandoRol(member.id)
    const { error } = await supabase.rpc("cambiar_rol_de_miembro", {
      p_member_id: member.id,
      p_rol: rol,
    })
    setCambiandoRol(null)
    if (error) {
      toast.error(`No se pudo cambiar el rol: ${error.message}`)
      return
    }
    toast.success(
      rol === "admin"
        ? `${member.full_name ?? member.email} ahora es administrador`
        : `${member.full_name ?? member.email} vuelve a ser veterinario`,
    )
    router.refresh()
  }

  async function removeMember(member: TeamMember) {
    const ok = window.confirm(
      `¿Quitar a ${member.full_name ?? member.email} de la clínica? Deja de ver pacientes, consultas y agenda de tu equipo.`,
    )
    if (!ok) return
    setRemovingId(member.id)
    const { error } = await supabase.rpc("remove_clinic_member", { p_member_id: member.id })
    setRemovingId(null)
    if (error) toast.error(`No se pudo quitar: ${error.message}`)
    else {
      toast.success(`${member.full_name ?? member.email} ya no pertenece a la clínica`)
      router.refresh()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Miembros */}
      <ul className="flex flex-col gap-1">
        {members.map((m) => {
          const isSelf = m.id === currentUserId
          return (
            <li key={m.id} className="group flex items-center gap-3 rounded-lg px-1.5 py-1.5 -mx-1.5 hover:bg-accent/50">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {initialsOf(m.full_name, m.email)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="truncate">{m.full_name ?? m.email}</span>
                  {isSelf && <span className="shrink-0 text-xs font-normal text-muted-foreground">(vos)</span>}
                </div>
                <div className="truncate text-xs text-muted-foreground">{m.email}</div>
              </div>
              {/* EL ROL, EDITABLE. Antes era sólo una etiqueta: ascender a un veterinario obligaba
                  a QUITARLO y volver a invitarlo, y quitarlo lo saca de la clínica de verdad —
                  deja de ver pacientes, consultas y agenda hasta que acepte la nueva invitación.

                  SOBRE UNO MISMO SIGUE SIENDO UNA ETIQUETA. Un admin que se degrada pierde el
                  control con el que se lo devolvería, y si es el único deja la clínica sin
                  administrador: sin nadie que pueda invitar, quitar ni otorgar nada. La RPC lo
                  rechaza igual; acá ni siquiera se ofrece. */}
              {isAdmin && !isSelf ? (
                <Select
                  value={m.role}
                  onValueChange={(v) => cambiarRol(m, ((v as string) ?? "vet") as "vet" | "admin")}
                  disabled={cambiandoRol === m.id}
                  items={ROLES}
                >
                  <SelectTrigger
                    className="h-7 w-[132px] shrink-0 text-xs"
                    aria-label={`Rol de ${m.full_name ?? m.email}`}
                  >
                    {cambiandoRol === m.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <SelectValue />
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vet">Veterinario</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {ROLE_LABELS[m.role] ?? m.role}
                </span>
              )}
              {/* EL PERMISO DE AGENDA, sólo para quien puede otorgarlo y sólo sobre quien lo
                  necesita. A un admin no se le muestra: ya la ve por ser admin, y un interruptor
                  apagado que no cambia nada es peor que ninguno — invita a tocarlo. */}
              {isAdmin && m.role !== "admin" && (
                <label
                  className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
                  title="Ver la agenda de toda la clínica, no sólo la propia"
                >
                  <input
                    type="checkbox"
                    checked={permisos[m.id] === true}
                    disabled={cambiandoPermiso === m.id}
                    onChange={(e) => cambiarPermisoDeAgenda(m, e.target.checked)}
                    className="size-3.5 accent-primary"
                  />
                  <CalendarDays className="size-3.5" aria-hidden />
                  <span className="hidden sm:inline">Agenda completa</span>
                </label>
              )}
              {/* QUITAR SE VE SIEMPRE, NO SÓLO AL PASAR EL MOUSE.
                  Estaba en `opacity-0 group-hover:opacity-100`, y una función que sólo existe
                  mientras el puntero está encima es una función que no existe: no se descubre
                  mirando, y en una tablet —donde no hay hover— no aparece nunca. Felipe preguntó
                  el 26-ago por qué no veía «sacar vets o cambiarles el rango» estando los dos ya
                  construidos; el rol no se le mostraba por ser él el único miembro (ver abajo) y
                  esto, además, estaba escondido.

                  Y se RENDERIZA sólo cuando hay a quién quitar, en vez de pintarse deshabilitado
                  e invisible sobre uno mismo: un botón que existe en el DOM pero no se ve ni se
                  puede usar sólo sirve para confundir a un lector de pantalla. */}
              {isAdmin && !isSelf && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeMember(m)}
                  disabled={removingId === m.id}
                  aria-label={`Quitar a ${m.full_name ?? m.email} de la clínica`}
                  title="Quitar de la clínica"
                >
                  {removingId === m.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <UserX className="size-3.5" />
                  )}
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      {/* POR QUÉ ACÁ NO SE VE NADA CUANDO ESTÁS SOLO.
          Ni el selector de rol ni el botón de quitar se ofrecen sobre uno mismo —degradarte te
          deja sin el control con el que te lo devolverías, y quitarte te saca de tu propia
          clínica—, así que en una clínica de una persona la lista es una fila sin ningún control
          y parece que las funciones no existen. Es exactamente lo que preguntó Felipe el 26-ago.
          Decirlo cuesta una línea y ahorra la pregunta. */}
      {isAdmin && members.length === 1 && (
        <p className="rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
          Sos la única persona en esta clínica. Cuando invites a un colega vas a poder{" "}
          <b className="font-medium text-fg">cambiarle el rol</b> o{" "}
          <b className="font-medium text-fg">quitarlo de la clínica</b> desde esta misma lista.
        </p>
      )}

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
          <form onSubmit={createInvite} className="flex flex-col gap-3 border-t pt-3">
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
                <Select
                  value={role}
                  onValueChange={(v) => setRole(((v as string) ?? "vet") as "vet" | "admin")}
                  items={ROLES}
                >
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
            <div>
              <Button type="submit" disabled={creating}>
                {creating ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                Crear invitación
              </Button>
            </div>

            {invite && (
              <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
                <div className="text-xs text-muted-foreground">
                  Invitación para <b className="text-foreground">{invite.email}</b>
                  {sent && " · enviada"}
                </div>
                <Input
                  readOnly
                  value={invite.link}
                  className="font-mono text-xs"
                  aria-label="Link de invitación"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={sendInvite} disabled={sending}>
                    {sending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                    {sent ? "Reenviar invitación" : "Enviar invitación"}
                  </Button>
                  <Button type="button" variant="outline" onClick={copyLink}>
                    <Copy className="size-4" /> Copiar link
                  </Button>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              El link vence en 7 días. Enviáselo por correo desde acá o copialo para mandarlo por
              WhatsApp; al aceptarlo, tu colega entra a esta clínica con acceso a sus datos.
            </p>
          </form>
        </>
      )}
    </div>
  )
}
