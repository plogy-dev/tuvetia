// Lógica PURA de importación de inventario desde Excel/CSV, portada de
// facturacion-master/src/server/import-inventory.ts:
//   parsear archivo → proponer mapeo de columnas → validar filas.
// Sin Supabase ni Next: testeable en unit tests. La persistencia vive en
// ./actions.ts.

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { pesosToCents } from '@/lib/facturacion/domain/money';
import type { TaxStatus } from '@/lib/facturacion/domain/types';
import {
  type ImportField,
  type ImportMapping,
  type ImportPreset,
  type ImportReport,
  type RowStatus,
  type ValidatedRow,
} from './fields';

// Re-export para los consumidores server-side existentes (actions, tests).
// Los CLIENT components deben importar de ./fields directamente para no
// arrastrar xlsx/papaparse al bundle del navegador.
export * from './fields';

export function parseInventoryFile(
  buffer: Buffer,
  fileName: string,
): { columns: string[]; rows: Record<string, string>[] } {
  if (/\.(xlsx|xls)$/i.test(fileName)) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    const rows = json.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), String(v).trim()])),
    );
    return { columns: rows.length ? Object.keys(rows[0]) : [], rows };
  }
  const parsed = Papa.parse<Record<string, string>>(buffer.toString('utf-8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const rows = parsed.data.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '').trim()])),
  );
  return { columns: parsed.meta.fields ?? [], rows };
}

/** Propone correspondencias columna → campo por nombre normalizado. */
export function proposeMapping(columns: string[]): ImportMapping {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');

  const candidates: [RegExp, ImportField][] = [
    [/^(nombre|producto|nombreproducto|descripcion|item|articulo)$/, 'name'],
    [/^(categoria|grupo|familia)$/, 'category'],
    [/^(sku|codigo|codigointerno|referencia|ref)$/, 'sku'],
    [/^(tipo|clase|kind)$/, 'kind'],
    [/^(unidadcompra|unidaddecompra|presentacion)$/, 'purchaseUnit'],
    [/^(unidad|unidaduso|unidaddeuso|unidadventa|unidaddeventa|subunidad)$/, 'useUnit'],
    [/^(factor|factorconversion|factordeconversion|conversion)$/, 'conversionFactor'],
    [/^(cantidad|existencia|existencias|stock|inventario|existenciainicial|stockinicial)$/, 'initialQty'],
    [/^(costo|costounitario|preciocompra|preciodecompra)$/, 'costPesos'],
    [/^(precio|precioventa|preciodeventa|valor|valorventa|pvp)$/, 'pricePesos'],
    [/^(iva|impuesto|tarifaiva|tasaiva)$/, 'taxRate'],
    [/^(minimo|stockminimo|minimostock|puntoreorden)$/, 'minStock'],
    [/^(lote|numerolote|nrolote)$/, 'lotNumber'],
    [/^(vence|vencimiento|fechavencimiento|fechadevencimiento|expira|caducidad)$/, 'expiresAt'],
    [/^(proveedor|laboratorio|distribuidor)$/, 'supplier'],
    [/^(ubicacion|bodega|almacen|sede)$/, 'location'],
    [/^(duracion|duracionminutos|minutos|tiempo)$/, 'durationMinutes'],
  ];

  const mapping: ImportMapping = {};
  const used = new Set<ImportField>();
  for (const col of columns) {
    const n = norm(col);
    const hit = candidates.find(([re, field]) => re.test(n) && !used.has(field));
    if (hit) {
      mapping[col] = hit[1];
      used.add(hit[1]);
    } else {
      mapping[col] = '';
    }
  }
  return mapping;
}

const KIND_ALIASES: Record<string, string> = {
  producto: 'PRODUCTO',
  medicamento: 'MEDICAMENTO',
  insumo: 'INSUMO',
  servicio: 'SERVICIO',
};

/**
 * Admite "1.234,56", "1234.56", "$ 85.000", "1.234.567".
 * Mejora sobre el port de Vetnia: sin coma, un punto seguido de EXACTAMENTE
 * 3 dígitos se trata como separador de miles colombiano ("85.000" = 85000),
 * no como decimal — en listas de precios ese es siempre el significado.
 */
