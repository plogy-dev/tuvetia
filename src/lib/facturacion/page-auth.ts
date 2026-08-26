import 'server-only';

// Autenticación de las páginas de facturación — el equivalente server-component del
// `requireClinic()` de las actions.
//
// Existe para que el port de las páginas del repo del cliente sea mecánico: allá cada página abre
// con `getCachedUser()` y opera por `user_id`; acá la tenancy es por CLÍNICA. Este helper hace el
// reemplazo 1:1 — `{ supabase, clinicId }` en vez de `{ supabase, user }` — y todas las queries de
// nuestro lib ya reciben clinicId explícito.
//
// ── POR QUÉ ESTÁ MEMOIZADO, CON NÚMEROS ───────────────────────────────────────────────────────
//
// Un `getUser()` NO lee la cookie: sale a la red a validar el JWT, y medido el 23-ago cuesta
// **265 ms** (`x-perf: 1`, ver lib/perf/marcas.ts). Este helper lo llamaban la página de turno Y
// `progresoDeConfiguracion()` en el layout — o sea que cada navegación del dashboard pagaba el
// viaje DOS veces, más otra consulta a `profiles` que el layout ya había hecho.
//
// Dos capas lo eliminan:
//   · `sesionDelServidor()` — el getUser, compartido con el layout vía `cache()` de React.
//   · el `cache()` de acá — el select de `profiles`, compartido entre los llamadores de ESTE
//     helper dentro del mismo request.
//
// `cache()` NO es caché entre peticiones: memoiza por pasada de render, y dos requests de usuarios
// distintos no comparten nada. Es el mismo patrón (y la misma advertencia) de `sesionDelServidor`.
//
// Devuelve null (no lanza) para conservar el patrón de sus páginas: `if (!ctx) return null` — el
// middleware ya bloquea sin sesión, esto es defensa en profundidad.

import { cache } from 'react';

import type { SupabaseClient } from '@supabase/supabase-js';

import { sesionDelServidor } from '@/lib/supabase/sesion';

export interface ClinicPageContext {
  supabase: SupabaseClient;
  clinicId: string;
  userId: string;
}

export const requireClinicPage = cache(async (): Promise<ClinicPageContext | null> => {
  const { supabase, user } = await sesionDelServidor();
  if (!user) return null;
  const { data: prof } = await supabase
    .from('profiles')
    .select('clinic_id')
    .eq('id', user.id)
    .maybeSingle();
  const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id ?? null;
  if (!clinicId) return null;
  return { supabase, clinicId, userId: user.id };
});
