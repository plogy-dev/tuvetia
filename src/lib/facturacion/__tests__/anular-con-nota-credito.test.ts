/**
 * Anular una factura con nota crédito.
 *
 * POR QUÉ ESTE ARCHIVO. Hasta el 2026-08-23 esto no existía: la pantalla prometía "solo se corrige
 * con nota crédito", la tabla estaba creada, el proveedor fiscal la declaraba… y nada la emitía. Lo
 * que se agrega ahora toca el consecutivo fiscal, el inventario y el saldo del cliente, o sea las
 * tres cosas que no se pueden deshacer con un PR al día siguiente.
 *
 * LO QUE MÁS SE CUIDA, en orden:
 *
 *  1. QUE UNA GUARDA NO QUEME UN CONSECUTIVO. Si se anula dos veces —dos clics, un reintento— la
 *     segunda tiene que cortar ANTES de tocar el rango. Un número consumido no se devuelve, y un
 *     salto en la numeración fiscal en Colombia no es cosmético.
 *  2. QUE EL INVENTARIO VUELVA POR LO QUE PASÓ, no por lo que debería haber pasado.
 *  3. QUE EL PAGO NO SE TOQUE: ese dinero se recibió de verdad.
 *  4. QUE EL EVENTO LLEVE `amountCents`, que es de donde `deriveStatus` saca el saldo.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { anularFactura } from '@/lib/facturacion/credit-notes';

// `refreshInvoiceStatus` relee la factura entera y deriva las cuatro dimensiones; acá no aporta
// nada y arrastraría media base de datos al doble. El resto de `invoices.ts` —el rango y la
// disciplina del consecutivo— se usa DE VERDAD, que es justo lo que hay que ejercitar.
vi.mock('@/lib/facturacion/invoices', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/facturacion/invoices')>();
  return { ...real, refreshInvoiceStatus: vi.fn(async () => ({ fiscal: 'AFECTADA_POR_NOTA_CREDITO' })) };
});

type Escritura = { tabla: string; op: 'insert' | 'update'; datos: Record<string, unknown> };

/** Lo que el doble devuelve por tabla, y lo que registra de lo escrito. */
function clienteFalso(opts: {
  factura?: Record<string, unknown> | null;
  /** Importes de las notas crédito ya emitidas sobre esa factura. */
  acreditadas?: number[];
  movimientos?: Array<{ item_id: string; lot_id: string | null; qty: number }>;
  rango?: Record<string, unknown> | null;
  rpcFalla?: boolean;
  /** La lectura de las notas ya emitidas se cae. */
  previasFallan?: boolean;
}) {
  const escrituras: Escritura[] = [];
  const rpcs: string[] = [];
  /** Filtros aplicados por tabla: `fiscal_documents` → `neq:doc_kind=NOTA_CREDITO`. */
  const filtros: Record<string, string[]> = {};

  const cliente = {
    from(tabla: string) {
      let conteo = false;
      const nodo: Record<string, unknown> = {};
      for (const m of ['eq', 'order', 'limit', 'not', 'in']) nodo[m] = () => nodo;
      // `neq` se anota además de encadenar: es la diferencia entre pedir el CUFE de la FACTURA y
      // pedir el de la última nota crédito, y sin registrarlo no hay forma de afirmarlo.
      nodo.neq = (col: string, val: unknown) => {
        (filtros[tabla] ??= []).push(`neq:${col}=${String(val)}`);
        return nodo;
      };

      nodo.select = (_c?: string, o?: { head?: boolean }) => {
        conteo = Boolean(o?.head);
        return nodo;
      };
      nodo.insert = (datos: Record<string, unknown> | Record<string, unknown>[]) => {
        for (const d of Array.isArray(datos) ? datos : [datos]) {
          escrituras.push({ tabla, op: 'insert', datos: d });
        }
        return nodo;
      };
      nodo.update = (datos: Record<string, unknown>) => {
        escrituras.push({ tabla, op: 'update', datos });
        return nodo;
      };
      nodo.maybeSingle = async () => {
        if (tabla === 'invoices') return { data: opts.factura ?? null, error: null };
        if (tabla === 'numbering_ranges') return { data: opts.rango ?? null, error: null };
        if (tabla === 'billing_settings') return { data: { fiscal_name: 'Vet' }, error: null };
        if (tabla === 'billing_payers') {
          return { data: { name: 'Jesús', doc_type: 'CC', doc_number: '1', email: null }, error: null };
        }
        if (tabla === 'fiscal_documents') return { data: { cufe: 'CUFE-VIEJO' }, error: null };
        return { data: null, error: null };
      };
      nodo.single = async () => ({ data: { id: 'nc-1' }, error: null });
      nodo.then = (resolver: (v: unknown) => unknown) => {
        if (conteo) return resolver({ data: null, count: 0, error: null });
        if (tabla === 'credit_notes') {
          if (opts.previasFallan) {
            return resolver({ data: null, error: { message: 'permission denied' } });
          }
          return resolver({ data: (opts.acreditadas ?? []).map((c) => ({ total_cents: c })), error: null });
        }
        if (tabla === 'inventory_movements') return resolver({ data: opts.movimientos ?? [], error: null });
        return resolver({ data: [], error: null });
      };
      return nodo;
    },
    rpc: async (nombre: string) => {
      rpcs.push(nombre);
      return opts.rpcFalla
        ? { data: null, error: { message: 'se cayo la red' } }
        : { data: 7, error: null };
    },
  };

  return { cliente: cliente as unknown as SupabaseClient, escrituras, rpcs, filtros };
}

