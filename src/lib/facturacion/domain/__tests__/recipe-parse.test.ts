import { describe, expect, it } from 'vitest';
import { parseSpreadsheetDraft } from '../recipe-parse';

const b64 = (csv: string) => Buffer.from(csv, 'utf8').toString('base64');

describe('parseSpreadsheetDraft (Excel/CSV determinista)', () => {
  it('parsea columnas producto/cantidad/unidad', () => {
    const csv = 'Producto,Cantidad,Unidad\nGasa estéril,2,unidad\nSutura 3-0,1,unidad\nKetamina,0.5,ml';
    const draft = parseSpreadsheetDraft(b64(csv));
    expect(draft).not.toBeNull();
    expect(draft!.components).toHaveLength(3);
    expect(draft!.components[0]).toEqual({ name: 'Gasa estéril', qty: 2, unit: 'unidad' });
    expect(draft!.components[2].qty).toBe(0.5);
  });

  it('acepta encabezados alternativos (insumo/cant) y coma decimal', () => {
    const draft = parseSpreadsheetDraft(b64('Insumo,Cant\nGuantes,"1,5"'));
    expect(draft?.components[0]).toEqual({ name: 'Guantes', qty: 1.5, unit: null });
  });

  it('ignora filas sin cantidad válida', () => {
    const csv = 'Producto,Cantidad\nGasa,2\nEncabezado sin dato,\nSutura,abc';
    const draft = parseSpreadsheetDraft(b64(csv));
    expect(draft!.components.map((c) => c.name)).toEqual(['Gasa']);
  });

  it('sin columnas reconocibles → null (cae al modelo)', () => {
    const csv = 'foo,bar\nx,y';
    expect(parseSpreadsheetDraft(b64(csv))).toBeNull();
  });
});
