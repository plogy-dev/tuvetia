import "server-only"

// La clínica de quien está llamando, Y si su cuenta sigue activa.
//
// EL HUECO QUE CIERRA. La migración 0059 puso `is_active` dentro de `private.my_clinic_id()` y
// `private.my_role()`, así que la RLS le niega los datos de la clínica a una cuenta desactivada. Y
// `dashboard/layout.tsx` la saca de la interfaz. Parecía suficiente. No lo era:
//
//   · `profiles_select` permite `id = auth.uid()` —hace falta, porque el propio gate necesita leer
//     `is_active` de esa fila— así que una cuenta desactivada SÍ lee su perfil y saca su `clinic_id`.
//   · Las rutas de API sólo comprobaban `getUser()`, que mira el JWT y nada más. El JWT de una
//     cuenta desactivada sigue siendo válido: desactivar no cierra sesiones.
//
// Resultado: `POST /api/athos/agent` con la sesión de una cuenta desactivada pasaba la
// autenticación, sacaba el `clinic_id`, **llamaba al modelo** y recién después la RLS le negaba los
// datos del paciente. Respuestas inútiles, pero el gasto era real — y es exactamente el gasto que
// la desactivación viene a cortar.
//
// POR QUÉ UN HELPER Y NO UNA LÍNEA EN CADA RUTA. Son nueve rutas que ya leen `profiles` para sacar
// el `clinic_id`. Con una línea suelta en cada una, la ruta número diez nace sin ella y nadie lo
// nota — que es precisamente cómo nació este hueco. Acá `is_active` viaja en el MISMO select que ya
// se hacía: no cuesta un round-trip más.
//
// NO REEMPLAZA A LA RLS. Es una segunda capa: si esto se olvidara, la RLS sigue negando los datos.
// Lo que la RLS no puede hacer es impedir que se gaste dinero ANTES de tocar la base.

import type { createClient } from "@/lib/supabase/server"
import {
  MENSAJE_REQUIERE_PRO,
  comoPlan,
  tieneAcceso,
  type Capacidad,
  type Plan,
} from "@/lib/planes"

type ClienteDeSesion = Awaited<ReturnType<typeof createClient>>

export type ClinicaDeLaSesion =
  | { ok: true; clinicId: string; fullName: string | null; role: string | null; plan: Plan }
  // 400 = no tiene clínica · 403 = cuenta desactivada · 500 = la consulta falló (ver abajo).
  | { ok: false; status: 400 | 403 | 500; mensaje: string }

/** Lo que se le dice a una cuenta desactivada. Sin detalle: no es información que le sirva. */
export const MENSAJE_DESACTIVADA =
  "Tu cuenta está desactivada. Escribinos a soporte si creés que es un error."

export async function clinicaDeLaSesion(
  supabase: ClienteDeSesion,
  userId: string,
): Promise<ClinicaDeLaSesion> {
  const { data, error } = await supabase
    .from("profiles")
    // `clinic:clinics(plan)` viaja EMBEBIDO y no en una consulta aparte, por el mismo motivo que
    // `is_active`: son las nueve rutas de siempre, y una lectura suelta en cada una es una lectura
    // que la ruta número diez no va a tener. PostgREST lo resuelve en el mismo round-trip.
    //
    // ⚠️ EL `!profiles_clinic_id_fkey` NO ES ADORNO Y NO SE PUEDE QUITAR.
    //
    // Hay DOS claves foráneas entre estas tablas —`profiles.clinic_id → clinics.id` y
    // `clinics.owner_id → profiles.id`— así que un `clinics(plan)` a secas es ambiguo: PostgREST no
    // sabe por cuál de los dos caminos embeber y **falla el select ENTERO**, no sólo el embed.
    //
    // Cómo se vio en producción: `data` volvía null, el perfil entero se perdía, y las nueve rutas
    // respondían «El usuario no tiene clínica» a usuarios que sí la tenían. Athos, el envío de
    // WhatsApp, las invitaciones y el pago, todos caídos por un embed sin desambiguar.
    .select("clinic_id, full_name, role, is_active, clinic:clinics!profiles_clinic_id_fkey(plan)")
    .eq("id", userId)
    .maybeSingle()

  // UN FALLO DE CONSULTA NO ES "NO TENÉS CLÍNICA", y confundirlos fue lo que hizo que el defecto de
  // arriba costara una tarde. Sin este bloque, cualquier error de PostgREST —un embed ambiguo, una
  // columna que no existe todavía, la caché de esquema sin recargar— sale por el mismo 400 que
  // significa "este usuario no está en ninguna clínica", y manda a mirar el lugar equivocado.
  //
  // 500 y no 400: el problema es del servidor, no de quien llama. Y el detalle va al log, no al
  // navegador.
  if (error) {
    console.error("clinicaDeLaSesion: falló la lectura del perfil", error)
    return {
      ok: false,
      status: 500,
      mensaje: "No pudimos leer tu perfil. Recargá la página; si sigue, escribinos.",
    }
  }

  const perfil = data as {
    clinic_id: string | null
    full_name: string | null
    role: string | null
    is_active: boolean | null
    // El embed llega como objeto (relación a-uno) o `null` si la RLS lo niega.
    clinic: { plan: string | null } | null
  } | null

  // `is_active` es `not null default true` en el esquema, pero se compara contra `false` explícito:
  // un `null` —de un perfil anterior a la columna, o de una lectura parcial— tiene que contar como
  // activo. Cerrarle el paso a alguien por un valor ausente sería peor que el hueco que esto tapa.
  if (perfil?.is_active === false) {
    return { ok: false, status: 403, mensaje: MENSAJE_DESACTIVADA }
  }

  if (!perfil?.clinic_id) {
    return { ok: false, status: 400, mensaje: "El usuario no tiene clínica" }
  }

  return {
    ok: true,
    clinicId: perfil.clinic_id,
    fullName: perfil.full_name,
    role: perfil.role,
    // `comoPlan` cae a `free` ante cualquier cosa que no sea exactamente `"pro"`, incluido el
    // `null` de un embed que la RLS negó. La dirección importa: un plan ilegible tiene que negar.
    plan: comoPlan(perfil.clinic?.plan),
  }
}

/**
 * El corte por plan, para las rutas que gastan IA.
 *
 * Se usa DESPUÉS de `clinicaDeLaSesion` y antes de llamar al modelo — ese orden es el punto entero:
 * lo que se corta acá es el gasto, no la respuesta. Una ruta que valide el plan después de haber
 * llamado al modelo devuelve un 402 correcto y una factura igual de cara.
 *
 * Devuelve **402 Payment Required**, que existe justamente para esto y le permite al navegador
 * distinguirlo de un 403 por permisos: la interfaz abre la ventana de invitación a Pro sólo con el
 * 402. Con un 403 tendría que adivinar si al vet le falta plan o le falta rol.
 */
export function requiereCapacidad(
  plan: Plan,
  capacidad: Capacidad,
): { ok: true } | { ok: false; status: 402; mensaje: string; capacidad: Capacidad } {
  if (tieneAcceso(plan, capacidad)) return { ok: true }
  return {
    ok: false,
    status: 402,
    mensaje: `${MENSAJE_REQUIERE_PRO[capacidad]} Subí de plan para usarlo.`,
    capacidad,
  }
}