const FACTURA_EMITIDA = {
  id: 'inv-1',
  status: 'EMITIDA',
  doc_kind: 'POS',
  full_number: 'SPOS-1',
  total_cents: 100_000,
  payer_id: 'pay-1',
};

const RANGO = { id: 'r-nc', prefix: 'SNC', current_number: 6, is_sandbox: true };

beforeEach(() => vi.clearAllMocks());

describe('las guardas, que son las que protegen el consecutivo', () => {
  it('un BORRADOR no se anula: se descarta', async () => {
    const { cliente, rpcs } = clienteFalso({ factura: { ...FACTURA_EMITIDA, status: 'BORRADOR' } });
    await expect(anularFactura(cliente, 'c1', { invoiceId: 'inv-1', motivo: 'ANULACION' })).rejects.toThrow(
      /se descarta/i,
    );
    // Y NO tocó el rango: un borrador no puede quemar un número de nota crédito.
    expect(rpcs).toEqual([]);
  });

  it('una factura YA ANULADA no consume otro consecutivo', async () => {
    const { cliente, rpcs } = clienteFalso({ factura: { ...FACTURA_EMITIDA, status: 'ANULADA' } });
    await expect(anularFactura(cliente, 'c1', { invoiceId: 'inv-1', motivo: 'ANULACION' })).rejects.toThrow(
      /EMITIDA/,
    );
    expect(rpcs).toEqual([]);
  });

  it('DOS CLICS NO QUEMAN DOS NÚMEROS: si ya está acreditada entera, corta antes del rango', async () => {
    // El caso real: el vet aprieta, tarda, vuelve a apretar. La segunda tiene que morir antes de la
    // RPC del consecutivo — después ya no hay forma de devolver el número.
    const { cliente, rpcs } = clienteFalso({ factura: FACTURA_EMITIDA, acreditadas: [100_000] });
    await expect(anularFactura(cliente, 'c1', { invoiceId: 'inv-1', motivo: 'ANULACION' })).rejects.toThrow(
      /acreditada por completo/i,
    );
    expect(rpcs).toEqual([]);
  });

  it('ACREDITAR DE MÁS SE RECHAZA, y tampoco quema un número', async () => {
    // Sin este tope, tres parciales de $40.000 sobre una factura de $100.000 acreditarían $120.000:
    // más de lo que se cobró, y el saldo del cliente quedaría a favor de la nada.
    const { cliente, rpcs } = clienteFalso({ factura: FACTURA_EMITIDA, acreditadas: [70_000] });
    await expect(
      anularFactura(cliente, 'c1', { invoiceId: 'inv-1', motivo: 'DESCUENTO', montoCents: 40_000 }),
    ).rejects.toThrow(/no se puede acreditar más/i);
    expect(rpcs).toEqual([]);
  });

  it('un monto en cero o negativo no pasa', async () => {
    const { cliente, rpcs } = clienteFalso({ factura: FACTURA_EMITIDA });
    await expect(
      anularFactura(cliente, 'c1', { invoiceId: 'inv-1', motivo: 'DESCUENTO', montoCents: 0 }),
    ).rejects.toThrow(/mayor que cero/i);
    expect(rpcs).toEqual([]);
  });

  it('una factura de otra clínica no existe', async () => {
    const { cliente } = clienteFalso({ factura: null });
    await expect(anularFactura(cliente, 'c1', { invoiceId: 'inv-1', motivo: 'ANULACION' })).rejects.toThrow(
      /no encontrada/i,
    );
  });
});

