// Piezas puras del retorno de autenticación. Sin React ni Next: se prueban solas.
//
// Contexto: hay DOS caminos de vuelta desde Supabase y no son intercambiables.
//
//   Login con Google  -> lo inicia el NAVEGADOR -> vuelve con `?code=` (PKCE)      -> /auth/callback
//   Enlace de correo  -> lo inicia el SERVIDOR  -> vuelve con tokens en `#`        -> /auth/sesion
//
// El segundo caso es el que dejaba al invitado sin cuenta en el login: el fragmento (`#`) **nunca
// viaja al servidor**, así que una ruta de servidor ve la petición sin código y concluye que falta.
// Sólo el navegador puede leerlo. Reproducción: `scripts/verificar_enlace_invitacion.py`.

/** Sólo paths internos como destino: evita un open redirect vía `?next=//evil.com`. */
export function safeNext(raw: string | null | undefined): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard"
}

export type AuthFragment =
  | { tipo: "sesion"; accessToken: string; refreshToken: string }
  | { tipo: "error"; motivo: string }
  | { tipo: "vacio" }

/**
 * Lee el fragmento con el que Supabase devuelve la sesión de un enlace de correo.
 *
 * Formato real, capturado de una invitación de producción:
 *   #access_token=…&expires_at=…&expires_in=3600&refresh_token=…&token_type=bearer&type=invite
 * Y cuando el enlace ya no sirve:
 *   #error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired
 */
export function parseAuthFragment(hash: string | null | undefined): AuthFragment {
  const crudo = (hash ?? "").replace(/^#/, "")
  if (!crudo) return { tipo: "vacio" }
  const p = new URLSearchParams(crudo)

  const error = p.get("error_code") || p.get("error")
  if (error) return { tipo: "error", motivo: error }

  const accessToken = p.get("access_token")
  const refreshToken = p.get("refresh_token")
  if (accessToken && refreshToken) return { tipo: "sesion", accessToken, refreshToken }

  return { tipo: "vacio" }
}
