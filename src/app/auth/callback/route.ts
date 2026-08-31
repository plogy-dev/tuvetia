import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { safeNext } from "@/lib/auth-fragment"
import {
  aprovisionarAlta,
  canjearCodigo,
  modoDeLaPuerta,
  puedeEntrarConLaPuertaCerrada,
} from "@/lib/puerta/servidor"

// Esta ruta atiende el retorno de OAuth (login con Google): el flujo lo inició el NAVEGADOR, existe
// el `code_verifier` de PKCE y Supabase devuelve `?code=`.
//
// Un enlace de CORREO es otra cosa: lo inicia el servidor, no hay `code_verifier`, y Supabase
// devuelve los tokens en el FRAGMENTO (`#access_token=…`). El fragmento no viaja al servidor, así
// que acá llega una petición sin código. Antes eso terminaba en `/login?reason=missing_code` — y era
// exactamente el fallo del invitado sin cuenta. Ahora se deriva a `/auth/sesion`, que corre en el
// navegador y sí puede leerlo; el fragmento sobrevive a la redirección (RFC 7231 §7.1.2).
//
// ACÁ NO SE VINCULA NINGÚN CALENDARIO (calendario v3, migración 0049). Antes se guardaba el
// `provider_refresh_token` del login como integración de calendario, sin que nadie lo pidiera, y
// eso trajo dos problemas: el calendario PERSONAL del vet terminaba sincronizado con la agenda de
// la clínica, y el token guardado podía ser de otro proveedor que el de la fila (un token de
// Microsoft quedó guardado como si fuera de Google). El calendario ahora se conecta a mano desde
// Conexiones, eligiendo proveedor.

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = safeNext(searchParams.get("next"))
  // El código de acceso que `signup-form` colgó del `redirectTo`. Es la única forma de que sobreviva
  // al viaje a Google: el pase se ata a un correo, y el correo recién se conoce ACÁ.
  const codigoDeAcceso = searchParams.get("codigo")

  // Sin `code` no es un error todavía: puede ser un enlace de correo con la sesión en el fragmento.
  // Sólo el navegador puede saberlo, así que se le pregunta a él.
  if (!code) {
    return NextResponse.redirect(
      `${origin}/auth/sesion?next=${encodeURIComponent(next)}&reason=missing_code`,
    )
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (!error && data.user) {
    // El aprovisionamiento de clínica lo garantiza la BD (trigger on_auth_user_confirmed
    // sobre auth.users.email_confirmed_at) — ya corrió antes de que este código se ejecute.
    //
    // ── LA PUERTA DE LA PLATAFORMA (migración 0100) ──────────────────────────────────────────────
    //
    // ÉSTE ES EL ÚNICO PUNTO DEL REGISTRO POR GOOGLE DONDE SE PUEDE DECIDIR. `signInWithOAuth` no
    // tiene el `shouldCreateUser: false` que sí tiene el correo: para cuando volvemos del proveedor
    // la cuenta ya existe. Lo que todavía se puede hacer es no dejarla entrar — y no dejarle una
    // clínica, que es de lo que se encarga la base.
    //
    // El canje va PRIMERO y pase lo que pase con el modo: los días del enlace valen con la puerta
    // abierta o cerrada. Y va seguido de `aprovisionarAlta` porque el trigger que crea la clínica ya
    // corrió hace un instante, cuando el pase todavía no existía — el porqué, en la 0100 §8.
    if (codigoDeAcceso && data.user.email) {
      const dias = await canjearCodigo(codigoDeAcceso, data.user.email)
      if (dias !== null) await aprovisionarAlta(data.user.id)
    }

    if (
      (await modoDeLaPuerta()) === "cerrado" &&
      !(await puedeEntrarConLaPuertaCerrada({ id: data.user.id, email: data.user.email }))
    ) {
      // SE CIERRA LA SESIÓN ANTES DE MANDARLO A `/signup`, y ese orden es lo único que hace que el
      // rebote sirva: con la sesión viva, el proxy ve un usuario autenticado en una ruta de auth y
      // lo devuelve al dashboard — o sea, al mismo lugar del que lo estamos sacando.
      //
      // La cuenta NO se borra. Queda en `auth.users` sin clínica, que en esta app es no ser nadie, y
      // el día que traiga un código el mismo camino la aprovisiona sin tener que registrarse de
      // nuevo. Borrar cuentas es irreversible y éste es el peor momento para hacerlo.
      await supabase.auth.signOut().catch(() => {})
      return NextResponse.redirect(`${origin}/signup?motivo=sin-cuenta`)
    }

    return NextResponse.redirect(`${origin}${next}`)
  }

  // Motivo real al login (bad_code_verifier, etc.) para que el usuario sepa qué pasó.
  const reason = error?.code ?? "exchange_failed"
  return NextResponse.redirect(`${origin}/login?error=auth&reason=${encodeURIComponent(reason)}`)
}