describe('la anulación completa', () => {
  it('emite la nota crédito con su consecutivo propio y el motivo', async () => {
    const { cliente, escrituras, rpcs } = clienteFalso({
      factura: FACTURA_EMITIDA,
      rango: RANGO,
      movimientos: [],
    });

    const r = await anularFactura(cliente, 'c1', {
      invoiceId: 'inv-1',
      motivo: 'ANULACION',
      detalle: 'me equivoqué de cliente',
    });

    expect(rpcs).toEqual(['facturacion_assign_next_number']);
    expect(r.fullNumber).toBe('SNC-7'); // prefijo propio de nota crédito, no el de la factura
    expect(r.totalCents).toBe(100_000);

    const nota = escrituras.find((e) => e.tabla === 'credit_notes')!;
    expect(nota.datos.reason_code).toBe('ANULACION');
    expect(nota.datos.reason_text).toBe('me equivoqué de cliente');
    expect(nota.datos.total_cents).toBe(100_000);
    expect(nota.datos.status).toBe('EMITIDA');
  });

  it('sin detalle, el motivo legible queda como texto', async () => {
    const { cliente, escrituras } = clienteFalso({ factura: FACTURA_EMITIDA, rango: RANGO });
    await anularFactura(cliente, 'c1', { invoiceId: 'inv-1', motivo: 'DEVOLUCION' });
    const nota = escrituras.find((e) => e.tabla === 'credit_notes')!;
    expect(nota.datos.reason_text).toMatch(/devoluci/i);
  });

  it('DEVUELVE EL INVENTARIO CON EL OPUESTO EXACTO de lo que salió', async () => {
    // No se recalcula desde las líneas: se leen los movimientos REALES. Si alguien cambió la receta
    // de un servicio entre la emisión y la anulación, recalcular devolvería al stock una cantidad
    // que nunca salió.
    const { cliente, escrituras } = clienteFalso({
      factura: FACTURA_EMITIDA,
      rango: RANGO,
      movimientos: [
        { item_id: 'it-1', lot_id: 'lot-9', qty: -2 },
        { item_id: 'it-2', lot_id: null, qty: -0.5 },
      ],
    });

    const r = await anularFactura(cliente, 'c1', { invoiceId: 'inv-1', motivo: 'ANULACION' });

    const devs = escrituras.filter((e) => e.tabla === 'inventory_movements');
    expect(devs).toHaveLength(2);
    expect(devs.map((d) => d.datos.qty)).toEqual([2, 0.5]);
    expect(devs.every((d) => d.datos.movement_type === 'DEVOLUCION')).toBe(true);
    // El lote se conserva: devolver al lote equivocado desordena el vencimiento.
    expect(devs[0].datos.lot_id).toBe('lot-9');
    expect(r.movimientosDevueltos).toBe(2);
  });

  it('EL PAGO NO SE TOCA: ese dinero se recibió de verdad', async () => {
    const { cliente, escrituras } = clienteFalso({ factura: FACTURA_EMITIDA, rango: RANGO });
    await anularFactura(cliente, 'c1', { invoiceId: 'inv-1', motivo: 'ANULACION' });

    // Ni pagos ni sus aplicaciones. La nota crédito cancela lo que el cliente DEBE, no lo que ya
    // entregó: borrarlo haría desaparecer plata que entró a la caja.
    expect(escrituras.some((e) => e.tabla === 'payments')).toBe(false);
    expect(escrituras.some((e) => e.tabla === 'payment_applications')).toBe(false);
  });

  it('el evento lleva `amountCents`, que es de donde sale el saldo', async () => {
    const { cliente, escrituras } = clienteFalso({ factura: FACTURA_EMITIDA, rango: RANGO });
    await anularFactura(cliente, 'c1', { invoiceId: 'inv-1', motivo: 'ANULACION' });

    const evento = escrituras.find(
      (e) => e.tabla === 'invoice_events' && e.datos.event_type === 'CREDIT_NOTE_APPLIED',
    )!;
    expect(evento).toBeDefined();
    // Sin esta clave, `deriveStatus` acumula 0 y la factura anulada seguiría "debiendo".
    expect((evento.datos.payload as { amountCents: number }).amountCents).toBe(100_000);
  });

  it('la factura queda ANULADA, y sólo si venía de EMITIDA', async () => {
    const { cliente, escrituras } = clienteFalso({ factura: FACTURA_EMITIDA, rango: RANGO });
    await anularFactura(cliente, 'c1', { invoiceId: 'inv-1', motivo: 'ANULACION' });
    expect(escrituras.some((e) => e.tabla === 'invoices' && e.datos.status === 'ANULADA')).toBe(true);
  });

  it('el documento fiscal se registra como NOTA_CREDITO, no como factura', async () => {
    const { cliente, escrituras } = clienteFalso({ factura: FACTURA_EMITIDA, rango: RANGO });
    await anularFactura(cliente, 'c1', { invoiceId: 'inv-1', motivo: 'ANULACION' });
    const fd = escrituras.find((e) => e.tabla === 'fiscal_documents')!;
    expect(fd.datos.doc_kind).toBe('NOTA_CREDITO');
    expect(fd.datos.status).toBe('ACEPTADO'); // el sandbox acepta
  });
});

