// Parseo determinista de una receta subida como Excel/CSV. Puro (solo la lib
// xlsx, sin servidor ni modelo): si la hoja tiene columnas reconocibles
// (producto/cantidad/unidad), devuelve el borrador sin llamar a la IA. Si no,
// devuelve null y el extractor cae al modelo con el CSV crudo.

import * as XLSX from 'xlsx';
import { normalizeForMatch, type RecipeDraft } from './recipes';

const NAME_KEYS = ['producto', 'nombre', 'componente', 'insumo', 'item', 'material', 'medicamento', 'articulo'];
const QTY_KEYS = ['cantidad', 'cant', 'qty', 'unidades', 'consumo'];
const UNIT_KEYS = ['unidad', 'und', 'medida', 'presentacion'];

function pickKey(headers: string[], wanted: string[]): string | null {
  for (const h of headers) {
    const n = normalizeForMatch(h);
    if (wanted.some((w) => n.split(' ').includes(w) || n.includes(w))) return h;
  }
  return null;
}

/** Lee la primera hoja tratando el contenido como UTF-8 (CSV) o xlsx binario. */
function firstSheet(base64: string) {
  const wb = XLSX.read(Buffer.from(base64, 'base64'), { type: 'buffer', codepage: 65001, raw: false });
  return wb.Sheets[wb.SheetNames[0]] ?? null;
}

export function parseSpreadsheetDraft(base64: string): RecipeDraft | null {
  const sheet = firstSheet(base64);
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
  if (rows.length === 0) return null;

  const headers = Object.keys(rows[0]);
  const nameKey = pickKey(headers, NAME_KEYS);
  const qtyKey = pickKey(headers, QTY_KEYS);
  if (!nameKey || !qtyKey) return null;
  const unitKey = pickKey(headers, UNIT_KEYS);

  const components = rows
    .map((r) => {
      const name = String(r[nameKey] ?? '').trim();
      const qty = Number(String(r[qtyKey] ?? '').replace(',', '.'));
      const unit = unitKey ? String(r[unitKey] ?? '').trim() || null : null;
      return { name, qty, unit };
    })
    .filter((c) => c.name && Number.isFinite(c.qty) && c.qty > 0);

  return components.length > 0 ? { serviceName: null, components } : null;
}

/** CSV crudo de la primera hoja (para el fallback al modelo). */
export function spreadsheetToCsv(base64: string): string {
  const sheet = firstSheet(base64);
  return sheet ? XLSX.utils.sheet_to_csv(sheet) : '';
}
