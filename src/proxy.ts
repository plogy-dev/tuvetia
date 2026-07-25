import { type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  // Excluye rutas que NO necesitan el chequeo de sesión del proxy: API y /auth (manejan sus propias
  // cookies), estáticos de Next, y assets (fuentes/css/imágenes/metadatos). Antes corría un getUser()
  // (round-trip de red a Supabase) hasta en cada fuente y en el propio handshake de /auth -> latencia.
  matcher: [
    "/((?!api|auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|ttf|otf|css|js|map|txt|xml|webmanifest)$).*)",
  ],
}
