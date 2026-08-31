import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

const PROTECTED_PREFIXES = ["/dashboard"]
// El login vive ahora en /login (la raíz es la landing pública de marketing).
const AUTH_PREFIXES = ["/login", "/signup"]

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  let user = null
  try {
    let result = await supabase.auth.getUser()

    // ── EL SERVICIO PUEDE MENTIR, Y EL 31-AGO MINTIÓ ──────────────────────────────────────────
    //
    // Incidente oficial de Supabase («401 errors due to JWT rejections», gateway degradado): el
    // gateway rechazaba tokens VÁLIDOS de forma intermitente. Con el código de antes, ese rechazo
    // transitorio era fatal dos veces: (1) el `user` nulo mandaba a /login, y (2) el intento de
    // refresh fallido hacía que supabase-js BORRARA las cookies de sesión — y
    // `redirectPreservingSession` preserva fielmente lo que haya, incluido un borrado. Un parpadeo
    // de minutos del proveedor confiscaba sesiones para siempre. Le pasó a Felipe con la entrega
    // al día siguiente.
    //
    // La defensa, en dos capas:
    //  1. REINTENTAR UNA VEZ. El rechazo del incidente es intermitente: el segundo intento suele
    //     pasar. Un usuario genuinamente deslogueado (sin cookies) no llega acá con error: getUser
    //     sin sesión devuelve user nulo SIN error, y sigue derecho a /login como siempre.
    //  2. Si el segundo intento también falla CON ERROR y la petición traía cookies de auth, se
    //     responde con la request INTACTA — sin el redirect y, crucial, sin las cookies de borrado
    //     que este `supabaseResponse` pueda arrastrar. La página del servidor fallará suave o
    //     pedirá recargar, pero la SESIÓN sobrevive al incidente, que es lo que no puede perderse.
    if (!result.data.user && result.error) {
      result = await supabase.auth.getUser()
    }
    user = result.data.user

    if (!user && result.error) {
      const traiaSesion = request.cookies.getAll().some((c) => c.name.startsWith("sb-"))
      if (traiaSesion) {
        console.error(
          `updateSession: el servicio de auth rechazó una sesión existente dos veces (${result.error.message}). ` +
            "Se deja pasar SIN tocar cookies: puede ser un incidente del proveedor, no un usuario inválido.",
        )
        // Respuesta fresca sobre la request original: descarta cualquier Set-Cookie de borrado.
        return NextResponse.next({ request })
      }
    }
  } catch (e) {
    // Hipo transitorio de Supabase Auth (red/timeout): NO tratarlo como "no autenticado" ni romper
    // toda la app con un 500. Dejamos pasar; la página valida de nuevo. Evita rebotes falsos a /login.
    console.error("updateSession: getUser falló, se deja pasar la request:", e)
    return supabaseResponse
  }

  const { pathname } = request.nextUrl
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))
  const isAuthPage = AUTH_PREFIXES.includes(pathname)

  // Redirige PRESERVANDO las cookies de sesión que getUser pudo refrescar. Sin esto, el navegador
  // sigue el redirect con las cookies viejas ya invalidadas (rotación de refresh token) -> queda
  // deslogueado o en loop / ↔ /dashboard. Es el footgun canónico de @supabase/ssr.
  const redirectPreservingSession = (pathnameTo: string) => {
    const url = request.nextUrl.clone()
    url.pathname = pathnameTo
    const res = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => res.cookies.set(cookie))
    return res
  }

  if (!user && isProtected) return redirectPreservingSession("/login")
  if (user && isAuthPage) return redirectPreservingSession("/dashboard")

  return supabaseResponse
}
