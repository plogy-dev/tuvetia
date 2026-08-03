import { createClient } from "@/lib/supabase/server"

/**
 * El rol dentro de la clínica, para las poquísimas acciones que no puede hacer cualquier miembro.
 *
 * POR QUÉ HACÍA FALTA. En todo el producto había UN solo chequeo de rol en TypeScript
 * (`api/team/invite-email/route.ts`), y guardaba la acción menos peligrosa de todas: reenviar el
 * correo de una invitación que la RPC ya restringe en Postgres. El resto de los gates de rol viven
 * en la base (`private.my_role()`) y cubren equipo, invitaciones, datos de la clínica y el logo —
 * nada de lo que MANDA algo hacia afuera.
 *
 * Mientras tanto, `requireClinic()` está copiado literal ocho veces entre `lib/facturacion/*`,
 * `lib/cartera` y `lib/email`, y **ninguna copia selecciona `role`**: todas piden sólo `clinic_id`.
 * Por eso esto es un archivo nuevo y no una novena copia con un campo más.
 *
 * QUE ESTO SIRVA DE ALGO DEPENDE DE UNA COSA, y está verificada contra el principal: el trigger
 * `profiles_guard_sensitive_columns` rechaza cualquier UPDATE que cambie `role` o `clinic_id` desde
 * un rol que no sea `postgres`. O sea que un `vet` no puede auto-promoverse por PostgREST y el gate
 * no es decorativo. Si algún día ese trigger se cae, esto deja de valer.
 *
 * NO se usa para leer ni para escribir datos clínicos: ahí la frontera es la RLS por clínica, y un
 * `vet` tiene que poder atender pacientes, agendar y facturar. Esto es sólo para lo que sale de la
 * clínica sin vuelta atrás.
 */
export type ContextoAdmin = {
  supabase: Awaited<ReturnType<typeof createClient>>
  clinicId: string
  userId: string
}

/**
 * Devuelve el contexto si quien llama es admin de su clínica. Lanza si no.
 *
 * Lanza en vez de devolver null porque los tres consumidores son server actions y rutas que ya
 * envuelven todo en try/catch y traducen el error a un mensaje: devolver null obligaría a cada uno a
 * inventar su propio texto y el «por qué» se perdería.
 */
export async function requireClinicAdmin(): Promise<ContextoAdmin> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")

  const { data: prof, error } = await supabase
    .from("profiles")
    .select("clinic_id, role")
    .eq("id", user.id)
    .maybeSingle()
  // Se lee `error`: sin esto, un fallo de red haría `prof = null` y el mensaje diría "no tenés
  // clínica", que manda a buscar el problema al lado equivocado.
  if (error) throw new Error(`No se pudo verificar tu rol: ${error.message}`)

  const perfil = prof as { clinic_id: string | null; role: string | null } | null
  if (!perfil?.clinic_id) throw new Error("El usuario no tiene clínica")
  if (perfil.role !== "admin") {
    throw new Error("Solo un administrador de la clínica puede hacer esto.")
  }
  return { supabase, clinicId: perfil.clinic_id, userId: user.id }
}

/** ¿Es admin de su clínica? Para pintar o esconder en la UI — la barrera es `requireClinicAdmin`. */
export async function esAdminDeClinica(): Promise<boolean> {
  try {
    await requireClinicAdmin()
    return true
  } catch {
    return false
  }
}
