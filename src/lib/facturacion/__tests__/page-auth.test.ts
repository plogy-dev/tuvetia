import { beforeEach, describe, expect, it, vi } from 'vitest';

// El guard de acceso de las 16 páginas del módulo de dinero. Es el equivalente server-component
// de `requireClinic()` y TODA la tenancy de facturación cuelga de él — hasta la auditoría del
// 2026-07-30 no tenía ni una prueba, mientras el documento de entrega lo citaba como evidencia
// de que el módulo es seguro. Se fija el contrato: sin sesión → null, sin clínica → null, y el
// perfil se busca POR EL ID DEL USUARIO AUTENTICADO (no por nada que venga del request).

let usuario: { id: string } | null = null;
let perfil: { clinic_id: string | null } | null = null;
const consultas: { tabla: string; columnas: string; filtros: Record<string, unknown> }[] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: usuario } }),
    },
    from(tabla: string) {
      const filtros: Record<string, unknown> = {};
      let columnas = '';
      const q = {
        select(cols: string) {
          columnas = cols;
          return q;
        },
        eq(col: string, val: unknown) {
          filtros[col] = val;
          return q;
        },
        async maybeSingle() {
          consultas.push({ tabla, columnas, filtros });
          return { data: perfil };
        },
      };
      return q;
    },
  }),
}));

import { requireClinicPage } from '../page-auth';

beforeEach(() => {
  usuario = null;
  perfil = null;
  consultas.length = 0;
});

describe('requireClinicPage', () => {
  it('sin sesión devuelve null y NO consulta profiles', async () => {
    expect(await requireClinicPage()).toBeNull();
    expect(consultas).toEqual([]);
  });

  it('con sesión pero sin clinic_id en el perfil devuelve null', async () => {
    usuario = { id: 'user-1' };
    perfil = { clinic_id: null };
    expect(await requireClinicPage()).toBeNull();
  });

  it('con sesión pero sin fila de perfil devuelve null', async () => {
    usuario = { id: 'user-1' };
    perfil = null;
    expect(await requireClinicPage()).toBeNull();
  });

  it('resuelve clinicId y userId, y el perfil se busca por el id del usuario autenticado', async () => {
    usuario = { id: 'user-7' };
    perfil = { clinic_id: 'clinic-9' };
    const ctx = await requireClinicPage();
    expect(ctx?.clinicId).toBe('clinic-9');
    expect(ctx?.userId).toBe('user-7');
    expect(consultas).toHaveLength(1);
    expect(consultas[0].tabla).toBe('profiles');
    expect(consultas[0].filtros).toEqual({ id: 'user-7' }); // jamás un id que venga del request
  });
});
