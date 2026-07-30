import 'server-only';

// Autenticación de las páginas de facturación — el equivalente server-component del
// `requireClinic()` de las actions.
//
// Existe para que el port de las páginas del repo del cliente sea mecánico: allá cada página abre
// con `getCachedUser()` y opera por `user_id`; acá la tenancy es por CLÍNICA. Este helper hace el
// reemplazo 1:1 — `{ supabase, clinicId }` en vez de `{ supabase, user }` — y todas las queries de
// nuestro lib ya reciben clinicId explícito.
//
// Devuelve null (no lanza) para conservar el patrón de sus páginas: `if (!ctx) return null` — el
// middleware ya bloquea sin sesión, esto es defensa en profundidad.

import type { SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';

export interface ClinicPageContext {
  supabase: SupabaseClient;
  clinicId: string;
  userId: string;
}

export async function requireClinicPage(): Promise<ClinicPageContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from('profiles')
    .select('clinic_id')
    .eq('id', user.id)
    .maybeSingle();
  const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id ?? null;
  if (!clinicId) return null;
  return { supabase, clinicId, userId: user.id };
}
