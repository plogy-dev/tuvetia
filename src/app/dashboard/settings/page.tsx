import { Building2, MessageCircle, User } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { ProfileSettings } from "@/components/settings/profile-settings"
import { WhatsappSettings } from "@/components/settings/whatsapp-settings"
import { HelpTip } from "@/components/help-tip"

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  vet: "Veterinario",
  assistant: "Asistente",
}

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const profile = user
    ? (
        await supabase
          .from("profiles")
          .select("full_name, role, clinic_id")
          .eq("id", user.id)
          .single()
      ).data
    : null
  const p = profile as { full_name: string | null; role: string | null; clinic_id: string | null } | null

  const clinic = p?.clinic_id
    ? (await supabase.from("clinics").select("name").eq("id", p.clinic_id).single()).data
    : null
  const clinicName = (clinic as { name: string } | null)?.name ?? "—"

  // Estado de la conexión de WhatsApp (RLS: solo la fila de la clínica; columnas no sensibles).
  const { data: wa } = await supabase
    .from("whatsapp_integrations")
    .select("status, phone_number")
    .maybeSingle()
  const waRow = wa as { status: "pending" | "connected" | "disconnected"; phone_number: string | null } | null
  const waStatus = waRow?.status === "connected" ? "connected" : waRow ? "pending" : "none"

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4 md:py-6 lg:px-6">
      <h1 className="text-lg font-semibold">Configuración</h1>

      {/* Clínica (solo lectura) */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4 text-muted-foreground" /> Clínica
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Nombre</dt>
          <dd className="font-medium">{clinicName}</dd>
          <dt className="text-muted-foreground">Tu rol</dt>
          <dd>{p?.role ? (ROLE_LABELS[p.role] ?? p.role) : "—"}</dd>
        </dl>
      </div>

      {/* WhatsApp de la clínica (Kapso, multi-tenant) */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <MessageCircle className="size-4 text-muted-foreground" /> WhatsApp
          <HelpTip>
            Cada clínica conecta <b>su propio</b> número de WhatsApp escaneando un QR — sin compartir
            credenciales. La bandeja de conversaciones llegará en la sección Comunicaciones.
          </HelpTip>
        </div>
        <WhatsappSettings initialStatus={waStatus} initialPhone={waRow?.phone_number ?? null} />
      </div>

      {/* Perfil (editable) */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <User className="size-4 text-muted-foreground" /> Tu perfil
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {user?.email ?? "—"}
        </p>
        {user && <ProfileSettings userId={user.id} initialName={p?.full_name ?? ""} />}
      </div>
    </div>
  )
}
