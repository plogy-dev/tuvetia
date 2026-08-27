"use client"

// Pantalla para el caso "el usuario existe pero no tiene clínica".
//
// Antes esto no lo atendía nadie: `dashboard/layout.tsx` sólo redirigía al onboarding si HABÍA
// clínica, y `/bienvenida` rebotaba al dashboard si no la había. El resultado era un dashboard
// vacío, con todas las métricas en cero y sin una sola pista de qué hacer.
//
// Hay dos maneras de llegar acá, y necesitan respuestas distintas:
//   1. Invitación pendiente — `ensure_clinic_membership` NO crea clínica a propósito cuando el
//      correo tiene una invitación sin aceptar: el usuario debe entrar por el enlace del correo,
//      que es lo que lo mete a la clínica que ya existe. Crearle una propia sería justo lo
//      contrario de lo que quiere.
//   2. La clínica no se aprovisionó (el trigger no corrió). Ahí sí se le ofrece crearla.

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Building2, Loader2, MailCheck } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function SinClinica({
  tieneInvitacionPendiente,
  correo,
}: {
  tieneInvitacionPendiente: boolean
  correo?: string | null
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [nombre, setNombre] = useState("")
  const [busy, setBusy] = useState(false)
  const [saliendo, setSaliendo] = useState(false)

  // ── LA SALIDA, QUE NO EXISTÍA ─────────────────────────────────────────────────────────────────
  //
  // CIERRA LA SESIÓN ANTES DE IR A /login, y ese orden es lo único que hace que el botón sirva.
  // Con la sesión viva, `/login` ve un usuario autenticado y lo devuelve al dashboard, que lo
  // rebota a `/bienvenida`: el usuario volvería exactamente a donde estaba, que es el defecto que
  // este botón viene a arreglar.
  async function salir() {
    setSaliendo(true)
    try {
      await supabase.auth.signOut()
    } catch {
      // Si el cierre falla igual conviene llevarlo a /login: allá puede volver a intentar, y
      // quedarse acá encerrado es peor que una sesión que no se cerró.
    }
    router.replace("/login")
    router.refresh()
  }

  async function crearClinica() {
    const n = nombre.trim()
    if (!n) return
    setBusy(true)
    const { error } = await supabase.rpc("create_clinic", { clinic_name: n })
    if (error) {
      toast.error(`No se pudo crear la clínica: ${error.message}`)
      setBusy(false)
      return
    }
    router.refresh() // ya hay clinic_id -> esta misma ruta renderiza el wizard
  }

  if (tieneInvitacionPendiente) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-5 px-6 py-10 text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <MailCheck className="size-5" />
        </div>
        <h1 className="text-xl font-bold">Tienes una invitación pendiente</h1>
        <p className="text-sm text-muted-foreground">
          Alguien de tu equipo te invitó a su clínica. Abre el enlace que te llegó por correo para
          entrar: así te sumas a la clínica que ya existe, con sus pacientes e historial. Si creas
          una nueva quedarías por fuera de la de ellos.
        </p>
        {/* EL CORREO CON EL QUE ENTRÓ, ESCRITO. La causa más común de llegar acá y no encontrar
            nada es haberse registrado con una dirección distinta a la que recibió la invitación, y
            eso es imposible de notar si la app no dice con cuál estás adentro. */}
        {correo && (
          <p className="text-xs text-muted-foreground">
            Entraste como <span className="font-medium text-foreground">{correo}</span>. La
            invitación tiene que haber llegado a esa misma dirección.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          ¿No encuentras el correo? Pídele a quien te invitó que te reenvíe el enlace.
        </p>
        {/* ── SIN ESTO LA PANTALLA ERA UN CALLEJÓN SIN SALIDA ──────────────────────────────────
            Tenía un icono, un título y dos párrafos: CERO elementos en los que se pudiera hacer
            clic. Y no hay forma de irse por las malas —`dashboard/layout.tsx` rebota a
            `/bienvenida` en cada intento—, así que quien se registraba con otro correo quedaba
            encerrado hasta encontrar el mensaje o hasta que la invitación venciera a los 7 días.
            Es el mismo par de salidas que ya ofrece `cuenta-desactivada.tsx`, que es la otra
            pantalla del repo que retiene a alguien fuera del dashboard. */}
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <Button variant="outline" size="sm" render={<Link href="/" />}>
            Ir al inicio
          </Button>
          <Button variant="ghost" size="sm" onClick={salir} disabled={saliendo}>
            {saliendo && <Loader2 className="size-4 animate-spin" />} Entrar con otra cuenta
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-5 px-6 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Building2 className="size-5" />
        </div>
        <h1 className="text-xl font-bold">Creemos tu clínica</h1>
        <p className="text-sm text-muted-foreground">
          Tu cuenta todavía no está asociada a ninguna. Ponle nombre y seguimos con la configuración.
        </p>
      </div>
      <Field>
        <FieldLabel htmlFor="clinica-nueva">Nombre de la veterinaria</FieldLabel>
        <Input
          id="clinica-nueva"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Veterinaria San Martín"
        />
      </Field>
      <Button onClick={crearClinica} disabled={busy || !nombre.trim()}>
        {busy && <Loader2 className="size-4 animate-spin" />} Crear clínica
      </Button>
    </main>
  )
}
