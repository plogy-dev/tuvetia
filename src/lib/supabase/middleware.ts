import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

const PROTECTED_PREFIXES = ["/dashboard"]
const AUTH_PREFIXES = ["/", "/signup"]

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
    const result = await supabase.auth.getUser()
    user = result.data.user
  } catch (e) {
    // Hipo transitorio de Supabase Auth (red/timeout): NO tratarlo como "no autenticado" ni romper
    // toda la app con un 500. Dejamos pasar; la página valida de nuevo. Evita rebotes falsos a "/".
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

  if (!user && isProtected) return redirectPreservingSession("/")
  if (user && isAuthPage) return redirectPreservingSession("/dashboard")

  return supabaseResponse
}
