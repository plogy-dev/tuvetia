import Link from "next/link"
import { ArrowLeft, Mail } from "lucide-react"

import { sesionDelServidor } from "@/lib/supabase/sesion"
import { PanelDeAvisos } from "@/components/avisos/panel-de-avisos"
import { SEGMENTOS } from "@/lib/avisos/audiencia"

export const metadata = { title: "Avisos a titulares · Tuvetia" }

export const dynamic = "force-dynamic"

export default async function AvisosPage() {
  const { supabase, user } = await sesionDelServidor()
  const { data: prof } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
    : { data: null }
  const esAdmin = (prof as { role?: string | null } | null)?.role === "admin"

  const segmentos = Object.entries(SEGMENTOS).map(([clave, s]) => ({
    clave,
    etiqueta: s.etiqueta,
    ayuda: s.ayuda,
  }))

  return (
    <section className="flex-1 min-w-0">
      <div className="mx-auto w-full max-w-2xl px-8 py-10">
        <header className="mb-6">
          <Link
            href="/dashboard/comunicaciones"
            className="mb-3 inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Comunicaciones
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-fg">
            <Mail className="size-5 text-fg-faint" aria-hidden />
            Avisos a titulares
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Un correo a un grupo de tus clientes. Sale firmado con el nombre de tu clínica y las
            respuestas te llegan a vos.
          </p>
        </header>

        <PanelDeAvisos segmentos={segmentos} puedeEnviar={esAdmin} />
      </div>
    </section>
  )
}
