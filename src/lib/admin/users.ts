import "server-only"

// Lista de usuarios de la plataforma con sus contactos, para /admin/usuarios.
//
// EL CORREO TIENE TRUCO: vive en `auth.users`, que **no es alcanzable por PostgREST** — ni con
// service_role. Hay dos caminos y acá se toma el primero:
//
//   1. `auth.admin.listUsers()` (API Admin de GoTrue), paginada, cruzada en JS contra `profiles`
//      por `id`. Es el mismo patrón de cruce que `metrics.ts` ya usa para todo lo demás.
//   2. Una RPC `security definer` tipo `get_platform_users()`. Más "SQL", pero roza la regla dura
//      del repo — *service_role siempre con `clinic_id` explícito* — porque tendría que devolver
//      todas las clínicas a la vez.
//
// ⚠️ `get_clinic_members()` (migración 0040) NO sirve acá: filtra por `private.my_clinic_id()`,
// que bajo service_role es NULL, así que devuelve cero filas. Está pensada para el vet en su sesión.

import { createAdminClient } from "@/lib/supabase/admin"
import { loadPlatformMetrics, type PlatformMetrics } from "@/lib/admin/metrics"

const POR_PAGINA = 200 // GoTrue pagina; 200 es cómodo para los volúmenes actuales
const TOPE_PAGINAS = 50 // guarda anti-bucle: 10.000 usuarios

export type PlatformUser = {
  id: string
  email: string | null
  fullName: string | null
  phone: string | null
  role: string | null
  isActive: boolean | null
  /** Nombres de TODAS sus clínicas (`memberships`), no sólo la activa. */
  clinics: string[]
  /** La clínica activa (`profiles.clinic_id`) — la que ve al entrar. */
  activeClinic: string | null
  clinicPhone: string | null
  clinicEmail: string | null
  city: string | null
  createdAt: string | null
  lastSignInAt: string | null
  /** Se registró y nunca entró: señal de onboarding roto. */
  nuncaEntro: boolean
}

export type PendingInvitation = {
  email: string
  role: string | null
  clinic: string | null
  createdAt: string
  expiresAt: string | null
  vencida: boolean
}

type AuthUser = {
  id: string
  email?: string | null
  created_at?: string
  last_sign_in_at?: string | null
}

async function listarAuthUsers(): Promise<Map<string, AuthUser>> {
  const admin = createAdminClient()
  const out = new Map<string, AuthUser>()
  for (let page = 1; page <= TOPE_PAGINAS; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: POR_PAGINA })
    if (error) throw new Error(`admin users: ${error.message}`)
    const users = (data?.users ?? []) as unknown as AuthUser[]
    for (const u of users) out.set(u.id, u)
    if (users.length < POR_PAGINA) return out
  }
  console.warn(`[admin] listUsers alcanzó el tope de ${TOPE_PAGINAS} páginas — lista parcial`)
  return out
}

export async function loadPlatformUsers(): Promise<{
  users: PlatformUser[]
  pending: PendingInvitation[]
  metrics: PlatformMetrics
}> {
  const [metrics, authUsers] = await Promise.all([loadPlatformMetrics(), listarAuthUsers()])

  const clinicPorId = new Map(metrics.clinics.map((c) => [c.id, c]))
  const clinicasDe = new Map<string, string[]>()
  for (const ms of metrics.memberships) {
    const nombre = clinicPorId.get(ms.clinic_id)?.name
    if (!nombre) continue
    const cur = clinicasDe.get(ms.user_id) ?? []
    if (!cur.includes(nombre)) cur.push(nombre)
    clinicasDe.set(ms.user_id, cur)
  }

  const users: PlatformUser[] = metrics.profiles.map((p) => {
    const auth = authUsers.get(p.id)
    const activa = p.clinic_id ? clinicPorId.get(p.clinic_id) : undefined
    // `memberships` es la fuente de verdad multi-clínica, pero un perfil puede tener clinic_id sin
    // fila de membership (cuentas anteriores a la 0022): se une con la activa para no perderla.
    const desdeMemberships = clinicasDe.get(p.id) ?? []
    const clinics = activa && !desdeMemberships.includes(activa.name)
      ? [activa.name, ...desdeMemberships]
      : desdeMemberships
    return {
      id: p.id,
      email: auth?.email ?? null,
      fullName: p.full_name,
      phone: p.phone,
      role: p.role,
      isActive: p.is_active,
      clinics,
      activeClinic: activa?.name ?? null,
      clinicPhone: activa?.phone ?? null,
      clinicEmail: activa?.email ?? null,
      city: activa?.city ?? null,
      createdAt: p.created_at ?? auth?.created_at ?? null,
      lastSignInAt: auth?.last_sign_in_at ?? null,
      nuncaEntro: !auth?.last_sign_in_at,
    }
  })

  const ahora = new Date().toISOString()
  const pending: PendingInvitation[] = metrics.invitations
    .filter((i) => !i.accepted_at)
    .map((i) => ({
      email: i.email,
      role: i.role,
      clinic: clinicPorId.get(i.clinic_id)?.name ?? null,
      createdAt: i.created_at,
      expiresAt: i.expires_at,
      vencida: !!i.expires_at && i.expires_at < ahora,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  users.sort((a, b) => (a.createdAt ?? "") < (b.createdAt ?? "") ? 1 : -1)
  return { users, pending, metrics }
}
