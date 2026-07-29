// Resolución del proveedor fiscal para una clínica.
// v1: siempre SANDBOX. Cuando se elija el aliado real (MATIAS/Dataico/Factus),
// acá se leen las credenciales de la clínica y se devuelve el adapter real; si
// la clínica no lo tiene conectado, se sigue cayendo al sandbox. Los casos de
// uso no cambian.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FiscalProvider } from './types';
import { sandboxFiscalProvider } from './sandbox';

export async function getFiscalProvider(
  _supabase: SupabaseClient,
  _clinicId: string,
): Promise<FiscalProvider> {
  // TODO(1f): consultar el proveedor fiscal elegido por la clínica y devolver
  // el adapter real con sus credenciales.
  return sandboxFiscalProvider;
}
