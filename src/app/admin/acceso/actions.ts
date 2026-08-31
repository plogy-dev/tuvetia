"use server"

// Las acciones de la puerta de la plataforma. Molde de `admin/usuarios/actions.ts`: cada una
// re-verifica el gate por su cuenta —una server action es un endpoint invocable con un POST, y el
// `notFound()` del layout sólo corre al renderizar la página— y escribe con `service_role`, que es
// lo único que ve las tres tablas de la 0100 (RLS encendida, cero policies).

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"
import { adminDePlataformaActual } from "@/lib/platform-admin"
import { FORMA_DEL_CODIGO, generarCodigo, normalizarCodigo, type ModoDeLaPuerta } from "@/lib/puerta"

export type Resultado = { ok: true; mensaje: string } | { ok: false; error: string }

/** La traza. Va DESPUÉS del cambio y no lo revierte si falla — mismo criterio que `cambiarActivacion`. */
async function anotar(
  admin: { id: string; email: string },
  action: string,
  payload: Record<string, unknown>,
) {
  const { error } = await createAdminClient().from("audit_logs").insert({
    clinic_id: null,
    user_id: admin.id,
    action,
    payload: { ...payload, by: admin.email },
  })
  if (error) console.error(`[admin/acceso] no se pudo registrar ${action}:`, error.message)
}

// ── Abrir y cerrar la plataforma ──────────────────────────────────────────────────────────────

const ModoSchema = z.object({ modo: z.enum(["abierto", "cerrado"]) })

export async function cambiarModoDeLaPuerta(input: { modo: ModoDeLaPuerta }): Promise<Resultado> {
  const admin = await adminDePlataformaActual()
  if (!admin) return { ok: false, error: "No autorizado." }

  const parsed = ModoSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Modo inválido." }
  const { modo } = parsed.data

  const supabase = createAdminClient()

  // Se lee antes para no anotar un cambio que no ocurrió, y para poder decir en el mensaje si ya
  // estaba así — apretar el botón y no ver nada distinto es lo que hace dudar de si funcionó.
  const { data: antes } = await supabase.from("platform_gate").select("modo").maybeSingle()
  const previo = (antes as { modo?: string } | null)?.modo ?? "abierto"

  // `upsert` y no `update`: si la fila no existe (base recién migrada a mano, restauración parcial),
  // un `update` no afecta ninguna fila y devuelve éxito — el botón diría que cerró y no cerraría nada.
  const { error } = await supabase
    .from("platform_gate")
    .upsert({ id: true, modo, actualizado_en: new Date().toISOString(), actualizado_por: admin.id })

  if (error) return { ok: false, error: `No se pudo cambiar el modo: ${error.message}` }

  if (previo !== modo) await anotar(admin, "platform_gate.changed", { de: previo, a: modo })
  revalidatePath("/admin/acceso")

  return {
    ok: true,
    mensaje:
      modo === "cerrado"
        ? "Tuvetia quedó cerrada: para registrarse hace falta un código."
        : "Tuvetia quedó abierta: cualquiera puede registrarse.",
  }
}

// ── Los códigos ───────────────────────────────────────────────────────────────────────────────

const CodigoSchema = z.object({
  // Vacío = lo genera el servidor. Es el caso normal: nadie quiere inventar un código a mano.
  codigo: z.string().trim().max(32).optional(),
  dias: z.coerce.number().int().min(1, "Mínimo 1 día").max(60, "Máximo 60 días"),
  maxUsos: z.coerce.number().int().min(1, "Mínimo 1 uso").max(10_000),
  // `''` desde un <input type="date"> vacío significa "no vence", no "fecha inválida".
  expiraEn: z.string().trim().optional(),
  nota: z.string().trim().max(200).optional(),
})

export async function crearCodigo(input: {
  codigo?: string
  dias: number
  maxUsos: number
  expiraEn?: string
  nota?: string
}): Promise<Resultado> {
  const admin = await adminDePlataformaActual()
  if (!admin) return { ok: false, error: "No autorizado." }

  const parsed = CodigoSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." }
  }
  const { dias, maxUsos, expiraEn, nota } = parsed.data

  const codigo = normalizarCodigo(parsed.data.codigo) || generarCodigo()
  if (!FORMA_DEL_CODIGO.test(codigo)) {
    return { ok: false, error: "El código va de 4 a 32 caracteres, sólo letras, números y guiones." }
  }

  const { error } = await createAdminClient().from("access_codes").insert({
    codigo,
    dias,
    max_usos: maxUsos,
    // El `<input type="date">` da una fecha suelta; se toma como el FINAL de ese día en UTC para que
    // un código que vence "el 5" siga sirviendo durante el 5. Vencer a las 00:00 del 5 es lo que la
    // gente no espera.
    expira_en: expiraEn ? new Date(`${expiraEn}T23:59:59Z`).toISOString() : null,
    nota: nota || null,
    creado_por: admin.id,
  })

  if (error) {
    // 23505 = clave duplicada. Es el error que se comete de verdad (reusar un nombre lindo), y el
    // mensaje de Postgres no lo dice en un idioma que sirva.
    if (error.code === "23505") return { ok: false, error: `El código ${codigo} ya existe.` }
    return { ok: false, error: `No se pudo crear: ${error.message}` }
  }

  await anotar(admin, "access_code.created", { codigo, dias, max_usos: maxUsos, nota: nota ?? null })
  revalidatePath("/admin/acceso")

  return { ok: true, mensaje: `Código ${codigo} creado: ${dias} días, hasta ${maxUsos} usos.` }
}

const ActivoSchema = z.object({ codigo: z.string().trim().min(1), activo: z.boolean() })

/**
 * Apagar y encender un código.
 *
 * NO HAY BORRAR, y es a propósito: `access_grants` referencia el código con `on delete restrict`, o
 * sea que borrarlo o falla o —si no lo tuviera— dejaría sin pase a quien ya entró con él. Apagado,
 * el código deja de admitir gente nueva y todo lo que ya otorgó sigue en pie. Es la operación que se
 * quiere el 99% de las veces ("ya no repartan más éste"), y es reversible.
 */
export async function cambiarActivoDeCodigo(input: {
  codigo: string
  activo: boolean
}): Promise<Resultado> {
  const admin = await adminDePlataformaActual()
  if (!admin) return { ok: false, error: "No autorizado." }

  const parsed = ActivoSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Datos inválidos." }
  const codigo = normalizarCodigo(parsed.data.codigo)
  const { activo } = parsed.data

  const { error } = await createAdminClient()
    .from("access_codes")
    .update({ activo })
    .eq("codigo", codigo)

  if (error) return { ok: false, error: `No se pudo actualizar: ${error.message}` }

  await anotar(admin, activo ? "access_code.enabled" : "access_code.disabled", { codigo })
  revalidatePath("/admin/acceso")

  return {
    ok: true,
    mensaje: activo
      ? `${codigo} vuelve a admitir registros.`
      : `${codigo} ya no admite registros nuevos. Quien ya entró con él sigue adentro.`,
  }
}
