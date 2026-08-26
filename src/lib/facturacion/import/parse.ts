// Lógica PURA de importación de inventario desde Excel/CSV, portada de
// facturacion-master/src/server/import-inventory.ts:
//   parsear archivo → proponer mapeo de columnas → validar filas.
// Sin Supabase ni Next: testeable en unit tests. La persistencia vive en
// ./actions.ts.

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { filaDeCabecera } from '@/lib/importar/cabecera';
import { comoTexto } from '@/lib/importar/texto';
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

/** ¿Esta celda parece un encabezado que sabemos mapear? Es la señal fuerte de `filaDeCabecera`. */
const esEncabezadoConocido = (celda: string) => proposeMapping([celda])[celda] !== '';

/**
 * Una celda de xlsx como texto.
 *
 * LAS FECHAS SE FORMATEAN, NO SE IMPRIMEN. Con `cellDates` SheetJS entrega un `Date`, y
 * `String(new Date())` da "Fri Jan 15 2027 00:00:00 GMT-0500 (…)" — que ningún parser de
 * vencimientos va a entender. Sin `cellDates` es peor todavía: llega el serial de Excel crudo
 * (`46401.79`), que fue lo que salió en el barrido del 21-ago con la columna "Vence".
 *
 * SE LEEN LOS COMPONENTES **LOCALES**, no `toISOString()`. Un serial de Excel no lleva zona: es un
 * día del calendario, y SheetJS lo materializa como la medianoche LOCAL de ese día. Pasarlo por
 * `toISOString()` lo reinterpreta como instante UTC, y en cualquier zona con offset positivo
 * —Europa— la medianoche local del 15 es el 14 a las 22:00 en UTC: el vencimiento se importa un día
 * antes. En Colombia (UTC-5) el error no aparece, que es justo lo que lo haría difícil de encontrar
 * después.
 */
function celdaATexto(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v ?? '').trim();
}

export function parseInventoryFile(
  buffer: Buffer,
  fileName: string,
): { columns: string[]; rows: Record<string, string>[] } {
  if (/\.(xlsx|xls)$/i.test(fileName)) {
    // `cellDates` para que un vencimiento no llegue como el serial de Excel. Ver `celdaATexto`.
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];

    // SE LEE COMO MATRIZ, no como objetos por encabezado, porque hasta no saber CUÁL fila es el
    // encabezado no se puede usar ninguna como clave. `blankrows: false` saca las filas separadoras
    // que traen las planillas exportadas.
    const matriz = XLSX.utils
      .sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' })
      .map((f) => (f as unknown[]).map(celdaATexto));

    const inicio = filaDeCabecera(matriz, esEncabezadoConocido);
    const columns = dedup((matriz[inicio] ?? []).map((c) => c.trim()));
    const rows = matriz
      .slice(inicio + 1)
      .map((f) => Object.fromEntries(columns.map((c, i) => [c, f[i] ?? ''])))
      .filter((r) => Object.values(r).some((v) => v !== ''));

    return { columns, rows };
  }

  // `comoTexto` y no `toString("utf-8")`: Excel en Windows guarda CSV en Windows-1252 y los acentos
  // llegaban como `�`, que rompe el mapeo de la columna con tilde. Ver `lib/importar/texto`.
  const texto = comoTexto(buffer);

  // La fila de título también aparece en CSV. Se busca con el mismo criterio que en xlsx, y recién
  // después se le pasa a Papa el texto que empieza en el encabezado.
  const sinCabecera = Papa.parse<string[]>(texto, { skipEmptyLines: true });
  const inicio = filaDeCabecera((sinCabecera.data ?? []).map((f) => f.map((c) => String(c ?? ''))), esEncabezadoConocido);

  const parsed = Papa.parse<Record<string, string>>(texto, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    // Papa cuenta las líquidas ya salteadas, así que `inicio` es directamente cuántas descartar.
    ...(inicio > 0 ? { beforeFirstChunk: (c: string) => saltarLineas(c, inicio) } : {}),
  });
  const rows = parsed.data.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '').trim()])),
  );
  return { columns: parsed.meta.fields ?? [], rows };
}

/**
 * Nombres de columna únicos.
 *
 * Dos columnas con el mismo encabezado —"Teléfono" dos veces, que es lo que traen las planillas
 * exportadas— colapsarían en una sola clave y la segunda pisaría a la primera: los datos de una
 * aparecen bajo el nombre de la otra. Es la mitad de "mezcla las columnas" que ya se arregló en el
 * importador de pacientes (#146) indexando por posición; acá se resuelve desambiguando el nombre.
 */
function dedup(nombres: string[]): string[] {
  const vistos = new Map<string, number>();
  return nombres.map((n, i) => {
    const base = n || `Columna ${i + 1}`;
    const veces = vistos.get(base) ?? 0;
    vistos.set(base, veces + 1);
    return veces === 0 ? base : `${base} (${veces + 1})`;
  });
}

/** Descarta las primeras `n` líneas del texto crudo, respetando CRLF. */
function saltarLineas(texto: string, n: number): string {
  let desde = 0;
  for (let i = 0; i < n; i++) {
    const corte = texto.indexOf('\n', desde);
    if (corte === -1) return '';
    desde = corte + 1;
  }
  return texto.slice(desde);
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
      // «05/08/2026» en un CSV colombiano es el 5 DE AGOSTO. `new Date(string)` lo lee al estilo
      // gringo (8 de mayo): con día ≤ 12 INTERCAMBIABA día y mes sin ningún aviso, y el
      // vencimiento gobierna la alerta de producto por vencer (revisión del 26-ago). El formato
      // con barras se interpreta DD/MM explícitamente; lo demás sigue el camino de siempre.
      const barras = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(expiresRaw.trim());
      const d = barras
        ? new Date(Date.UTC(Number(barras[3]), Number(barras[2]) - 1, Number(barras[1])))
        : new Date(expiresRaw);
      const diaValido = barras
        ? d.getUTCMonth() === Number(barras[2]) - 1 && d.getUTCDate() === Number(barras[1])
        : !Number.isNaN(d.getTime());
      if (!diaValido || Number.isNaN(d.getTime())) {
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
