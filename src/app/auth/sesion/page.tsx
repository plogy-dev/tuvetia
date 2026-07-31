"use client"

// Cierra el enlace de invitación (y cualquier enlace de correo) para quien NO tiene cuenta.
//
// Supabase devuelve la sesión en el FRAGMENTO de la URL (`#access_token=…&refresh_token=…`), y el
// fragmento **nunca se envía al servidor**: es la parte que el navegador se guarda para sí. Por eso
// `/auth/callback` —que es una ruta de servidor— veía la petición sin `?code=` y mandaba al login;
// el invitado nuevo terminaba ahí en vez de en su invitación.
//
// Esta página es lo único que puede leerlo, porque corre en el navegador. Toma los tokens, abre la
// sesión y sigue al destino. El fragmento sobrevive a las redirecciones HTTP (RFC 7231 §7.1.2), así
// que llega hasta acá desde `/auth/callback` sin que haya que reenviarlo a mano.

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

import { parseAuthFragment, safeNext } from "@/lib/auth-fragment"
import { createClient } from "@/lib/supabase/client"

export default function CerrarSesionDeCorreo() {
  const router = useRouter()
  const [fallo, setFallo] = useState<string | null>(null)
  // StrictMode monta dos veces en desarrollo; `setSession` con el mismo token dos veces es
  // innecesario y ensucia el diagnóstico.
  const yaCorrio = useRef(false)

  useEffect(() => {
    if (yaCorrio.current) return
    yaCorrio.current = true

    const params = new URLSearchParams(window.location.search)
    const next = safeNext(params.get("next"))
    const alLogin = (motivo: string) => {
      setFallo(motivo)
      router.replace(`/login?error=auth&reason=${encodeURIComponent(motivo)}`)
    }

    const frag = parseAuthFragment(window.location.hash)
    if (frag.tipo === "error") return alLogin(frag.motivo)
    if (frag.tipo === "vacio") return alLogin(params.get("reason") || "missing_code")

    void (async () => {
      const supabase = createClient()
      const { error } = await supabase.auth.setSession({
        access_token: frag.accessToken,
        refresh_token: frag.refreshToken,
      })
      if (error) return alLogin(error.code ?? "set_session_failed")

      // Los tokens fuera de la barra de direcciones y del historial antes de seguir.
      window.history.replaceState(null, "", window.location.pathname + window.location.search)
      router.replace(next)
      router.refresh()   // que los componentes de servidor vean la sesión recién creada
    })()
  }, [router])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      {fallo ? (
        <p className="text-sm text-muted-foreground">
          No se pudo completar el ingreso. Te llevamos a iniciar sesión…
        </p>
      ) : (
        <>
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Completando tu ingreso…</p>
        </>
      )}
    </div>
  )
}
