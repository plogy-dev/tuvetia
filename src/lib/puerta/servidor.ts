import "server-only"

// La puerta de la plataforma, la mitad que consulta la base. La lógica pura está en `./index`.
//
// TODO ACÁ VA CON `service_role`, y no es una comodidad: las tres tablas de la 0100 tienen RLS
// encendida y CERO policies a propósito —enumerar códigos o correos invitados desde el navegador
// sería justo lo que la puerta viene a impedir—, así que la sesión del usuario no ve ni una fila.
//
// NUNCA IMPORTAR ESTO DESDE UN CLIENT COMPONENT. El `server-only` de arriba hace que el build falle
// si alguien lo intenta.

import { createAdminClient } from "@/lib/supabase/admin"
import { isPlatformAdmin } from "@/lib/platform-admin"

import {
  type CodigoDeAcceso,
  type ModoDeLaPuerta,
  normalizarCodigo,
} from "./index"

/**
 * ¿Está cerrada la plataforma?
 *
 * FALLA HACIA «ABIERTA», igual que la función SQL. Si Supabase no responde, lo que está en juego es
 * un registro que se pierde para siempre contra una cuenta de más que se puede desactivar desde el
 * panel. La asimetría no está pareja y el default sigue al lado barato.
 *
 * EL `try` NO ES DECORACIÓN, Y ESTA ES LA PARTE QUE HAY QUE LEER. Esto lo llama `/auth/callback` en
 * TODO login con Google, y `createAdminClient()` **lanza** si falta `SUPABASE_SERVICE_ROLE_KEY` —
 * que es exactamente lo que pasa en una preview de Vercel sin ese secreto. Sin el `try`, agregar la
 * puerta habría convertido una env faltante en «nadie puede iniciar sesión», que es un fallo mucho
 * peor que el que la puerta viene a evitar. Se atrapa el throw, no sólo el `error` de la consulta.
 */
export async function modoDeLaPuerta(): Promise<ModoDeLaPuerta> {
  try {
    const { data, error } = await createAdminClient()
      .from("platform_gate")
      .select("modo")
      .maybeSingle()

    if (error) {
      console.error("[puerta] no se pudo leer el modo, se asume abierta:", error.message)
      return "abierto"
    }
    return (data as { modo?: string } | null)?.modo === "cerrado" ? "cerrado" : "abierto"
  } catch (e) {
    console.error("[puerta] no se pudo consultar el modo, se asume abierta:", (e as Error).message)
    return "abierto"
  }
}

/** La fila de un código, ya normalizado. `null` si no existe. */
export async function leerCodigo(bruto: string): Promise<CodigoDeAcceso | null> {
  const codigo = normalizarCodigo(bruto)
  if (!codigo) return null

  const { data, error } = await createAdminClient()
    .from("access_codes")
    .select("codigo, dias, max_usos, usos, expira_en, activo")
    .eq("codigo", codigo)
    .maybeSingle()

  if (error) {
    console.error("[puerta] no se pudo leer el código:", error.message)
    return null
  }
  return (data as CodigoDeAcceso | null) ?? null
}

/**
 * Canjea el código para ese correo y devuelve los días que otorga, o `null` si no sirvió.
 *
 * Todo el trabajo lo hace `public.canjear_codigo` en la base — el porqué (dos tablas, un contador y
 * cinco personas abriendo el mismo enlace a la vez) está escrito en la migración 0100.
 */
export async function canjearCodigo(bruto: string, correo: string): Promise<number | null> {
  const codigo = normalizarCodigo(bruto)
  const email = correo.trim().toLowerCase()
  if (!codigo || !email) return null

  const { data, error } = await createAdminClient().rpc("canjear_codigo", {
    p_codigo: codigo,
    p_email: email,
  })

  if (error) {
    console.error("[puerta] falló el canje:", error.message)
    return null
  }
  return typeof data === "number" ? data : null
}

