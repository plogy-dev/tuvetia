import { beforeEach, describe, expect, it, vi } from 'vitest';

// Las dos guardas que neutralizan xlsx@0.18.5 (prototype pollution + ReDoS, sin fix publicado) en
// la frontera de las server actions. Son deuda documentada en ESTADO.md y exactamente el tipo de
// código que alguien "limpia" en seis meses sin saber por qué estaba: estas pruebas hacen que
// quitarlas sin reemplazar la librería ponga el CI en rojo.
//
// Importar CUALQUIER export de un módulo 'use server' registra TODAS sus actions como endpoints
// públicos para cualquier autenticado — por eso la guarda vive en la action y no en la UI, y por
// eso acá se invoca la action directo, como lo haría un atacante con sesión.

let usuario: { id: string } | null = { id: 'user-1' };
let perfil: { clinic_id: string | null } | null = { clinic_id: 'clinic-1' };

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from() {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: perfil }),
      };
      return q;
    },
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { createImportPreview } from '../import/actions';
import { ingestRecipeAction } from '../actions';

beforeEach(() => {
  usuario = { id: 'user-1' };
  perfil = { clinic_id: 'clinic-1' };
});

describe('guardas de xlsx', () => {
  it('createImportPreview rechaza SIN tocar el archivo (la guarda corre antes que todo)', async () => {
    const fd = new FormData();
    fd.set('file', new File(['pwn'], 'catalogo.xlsx'));
    const r = await createImportPreview(fd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/deshabilitada/);
  });

  it('createImportPreview rechaza incluso sin sesión: la guarda no depende de auth', async () => {
    usuario = null;
    const r = await createImportPreview(new FormData());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/deshabilitada/);
  });

  it("ingestRecipeAction rechaza kind:'excel' para un usuario autenticado", async () => {
    const r = await ingestRecipeAction({
      kind: 'excel',
      base64: Buffer.from('pwn').toString('base64'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/deshabilitada/);
  });
});