describe('la nota crédito PARCIAL', () => {
  it('acredita menos, y la factura NO queda anulada', async () => {
    const { cliente, escrituras } = clienteFalso({ factura: FACTURA_EMITIDA, rango: RANGO });

    const r = await anularFactura(cliente, 'c1', {
      invoiceId: 'inv-1',
      motivo: 'AJUSTE_PRECIO',
      montoCents: 30_000,
      detalle: 'le cobré de más la consulta',
    });

    expect(r.anulada).toBe(false);
    expect(r.totalCents).toBe(30_000);
    expect(r.acreditableRestante).toBe(70_000);

    const nota = escrituras.find((e) => e.tabla === 'credit_notes')!;
    expect(nota.datos.total_cents).toBe(30_000);

    // LA FACTURA SIGUE VIVA. Una parcial corrige el importe; el documento no se anula.
    expect(escrituras.some((e) => e.tabla === 'invoices' && e.datos.status === 'ANULADA')).toBe(false);
  });

  it('NO MUEVE INVENTARIO, aunque la factura tenga salidas de stock', async () => {
    // Es la decisión que más se puede hacer mal en silencio: sin saber QUÉ línea se acredita, no hay
    // forma de saber qué volvió. Devolver stock adivinando pondría en el inventario unidades que
    // siguen en la casa del cliente.
    const { cliente, escrituras } = clienteFalso({
      factura: FACTURA_EMITIDA,
      rango: RANGO,
      movimientos: [{ item_id: 'it-1', lot_id: null, qty: -2 }],
    });

    const r = await anularFactura(cliente, 'c1', {
      invoiceId: 'inv-1',
      motivo: 'DESCUENTO',
      montoCents: 25_000,
    });

    expect(escrituras.filter((e) => e.tabla === 'inventory_movements')).toHaveLength(0);
    expect(r.movimientosDevueltos).toBe(0);
  });

  it('el evento acredita SÓLO lo parcial, que es de donde sale el saldo nuevo', async () => {
    const { cliente, escrituras } = clienteFalso({ factura: FACTURA_EMITIDA, rango: RANGO });
    await anularFactura(cliente, 'c1', { invoiceId: 'inv-1', motivo: 'DESCUENTO', montoCents: 30_000 });

    const evento = escrituras.find(
      (e) => e.tabla === 'invoice_events' && e.datos.event_type === 'CREDIT_NOTE_APPLIED',
    )!;
    // Si acá fuera el total, una parcial dejaría el saldo en 0 y la factura figuraría cobrada.
    expect((evento.datos.payload as { amountCents: number }).amountCents).toBe(30_000);
  });

  it('LA QUE COMPLETA EL TOTAL SÍ ANULA, aunque se pida como parcial', async () => {
    // Ya hay $70.000 acreditados y se piden los $30.000 que faltan: el resultado es una factura
    // acreditada entera, así que se comporta como anulación —incluida la devolución del stock—.
    const { cliente, escrituras } = clienteFalso({
      factura: FACTURA_EMITIDA,
      rango: RANGO,
      acreditadas: [70_000],
      movimientos: [{ item_id: 'it-1', lot_id: null, qty: -1 }],
    });

    const r = await anularFactura(cliente, 'c1', {
      invoiceId: 'inv-1',
      motivo: 'DEVOLUCION',
      montoCents: 30_000,
    });

    expect(r.anulada).toBe(true);
    expect(r.acreditableRestante).toBe(0);
    expect(escrituras.some((e) => e.tabla === 'invoices' && e.datos.status === 'ANULADA')).toBe(true);
    expect(escrituras.filter((e) => e.tabla === 'inventory_movements')).toHaveLength(1);
  });

  it('sin monto, sigue siendo la anulación de siempre', async () => {
    const { cliente } = clienteFalso({ factura: FACTURA_EMITIDA, rango: RANGO });
    const r = await anularFactura(cliente, 'c1', { invoiceId: 'inv-1', motivo: 'ANULACION' });
    expect(r.anulada).toBe(true);
    expect(r.totalCents).toBe(100_000);
  });
});