/**
 * Vuelve a pasar una cuenta por el embudo de alta, ahora que sí tiene pase.
 *
 * Sólo hace falta en el camino de OAuth, donde el correo se conoce DESPUÉS de que el trigger de
 * confirmación ya decidió. El porqué completo está en la migración 0100 §8. Es idempotente.
 */
export async function aprovisionarAlta(userId: string): Promise<void> {
  const { error } = await createAdminClient().rpc("aprovisionar_alta", { p_user_id: userId })
  if (error) {
    // NO SE PROPAGA: quien llama es `/auth/callback`, y un fallo acá no puede convertirse en un
    // error de autenticación. La cuenta queda sin clínica y `sin-clinica.tsx` ofrece crearla —
    // que es el mismo lugar donde termina cualquier alta que no se aprovisionó.
    console.error("[puerta] no se pudo reintentar el alta:", error.message)
  }
}

/** ¿Este correo ya tiene pase? */
export async function tienePase(correo: string | null | undefined): Promise<boolean> {
  const email = (correo ?? "").trim().toLowerCase()
  if (!email) return false

  const { data, error } = await createAdminClient()
    .from("access_grants")
    .select("email")
    .eq("email", email)
    .maybeSingle()

  if (error) {
    console.error("[puerta] no se pudo leer el pase:", error.message)
    return false
  }
  return Boolean(data)
}

/**
 * Con la puerta cerrada, ¿esta cuenta puede seguir adelante?
 *
 * ── LAS CUATRO PUERTAS DE SERVICIO, Y POR QUÉ CADA UNA ────────────────────────────────────────
 *
 * Esto lo consulta `/auth/callback` justo después de cambiar el código de OAuth por la sesión, o
 * sea en el único momento en que se puede distinguir «Google de alguien que ya es cliente» de
 * «Google de alguien que nunca entró». Decir que no a quien ya es cliente sería peor que dejar
 * entrar a un desconocido: es sacar de la app a quien la está pagando.
 *
 *   1. ADMIN DE PLATAFORMA. Sin esto, cerrar la puerta puede dejar afuera a quien tiene que ir a
 *      abrirla. Es gratis de comprobar (una env, sin viaje a la base) y va primero por eso.
 *   2. PASE. El camino normal del código: se otorgó en `/signup` antes de mandar a Google.
 *   3. CLÍNICA O MEMBRESÍA. La definición operativa de «cuenta que ya existe». No se mira
 *      `created_at` ni `last_sign_in_at` —la heurística de la ventana de tiempo se equivoca con
 *      cualquier reloj desfasado— sino lo único que de verdad convierte una cuenta en un cliente.
 *   4. INVITACIÓN PENDIENTE. Un invitado del equipo llega SIN clínica a propósito (la base se
 *      aparta para que `accept_invitation` lo meta a la que ya existe). Sin este caso, cerrar la
 *      puerta rompería el alta de equipos, que no tiene nada que ver con el registro público.
 */
export async function puedeEntrarConLaPuertaCerrada(quien: {
  id: string
  email: string | null | undefined
}): Promise<boolean> {
  if (isPlatformAdmin(quien.email)) return true

  const email = (quien.email ?? "").trim().toLowerCase()
  const admin = createAdminClient()

  if (email && (await tienePase(email))) return true

  const { data: perfil } = await admin
    .from("profiles")
    .select("clinic_id")
    .eq("id", quien.id)
    .maybeSingle()
  if ((perfil as { clinic_id?: string | null } | null)?.clinic_id) return true

  const { data: membresia } = await admin
    .from("memberships")
    .select("clinic_id")
    .eq("user_id", quien.id)
    .limit(1)
    .maybeSingle()
  if (membresia) return true

  if (!email) return false

  const { data: invitacion } = await admin
    .from("invitations")
    .select("id")
    .ilike("email", email)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle()

  return Boolean(invitacion)
}
