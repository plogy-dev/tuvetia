// El ORDEN de los pasos de `issueInvoice`, que es lo único que separa "el cliente pagó y quedó
// anotado" de "el cliente pagó y el motor de cobranza le va a escribir igual".
//
// POR QUÉ ESTE ARCHIVO. `issueInvoice` son 400 líneas que emiten una factura fiscal, descuentan
// inventario, arman el documento DIAN y registran el pago — y no tenía UN SOLO test. La aritmética
// del dinero sí está cubierta (`domain/money.ts`, `domain/invoice.ts`); lo que no estaba cubierto
// era el cableado, que es donde vivía el defecto.
//
// EL DEFECTO QUE FIJA. El pago declarado se registraba AL FINAL, después del inventario, de las
// recetas y del documento fiscal. Cualquiera de esos tres lanza si falla, y entonces la factura
// quedaba EMITIDA con su consecutivo fiscal quemado y la plata del cliente sin registrar. Con
// `balance_cents` intacto en el total, `cartera/scheduler.ts` la levanta y le cobra al cliente lo
// que ya pagó.
//
// Estos tests fallan si alguien vuelve a mover el pago hacia abajo.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Dobles ──────────────────────────────────────────────────────────────────────────────────────

/** Todo lo que se escribió, en orden. Es el rastro que se inspecciona. */
let escrituras: { tabla: string; op: 'insert' | 'update' | 'delete' }[] = [];
/** Tabla cuyo INSERT debe fallar, para simular el corte de red. */
let tablaQueFalla: string | null = null;

vi.mock('@/lib/facturacion/queries', () => ({
  getInvoiceDetail: vi.fn(async () => ({
    invoice: {
      id: 'inv-1',
      clinic_id: 'cli-1',
      status: 'BORRADOR',
      number: null,
      doc_kind: 'FV',
      subtotal_cents: 100_000,
      discount_cents: 0,
      tax_cents: 19_000,
      total_cents: 119_000,
    },
    lines: [
      {
        catalog_item_id: 'item-1',
        description: 'Consulta general',
        qty: 1,
        unit: 'UND',
        unit_price_cents: 100_000,
        tax_rate: 19,
        tax_status: 'GRAVADO',
        discount_cents: 0,
        tax_cents: 19_000,
        total_cents: 119_000,
      },
    ],
    payer: {
      name: 'Ana Pérez',
      doc_type: 'CC',
      doc_number: '1020304050',
      email: 'ana@ejemplo.com',
      owner_id: null,
    },
    // `refreshInvoiceStatus` deriva el estado de cobranza a partir de los eventos y los pagos. Van
    // vacíos: lo que se mide acá es el ORDEN de las escrituras, no el estado derivado.
    events: [],
    payments: [],
  })),
  getBillingSettings: vi.fn(async () => ({
    module_status: 'ACTIVO',
    inventory_decrement_on: 'INVOICE_ISSUE',
    block_on_insufficient_stock: false,
    uvt_value_cents: 4_700_000,
    default_payment_terms_days: 15,
    reminders_enabled: true,
    reminder_channel: 'WHATSAPP',
    fiscal_name: 'Clínica X',
    fiscal_id_type: 'NIT',
    fiscal_id_number: '900123456',
    fiscal_regime: 'COMUN',
    fiscal_address: 'Calle 1',
    municipality_code: '11001',
  })),
  // `track_stock: true` a propósito: es lo que hace que se intente el movimiento de inventario, que
  // es el paso que en estos tests se rompe.
  getCatalogItems: vi.fn(async () => new Map([['item-1', { cost_cents: 50_000, track_stock: true, item_type: 'PRODUCTO' }]])),
  getStockMap: vi.fn(async () => new Map([['item-1', 99]])),
  getNearExpirySet: vi.fn(async () => new Set()),
  getRecipesForServices: vi.fn(async () => new Map()),
  // Con un rango ACTIVO ya existente, `ensureActiveRange` corta antes de crear el sandbox. Es el
  // caso normal de una clínica en marcha, y evita meter una escritura de más en el rastro.
  getActiveRange: vi.fn(async () => ({
    id: 'rng-1',
    prefix: 'SETP',
    current_number: 990,
    resolution_number: '18760',
    resolution_date: '2026-01-01',
    valid_from: '2026-01-01',
    valid_until: '2027-01-01',
    technical_key: 'llave',
    is_sandbox: true,
  })),
}));

vi.mock('@/lib/facturacion/fiscal/factory', () => ({
  getFiscalProvider: vi.fn(async () => ({
    name: 'sandbox',
    submitInvoice: vi.fn(async () => ({
      status: 'ACEPTADO',
      accepted: true,
      cufe: 'CUFE-1',
      providerMessage: 'ok',
      providerRef: 'ref-1',
    })),
  })),
}));

/**
 * Doble del constructor de queries de PostgREST: encadenable Y esperable a la vez.
 * Mismo molde que `api/athos/actions/__tests__/execute.test.ts`.
 */