// ── Lo que encontró el review del 23-ago, el mismo día que las parciales entraron a producción ──
describe('los defectos que trajeron las parciales', () => {
  // EL CUFE TIENE QUE SER EL DE LA FACTURA. Las notas crédito se registran en `fiscal_documents`
  // con el `invoice_id` de la factura que corrigen, así que "el documento más reciente de esta
  // factura" deja de ser la factura en cuanto existe una nota: la SEGUNDA parcial se le mandaba a
  // la DIAN referenciando el CUFE de la PRIMERA nota. Con una sola nota por factura era
  // inalcanzable; con parciales es el camino normal.
  it('la nota crédito referencia el CUFE de la FACTURA, no el de la nota anterior', async () => {
    const { cliente, filtros } = clienteFalso({ factura: FACTURA_EMITIDA, acreditadas: [30_000] });
    await anularFactura(cliente, 'clinic-1', { invoiceId: 'inv-1', motivo: 'ANULACION', montoCents: 10_000 });
    expect(
      filtros.fiscal_documents ?? [],
      'sin excluir las notas crédito, se referencia la nota anterior en vez de la factura',
    ).toContain('neq:doc_kind=NOTA_CREDITO');
  });

  // LA GUARDA DE LA PLATA REVISA SU PROPIO ERROR. Sin esto, un SELECT fallido dejaba `previas` en
  // null, `yaAcreditado` en 0 y `acreditable` en el total entero: una factura ya acreditada por
  // completo habría aceptado otra nota por todo su valor. Todas las demás lecturas de la función
  // miran su error; la única que no lo hacía era justo ésta.
  it('si no se puede leer lo ya acreditado, NO se acredita a ciegas', async () => {
    const { cliente, rpcs } = clienteFalso({ factura: FACTURA_EMITIDA, previasFallan: true });
    await expect(
      anularFactura(cliente, 'clinic-1', { invoiceId: 'inv-1', motivo: 'ANULACION' }),
    ).rejects.toThrow(/no se pudo leer lo ya acreditado/i);
    // Y corta ANTES del consecutivo: un número quemado no se devuelve.
    expect(rpcs).toEqual([]);
  });
});
