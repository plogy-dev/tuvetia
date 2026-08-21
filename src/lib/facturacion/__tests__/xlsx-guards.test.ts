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

const conArchivo = (nombre: string, contenido = 'pwn') => {
  const fd = new FormData();
  fd.set('file', new File([contenido], nombre));
  return fd;
};

describe('guardas de xlsx', () => {
  it('createImportPreview rechaza un .xlsx SIN tocar el archivo', async () => {
    const r = await createImportPreview(conArchivo('catalogo.xlsx'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/deshabilitad/);
  });

  it('también rechaza el .xls binario viejo', async () => {
    const r = await createImportPreview(conArchivo('catalogo.xls'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/deshabilitad/);
  });

  // LA PROPIEDAD QUE NO PUEDE PERDERSE al acotar la guarda a las extensiones de Excel: el parser
  // vulnerable sigue siendo inalcanzable aunque no haya sesión. Es el orden lo que lo garantiza —
  // el corte por extensión corre ANTES de `requireClinic`.
  it('rechaza el .xlsx incluso sin sesión: la guarda no depende de auth', async () => {
    usuario = null;
    const r = await createImportPreview(conArchivo('catalogo.xlsx'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/deshabilitad/);
  });

  it('la extensión se mira sin importar mayúsculas', async () => {
    const r = await createImportPreview(conArchivo('CATALOGO.XLSX'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/deshabilitad/);
  });

  // ── Y EL CSV SÍ PASA ────────────────────────────────────────────────────────────────────────
  //
  // El camino del CSV es Papaparse, que no tiene nada que ver con las CVE de xlsx. Bloquearlo era
  // tapar un parser sano por culpa de otro. Este test es la otra mitad del contrato: si alguien
  // vuelve a ensanchar la guarda a la action entera, se pone en rojo.
  it('un .csv NO lo frena la guarda', async () => {
    const r = await createImportPreview(conArchivo('catalogo.csv', 'Nombre,Precio\nAmoxicilina,85000\n'));
    // Puede fallar más adelante (la base está mockeada); lo que NO puede es morir en la guarda.
    if (!r.ok) expect(r.error).not.toMatch(/deshabilitad/);
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