function encadenable(resultado: unknown) {
  const nodo: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'gt', 'gte', 'lt', 'lte', 'is', 'neq', 'order', 'limit']) {
    nodo[m] = () => encadenable(resultado);
  }
  nodo.single = async () => resultado;
  nodo.maybeSingle = async () => resultado;
  nodo.then = (r: (v: unknown) => unknown) => r(resultado);
  return nodo;
}

const RANGO = {
  id: 'rng-1',
  prefix: 'SETP',
  current_number: 990,
  resolution_number: '18760',
  resolution_date: '2026-01-01',
  valid_from: '2026-01-01',
  valid_until: '2027-01-01',
  technical_key: 'llave',
  is_sandbox: true,
};

function clienteFalso() {
  return {
    rpc: async () => ({ data: 991, error: null }),
    from: (tabla: string) => ({
      select: () => encadenable(tabla === 'numbering_ranges' ? { data: RANGO, error: null } : { data: null, error: null }),
      insert: (...args: unknown[]) => {
        escrituras.push({ tabla, op: 'insert' });
        const error = tablaQueFalla === tabla ? { message: 'se cayó la red' } : null;
        void args;
        return encadenable({ data: error ? null : { id: `${tabla}-nuevo` }, error });
      },
      update: () => {
        escrituras.push({ tabla, op: 'update' });
        return encadenable({ data: [{ id: 'inv-1' }], error: null });
      },
      delete: () => {
        escrituras.push({ tabla, op: 'delete' });
        return encadenable({ data: null, error: null });
      },
    }),
  } as never;
}

import { issueInvoice } from '@/lib/facturacion/invoices';

const AHORA = new Date('2026-08-16T15:00:00Z');

/** Emisión con abono parcial: la que le cuesta plata al cliente si el pago se pierde. */
const ABONO = {
  invoiceId: 'inv-1',
  outcome: 'ABONO_PARCIAL' as const,
  method: 'EFECTIVO' as const,
  amountCents: 50_000,
  createdBy: 'user-1',
};

const insertosDe = (tabla: string) => escrituras.filter((e) => e.tabla === tabla && e.op === 'insert');
const posicionDe = (tabla: string) => escrituras.findIndex((e) => e.tabla === tabla && e.op === 'insert');

beforeEach(() => {
  escrituras = [];
  tablaQueFalla = null;
});

describe('el pago se registra antes que todo lo que puede fallar', () => {
  // EL TEST QUE FIJA EL DEFECTO. Antes del arreglo, este `payments` nunca se insertaba: el throw del
  // inventario ocurría primero y cortaba la función.
  it('si el inventario falla, el pago YA quedó registrado', async () => {
    tablaQueFalla = 'inventory_movements';

    await expect(issueInvoice(clienteFalso(), 'cli-1', ABONO, AHORA)).rejects.toThrow(/inventario/i);

    expect(insertosDe('payments')).toHaveLength(1);
  });

  // El documento fiscal es el otro paso que lanza. El hecho fiscal no puede llevarse puesto el
  // registro de una plata que ya se recibió.
  it('si el documento fiscal falla, el pago YA quedó registrado', async () => {
    tablaQueFalla = 'fiscal_documents';

    await expect(issueInvoice(clienteFalso(), 'cli-1', ABONO, AHORA)).rejects.toThrow(/documento fiscal/i);

    expect(insertosDe('payments')).toHaveLength(1);
  });

  it('en el camino feliz el pago va antes del inventario y del documento fiscal', async () => {
    await issueInvoice(clienteFalso(), 'cli-1', ABONO, AHORA);

    expect(posicionDe('payments')).toBeGreaterThanOrEqual(0);
    expect(posicionDe('payments')).toBeLessThan(posicionDe('inventory_movements'));
    expect(posicionDe('payments')).toBeLessThan(posicionDe('fiscal_documents'));
  });

  // El pago se aplica a la factura: sin esto el saldo no baja y cartera la sigue viendo con deuda
  // completa, que es la mitad del daño original.
  it('el pago se APLICA a la factura, no queda suelto', async () => {
    await issueInvoice(clienteFalso(), 'cli-1', ABONO, AHORA);

    expect(insertosDe('payment_applications')).toHaveLength(1);
    expect(posicionDe('payments')).toBeLessThan(posicionDe('payment_applications'));
  });
});

describe('lo que no cambió', () => {
  it('sin pago declarado no se inserta ningún pago', async () => {
    await issueInvoice(
      clienteFalso(),
      'cli-1',
      { invoiceId: 'inv-1', outcome: 'PENDIENTE', createdBy: 'user-1' },
      AHORA,
    );

    expect(insertosDe('payments')).toHaveLength(0);
  });

  it('la factura se emite igual: consecutivo, evento y documento fiscal', async () => {
    await issueInvoice(clienteFalso(), 'cli-1', ABONO, AHORA);

    expect(escrituras.some((e) => e.tabla === 'invoices' && e.op === 'update')).toBe(true);
    expect(insertosDe('invoice_events').length).toBeGreaterThan(0);
    expect(insertosDe('fiscal_documents')).toHaveLength(1);
  });
});