export function toNumber(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\$/g, '').replace(/\s/g, '');
  let normalized: string;
  if (cleaned.includes(',') && cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
    // Formato CO con decimales: "1.234,56"
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (!cleaned.includes(',') && /^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    // Solo puntos como miles: "85.000", "1.234.567"
    normalized = cleaned.replace(/\./g, '');
  } else {
    // Anglosajón: "1,234.56" o "1234.56"
    normalized = cleaned.replace(/,/g, '');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function validateRows(
  rows: Record<string, string>[],
  mapping: ImportMapping,
  existingNames: Set<string>,
  opts: { preset?: ImportPreset } = {},
): { validated: ValidatedRow[]; report: ImportReport } {
  const isServices = opts.preset === 'servicios';
  const get = (row: Record<string, string>, field: ImportField): string => {
    const col = Object.keys(mapping).find((c) => mapping[c] === field);
    return col ? (row[col] ?? '').trim() : '';
  };

  const seenNames = new Set<string>();
  const validated: ValidatedRow[] = rows.map((row, index) => {
    const messages: string[] = [];
    let status: RowStatus = 'OK';

    const name = get(row, 'name');
    if (!name) {
      return {
        index,
        status: 'ERROR' as const,
        messages: ['Falta el nombre del producto'],
        parsed: null,
      };
    }

    const nameKey = name.toLowerCase();
    if (existingNames.has(nameKey) || seenNames.has(nameKey)) {
      status = 'DUPLICADO';
      messages.push('Parece duplicado (ya existe un producto con este nombre)');
    }
    seenNames.add(nameKey);

    const price = toNumber(get(row, 'pricePesos'));
    if (price === null || price < 0) {
      status = 'ERROR';
      messages.push('Precio de venta inválido o ausente');
    }

    // Servicios no tienen existencia: la cantidad del archivo se ignora.
    const qty = isServices ? 0 : (toNumber(get(row, 'initialQty')) ?? 0);
    if (qty < 0) {
      status = 'ERROR';
      messages.push('Existencia inicial negativa');
    }

    const rawTax = get(row, 'taxRate');
    let taxRate = 0;
    if (rawTax) {
      const t = toNumber(rawTax.replace('%', ''));
      if (t === null || ![0, 5, 19].includes(t)) {
        status = 'ERROR';
        messages.push(`IVA inválido: "${rawTax}" (se admite 0, 5 o 19)`);
      } else {
        taxRate = t;
      }
    }

    let useUnit = get(row, 'useUnit');
    if (!useUnit) {
      if (isServices) {
        // Un servicio no necesita unidad física: 'servicio' sin aviso.
        useUnit = 'servicio';
      } else {
        useUnit = 'unidad';
        if (status === 'OK') status = 'AVISO';
        messages.push("Requiere confirmar su unidad (se asumió 'unidad')");
      }
    }
    const purchaseUnit = get(row, 'purchaseUnit') || useUnit;
    const factor = toNumber(get(row, 'conversionFactor')) ?? 1;
    if (factor <= 0) {
      status = 'ERROR';
      messages.push('Factor de conversión debe ser positivo');
    }

    const rawKind = get(row, 'kind').toLowerCase();
    const kind = isServices ? 'SERVICIO' : (KIND_ALIASES[rawKind] ?? 'PRODUCTO');

    let durationMinutes: number | null = null;
    const rawDuration = get(row, 'durationMinutes');
    if (rawDuration) {
      const d = toNumber(rawDuration.replace(/min(utos)?\.?$/i, ''));
      if (d === null || d <= 0 || !Number.isFinite(d)) {
        if (status === 'OK') status = 'AVISO';
        messages.push(`Duración no reconocida: "${rawDuration}" (se ignoró)`);
      } else {
        durationMinutes = Math.round(d);
      }
    }

    const cost = toNumber(get(row, 'costPesos')) ?? 0;
    const minStock = toNumber(get(row, 'minStock')) ?? 0;
    const expiresRaw = get(row, 'expiresAt');
    let expiresAt: string | null = null;
    if (expiresRaw) {
      const d = new Date(expiresRaw);
      if (Number.isNaN(d.getTime())) {
        if (status === 'OK') status = 'AVISO';
        messages.push(`Fecha de vencimiento no reconocida: "${expiresRaw}" (se ignoró)`);
      } else {
        expiresAt = d.toISOString().slice(0, 10);
      }
    }

    if (status === 'ERROR') {
      return { index, status, messages, parsed: null };
    }

    // Condición de IVA: tarifa > 0 ⇒ GRAVADO; tarifa 0 ⇒ EXCLUIDO (el caso
    // típico: medicamentos veterinarios). Si el vet necesita EXENTO (0%),
    // lo ajusta después en el catálogo.
    const taxStatus: TaxStatus = taxRate > 0 ? 'GRAVADO' : 'EXCLUIDO';

    return {
      index,
      status,
      messages,
      parsed: {
        name,
        category: get(row, 'category') || null,
        sku: get(row, 'sku') || null,
        kind,
        purchaseUnit,
        useUnit,
        conversionFactor: factor,
        initialQty: qty,
        costCents: pesosToCents(cost),
        priceCents: pesosToCents(price ?? 0),
        taxRate,
        taxStatus,
        minStock,
        lotNumber: get(row, 'lotNumber') || null,
        expiresAt,
        supplier: get(row, 'supplier') || null,
        location: get(row, 'location') || null,
        durationMinutes,
      },
    };
  });

  const report: ImportReport = {
    total: validated.length,
    ready: validated.filter((r) => r.status === 'OK').length,
    withWarnings: validated.filter((r) => r.status === 'AVISO').length,
    duplicates: validated.filter((r) => r.status === 'DUPLICADO').length,
    errors: validated.filter((r) => r.status === 'ERROR').length,
  };
  return { validated, report };
}
