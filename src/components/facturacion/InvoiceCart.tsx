'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Plus,
  Save,
  ScanBarcode,
  Search,
  Trash2,
} from 'lucide-react';
import { createInvoiceDraft, type CreateDraftInput } from '@/lib/facturacion/actions';
import {
  aPesosEnteros,
  computeLineAmounts,
  computeInvoiceTotals,
  formatCOP,
  lineSubtotalCents,
  prorratearDescuentoGlobal,
  roundHalfUp,
} from '@/lib/facturacion/domain/money';
import { checkPosThreshold } from '@/lib/facturacion/domain/dian-rules';
import { SelectorDeCliente } from '@/components/facturacion/SelectorDeCliente';
import { buscarPorCodigo } from '@/lib/facturacion/buscar-por-codigo';
import type { DocKind } from '@/lib/facturacion/domain/types';
import type { CatalogItemRow, PaymentTerms } from '@/lib/supabase/types';
import { InputMoneda } from '@/components/ui/input-moneda';

/**
 * «Nueva cuenta» — el formulario de venta, copiado de OkVet.
 *
 * ── POR QUÉ ES UNA COPIA Y NO UN DISEÑO PROPIO ────────────────────────────────────────────────
 *
 * David lo pidió explícito y dos veces: COPIA EXACTA del módulo de ventas de OkVet. El motivo no es
 * estético sino de ADOPCIÓN — los veterinarios ya saben usar OkVet, y cada diferencia, aunque sea
 * una mejora, es algo que tienen que reaprender. Mirado con la cuenta del cliente el 24-ago:
 * pantalla «Nueva cuenta», con la cabecera de creación y total arriba, la fila de propietario /
 * referencia / forma de pago, las líneas, el descuento global con su razón, observaciones, y
 * `Cerrar` · `Guardar` abajo.
 *
 * ── LO QUE SE FUE, Y POR QUÉ ──────────────────────────────────────────────────────────────────
 *
 * SE FUE «EMITIR AHORA» DE ESTA PANTALLA, junto con el bloque de cobro. En OkVet, `Guardar` crea
 * una CUENTA (`/VentaAbierta`) y no emite nada: cobrar y facturar pasan después, sobre el documento.
 * Acá es lo mismo — se guarda el borrador y se navega a él, que es donde `InvoiceActionsPanel` ya
 * sabe emitir declarando la realidad del pago y registrar abonos.
 *
 * Y hay una razón para que ESE orden sea el bueno más allá de la copia: emitir asigna un consecutivo
 * DIAN y transmite el documento. Es irreversible —sólo se corrige con nota crédito— y no debería
 * estar a un clic del mismo botón que guarda.
 *
 * ── LO QUE NO ES COPIA, DICHO ─────────────────────────────────────────────────────────────────
 *
 * El selector de TIPO DE DOCUMENTO (POS / factura de venta) no existe en el modal de OkVet, y acá
 * sí: de él dependen el consecutivo y el aviso de las 5 UVT del art. 616-1. Es la única adición.
 */

type CartLine = {
  key: number;
  catalogItemId: string | null;
  description: string;
  qty: number;
  unitPriceCents: number;
  taxRate: number;
  /**
   * Descuento de la línea en PORCENTAJE, que es como lo pide OkVet («Descuento» con sufijo %).
   *
   * Se guarda el porcentaje y se convierte a centavos al calcular, no al revés: guardando los
   * centavos, cambiar la cantidad o el precio dejaría un descuento fijo que ya no corresponde al
   * porcentaje que el vet escribió, y nadie volvería a mirarlo.
   */
  discountPct: number;
};

const FORMAS_DE_PAGO: { value: PaymentTerms; label: string }[] = [
  { value: 'IMMEDIATE', label: 'Contado' },
  { value: 'CREDIT', label: 'Crédito' },
];

export function InvoiceCart({
  items,
  ownerId: ownerIdInicial,
  ownerName: ownerNameInicial,
  patientId: patientIdInicial,
  patientName: patientNameInicial,
  consultationId,
  renglonesIniciales,
  defaultDocKind,
  uvtValueCents,
  cobertura: coberturaDelInicial,
  abiertaEn,
}: {
  items: CatalogItemRow[];
  ownerId?: string;
  ownerName?: string;
  patientId?: string;
  patientName?: string;
  consultationId?: string;
  /**
   * Lo que se recetó en la consulta, ya cruzado con el catálogo (`lib/facturacion/lo-recetado`).
   *
   * ARRANCA EL CARRITO LLENO en vez de vacío. Antes, venir desde una consulta traía el paciente y
   * el titular pero ninguna línea: el vet tenía que releer el plan en otra pestaña y volver a
   * teclear lo que ya estaba escrito.
   *
   * TODO ENTRA EN CANTIDAD 1 — la posología no se convierte en unidades. Ver el módulo: si el
   * cálculo falla, falla en la factura de un cliente, y un número que ya viene puesto y parece
   * razonable no lo revisa nadie.
   */
  renglonesIniciales?: {
    descripcion: string;
    catalogItemId: string | null;
    unitPriceCents: number;
    taxRate: number;
  }[];
  defaultDocKind: DocKind;
  uvtValueCents: number;
  /**
   * El plan de salud del paciente, si tiene uno vigente, con lo que le queda de cada servicio.
   *
   * ── POR QUÉ AVISA Y NO DESCUENTA SOLO ─────────────────────────────────────────────────────
   *
   * Sería fácil poner la línea en cero automáticamente. No se hace, y es a propósito: quien decide
   * si esta consulta se imputa al plan o se cobra aparte es el veterinario, no la pantalla. Una
   * cuenta que se descuenta sola es una cuenta que nadie revisa hasta que el titular reclama.
   *
   * Lo que sí hace es que sea IMPOSIBLE no verlo: si la línea está cubierta y quedan usos, lo dice
   * ahí mismo. El plan que no se ve en el momento de cobrar es un plan que la clínica vendió y
   * después cobró igual.
   */
  cobertura?: {
    planNombre: string;
    porItem: Record<string, { nombre: string; incluidas: number; restantes: number }>;
  } | null;
  /**
   * Cuándo se abrió la cuenta, en ISO. Viene del SERVIDOR a propósito: `new Date()` dentro del
   * componente es impuro y `react-hooks/purity` lo rechaza — con razón, porque haría que el mismo
   * render diera resultados distintos.
   */
  abiertaEn: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Cuenta ya creada en este intento (para no duplicarla si se pulsa dos veces) y su URL.
  const draftRef = useRef<{ key: string; url: string } | null>(null);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  // ── A QUIÉN SE LE VENDE, COMO ESTADO ────────────────────────────────────────────────────────
  //
  // Era prop inmutable y «Editar» era un <Link> que NAVEGABA al buscador: el carrito se
  // desmontaba y todo lo tecleado se perdía — «no está funcionando de forma dinámica» (David,
  // 25-ago). Ahora el cliente se elige y se cambia EN la cuenta, con el flujo que él describió:
  // botón → dos papeletas → lupa. La URL no se toca: las líneas también son estado y un refresh
  // ya perdía la cuenta entera; serializar sólo el cliente sería consistencia a medias.
  const [cliente, setCliente] = useState({
    ownerId: ownerIdInicial ?? null,
    ownerName: ownerNameInicial ?? null,
    patientId: patientIdInicial ?? null,
    patientName: patientNameInicial ?? null,
  });
  const [eligiendoCliente, setEligiendoCliente] = useState(false);
  // La cobertura del plan de salud la trajo el SERVIDOR para el paciente con el que se abrió la
  // cuenta. Si el vet cambia de cliente acá adentro, ese plan ya no es de quien se factura:
  // anunciarlo sería prometerle el descuento de otro. Se apaga y la cuenta se cobra normal — el
  // mismo comportamiento de antes de que existieran los planes. (Traer el plan del paciente nuevo
  // exigiría una consulta desde el navegador; si los planes agarran uso, ese es el siguiente paso.)
  const cobertura =
    cliente.patientId === (patientIdInicial ?? null) ? coberturaDelInicial : null;
  // `aPesosEnteros` EN TODA LÍNEA QUE ENTRA. El precio puede venir del catálogo con centavos —los
  // admite la columna y los trae la importación— y el campo de plata sólo sabe escribir pesos: sin
  // normalizar acá, la casilla mostraba el precio truncado mientras la cuenta usaba los centavos
  // exactos, y el monto de la línea no daba «lo que se ve × cantidad». Ver `money.ts`.
  const [lines, setLines] = useState<CartLine[]>(() =>
    (renglonesIniciales ?? []).map((r, i) => ({
      key: i,
      catalogItemId: r.catalogItemId,
      description: r.descripcion,
      qty: 1,
      unitPriceCents: aPesosEnteros(r.unitPriceCents),
      taxRate: r.taxRate,
      discountPct: 0,
    })),
  );
  const [docKind, setDocKind] = useState<DocKind>(defaultDocKind);
  const [formaDePago, setFormaDePago] = useState<PaymentTerms>('IMMEDIATE');
  const [referencia, setReferencia] = useState('');
  // Descuento de la FACTURA, en centavos. OkVet lo pide en pesos, no en porcentaje como el de línea.
  const [descuentoGlobalCents, setDescuentoGlobalCents] = useState(0);
  const [razonDelDescuento, setRazonDelDescuento] = useState('');
  const [notes, setNotes] = useState('');
  // Arranca DESPUÉS de las líneas sembradas, o la primera que se agregue a mano pisaría la clave
  // de una de ellas y React reusaría la fila equivocada.
  const [nextKey, setNextKey] = useState((renglonesIniciales?.length ?? 0) + 1)
  /**
   * Qué tarjetas están plegadas, por clave de línea.
   *
   * Se guarda lo PLEGADO y no lo desplegado: una línea nueva tiene que aparecer abierta, y con un
   * conjunto de «abiertas» habría que acordarse de agregarla en los tres sitios que crean líneas.
   */
  const [plegadas, setPlegadas] = useState<Set<number>>(() => new Set())

  // ── El lector de código de barras ───────────────────────────────────────────────────────────
  const [escaneando, setEscaneando] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [avisoDelEscaner, setAvisoDelEscaner] = useState<
    { tono: 'ok' | 'mal'; texto: string } | null
  >(null)
  const campoDelEscaner = useRef<HTMLInputElement | null>(null)

  function leerCodigo() {
    const r = buscarPorCodigo(items, codigo)
    if (r.tipo === 'vacio') return
    if (r.tipo === 'encontrado') {
      addCatalogLine(r.item.id)
      setAvisoDelEscaner({ tono: 'ok', texto: `Agregado: ${r.item.name}` })
    } else if (r.tipo === 'ambiguo') {
      // NO se elige uno: facturaría el producto equivocado y no se descubre hasta que el
      // inventario no cuadra. Es un error de datos que la clínica puede arreglar — si se lo dicen.
      setAvisoDelEscaner({
        tono: 'mal',
        texto: `Hay ${r.items.length} productos con ese código (${r.items
          .map((i) => i.name)
          .join(', ')}). Corregilo en el catálogo.`,
      })
    } else {
      setAvisoDelEscaner({ tono: 'mal', texto: `«${codigo.trim()}» no está en el catálogo.` })
    }
    // Se limpia y se queda listo para la siguiente, con o sin acierto: en un mostrador se escanean
    // varias cosas seguidas y volver a hacer clic entre una y otra convierte el lector en estorbo.
    setCodigo('')
    campoDelEscaner.current?.focus()
  }

  function alternarPlegada(key: number) {
    setPlegadas((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(key)) siguiente.delete(key)
      else siguiente.add(key)
      return siguiente
    })
  };

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const creacion = useMemo(
    () =>
      new Intl.DateTimeFormat('es-CO', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'America/Bogota',
      }).format(new Date(abiertaEn)),
    [abiertaEn],
  );

  function addCatalogLine(itemId: string) {
    const item = itemById.get(itemId);
    if (!item) return;
    setLines((ls) => {
      const existing = ls.find((l) => l.catalogItemId === itemId);
      if (existing) {
        return ls.map((l) => (l.catalogItemId === itemId ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...ls,
        {
          key: nextKey,
          catalogItemId: item.id,
          description: item.name,
          qty: 1,
          // Mismo motivo que al sembrar: lo que se ve y lo que se factura tienen que ser el mismo
          // número, y el catálogo puede traer centavos.
          unitPriceCents: aPesosEnteros(item.price_cents),
          taxRate: item.tax_rate,
          discountPct: 0,
        },
      ];
    });
    setNextKey((k) => k + 1);
  }

  function addManualLine() {
    setLines((ls) => [
      ...ls,
      {
        key: nextKey,
        catalogItemId: null,
        description: '',
        qty: 1,
        unitPriceCents: 0,
        taxRate: 19,
        discountPct: 0,
      },
    ]);
    setNextKey((k) => k + 1);
  }

  function updateLine(key: number, patch: Partial<CartLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: number) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  // Totales en vivo con el dominio (mismo redondeo half-up del servidor).
  //
  // EL DESCUENTO GLOBAL SE PRORRATEA ACÁ, con la misma función pura que usa el servidor al
  // persistir. No es una duplicación del cálculo: es la única forma de que el total que el vet
  // aprueba en pantalla y el que queda en la factura no se separen en el último centavo.
  //
  // El error no se traga: un descuento mayor que el subtotal es lo que más probablemente se teclee
  // mal, y con un `catch` mudo la pantalla sólo mostraría rayas sin decir por qué.
  const calculo = useMemo(() => {
    try {
      // El % de la línea se vuelve centavos ACÁ, y se topa en el subtotal: un 120 % tecleado de más
      // haría que `taxableBaseCents` lance, y el vet vería un error en vez de un descuento tope.
      const propios = lines.map((l) => {
        const subtotal = lineSubtotalCents(l.qty, l.unitPriceCents);
        const pct = Math.min(100, Math.max(0, l.discountPct));
        return Math.min(subtotal, roundHalfUp((subtotal * pct) / 100));
      });
      const bases = lines.map((l, i) => lineSubtotalCents(l.qty, l.unitPriceCents) - propios[i]);
      const partes = prorratearDescuentoGlobal(bases, descuentoGlobalCents);
      const montos = lines.map((l, i) =>
        computeLineAmounts({
          qty: l.qty,
          unitPriceCents: l.unitPriceCents,
          taxRate: l.taxRate,
          discountCents: propios[i] + partes[i],
        }),
      );
      return {
        propios,
        montos,
        totals: computeInvoiceTotals(montos),
        problema: null as string | null,
      };
    } catch (e) {
      return {
        propios: null,
        montos: null,
        totals: null,
        problema: e instanceof Error ? e.message : 'Los importes no cuadran.',
      };
    }
  }, [lines, descuentoGlobalCents]);
  const totals = calculo.totals;

  const posWarning =
    totals && docKind === 'POS'
      ? checkPosThreshold(totals.subtotalCents - totals.discountCents, uvtValueCents)
      : null;

  function buildInput(): CreateDraftInput {
    return {
      ownerId: cliente.ownerId,
      patientId: cliente.patientId,
      consultationId: consultationId ?? null,
      docKind,
      lines: lines.map((l, i) => ({
        catalogItemId: l.catalogItemId,
        description: l.catalogItemId ? null : l.description,
        qty: l.qty,
        unitPriceCents: l.catalogItemId ? null : l.unitPriceCents,
        taxRate: l.catalogItemId ? null : l.taxRate,
        // Va el descuento PROPIO de la línea, ya en centavos. El global viaja aparte y lo prorratea
        // el servidor: mandarlo repartido dejaría al cliente decidiendo cuánto tributa cada línea.
        discountCents: calculo.propios?.[i] ?? 0,
      })),
      globalDiscountCents: descuentoGlobalCents,
      globalDiscountReason: razonDelDescuento.trim() || null,
      reference: referencia.trim() || null,
      notes: notes.trim() || null,
      paymentTerms: formaDePago,
    };
  }

  function guardar() {
    setError(null);
    setWarnings([]);
    if (lines.length === 0) {
      setError('Agrega al menos una línea.');
      return;
    }
    if (calculo.problema) {
      setError(calculo.problema);
      return;
    }
    // La razón se exige acá, en el servidor y en la base (0081). Acá es donde el vet puede
    // corregirla sin perder lo que ya escribió.
    if (descuentoGlobalCents > 0 && !razonDelDescuento.trim()) {
      setError('Escribe la razón del descuento global.');
      return;
    }
    startTransition(async () => {
      const input = buildInput();
      const inputKey = JSON.stringify(input);
      // Idempotencia: si ya se guardó esta misma cuenta, no se crea otra — se navega a la que hay.
      if (draftRef.current?.key === inputKey) {
        router.push(draftRef.current.url);
        return;
      }
      const created = await createInvoiceDraft(input);
      if (!created.ok) {
        setError(created.error);
        return;
      }
      const avisos = created.preview.warnings.map((w) => w.message);
      draftRef.current = { key: inputKey, url: created.url };
      // Con avisos del servidor (existencia insuficiente, datos del pagador incompletos…) no se
      // navega en silencio: la cuenta YA quedó guardada, el vet los lee y sigue con el enlace.
      if (avisos.length > 0) {
        setWarnings(avisos);
        setDraftUrl(created.url);
        return;
      }
      router.push(created.url);
    });
  }

  return (
    <div className="space-y-5">
      {/* Cabecera: cuándo se abrió la cuenta y cuánto va, como en la referencia. */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-surface-2 px-5 py-4">
        <p className="text-sm">
          <span className="text-fg-faint">Creación: </span>
          <span className="text-fg-muted">{creacion}</span>
        </p>
        <div className="text-right">
          <p className="text-sm text-fg-muted">
            Total{' '}
            <span className="align-middle text-2xl font-semibold text-brand">
              {totals ? formatCOP(totals.totalCents) : '—'}
            </span>
          </p>
          <p className="text-xs text-fg-faint">Impuestos incluidos</p>
        </div>
      </div>

      {/* Propietario · referencia · forma de pago · tipo de documento */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="block text-xs font-medium text-fg-muted">Propietario o Cliente</span>
          <div className="mt-1 flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate py-2 text-sm">
              {cliente.ownerName ? (
                <span className="font-medium text-fg">{cliente.ownerName}</span>
              ) : (
                <span className="italic text-fg-faint">Venta a persona indeterminada</span>
              )}
            </p>
            {/* «Editar», al lado del nombre y no escondido — es el control de OkVet, y acá además
                es lo que evita que una cuenta se emita a consumidor final sin querer: sin cliente
                la factura queda fuera de cartera y sin correo a dónde mandarla.

                ES UN BOTÓN, NO UN LINK. El Link navegaba al buscador y DESMONTABA el carrito con
                todo lo tecleado adentro — «no está funcionando de forma dinámica» (David, 25-ago).
                El selector (dos papeletas → lupa) cambia el cliente acá mismo, sin salir. */}
            <button
              type="button"
              onClick={() => setEligiendoCliente(true)}
              className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
            >
              Editar
            </button>
            <SelectorDeCliente
              open={eligiendoCliente}
              onOpenChange={setEligiendoCliente}
              onElegir={setCliente}
            />
          </div>
          {(cliente.patientName || consultationId) && (
            <p className="-mt-1 text-xs text-fg-faint">
              {cliente.patientName ? `Paciente ${cliente.patientName}` : ''}
              {cliente.patientName && consultationId ? ' · ' : ''}
              {consultationId ? 'consulta asociada' : ''}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="referencia" className="block text-xs font-medium text-fg-muted">
            Referencia/Nombre
          </label>
          <input
            id="referencia"
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            maxLength={200}
            placeholder="Ref. mascota, historia, nombre personalizado"
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        <div>
          <label htmlFor="forma-de-pago" className="block text-xs font-medium text-fg-muted">
            Forma de pago
          </label>
          <select
            id="forma-de-pago"
            value={formaDePago}
            onChange={(e) => setFormaDePago(e.target.value as PaymentTerms)}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {FORMAS_DE_PAGO.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tipo-de-documento" className="block text-xs font-medium text-fg-muted">
            Tipo de documento
          </label>
          <select
            id="tipo-de-documento"
            value={docKind}
            onChange={(e) => setDocKind(e.target.value as DocKind)}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="POS">Tiquete POS electrónico</option>
            <option value="FACTURA_VENTA">Factura electrónica de venta</option>
          </select>
        </div>
      </div>

      {/* Agregar líneas */}
      <div className="flex flex-wrap items-start gap-2">
        <CatalogPicker items={items} onPick={addCatalogLine} />
        <button
          type="button"
          onClick={() => {
            setEscaneando((v) => !v)
            setAvisoDelEscaner(null)
          }}
          aria-pressed={escaneando}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition ${
            escaneando
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-line bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg'
          }`}
        >
          <ScanBarcode className="size-4" aria-hidden />
          Desde escáner
        </button>
        <button
          type="button"
          onClick={addManualLine}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg transition"
        >
          <Plus className="size-4" aria-hidden />
          Agregar
        </button>
      </div>

      {/* ── DESDE ESCÁNER ────────────────────────────────────────────────────────────────────
          Un lector USB es un TECLADO: teclea el código muy rápido y manda Enter. No hay API que
          pedir ni permiso que dar — sólo hace falta un campo enfocado y saber qué hacer con lo que
          llega. Por eso esto es un input y no una integración.

          EL CAMPO NO PIERDE EL FOCO entre lecturas: en un mostrador se escanean cuatro cosas
          seguidas, y tener que volver a hacer clic entre una y otra convierte el lector en un
          estorbo. Se limpia y se queda listo para la siguiente.

          ESCANEAR LO MISMO DOS VECES SUMA CANTIDAD, no agrega una línea repetida — es lo que ya
          hacía `addCatalogLine` y acá es exactamente el comportamiento que se quiere: dos frascos
          iguales son cantidad 2. */}
      {escaneando && (
        <div className="rounded-xl border border-brand/40 bg-surface-2 p-3">
          <label htmlFor="codigo-escaneado" className="block text-[11.5px] font-medium text-fg-muted">
            Escaneá el código
          </label>
          <input
            id="codigo-escaneado"
            ref={campoDelEscaner}
            autoFocus
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return
              // El lector manda Enter al terminar. Sin esto, en algunos navegadores dispara el
              // botón por defecto de la zona — que acá es «Guardar».
              e.preventDefault()
              leerCodigo()
            }}
            placeholder="El lector escribe acá y agrega solo"
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-fg placeholder:font-sans placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {avisoDelEscaner && (
            <p
              className={`mt-1.5 text-xs ${
                avisoDelEscaner.tono === "ok" ? "text-ok" : "text-warn"
              }`}
            >
              {avisoDelEscaner.texto}
            </p>
          )}
          <p className="mt-1.5 text-xs text-fg-faint">
            Sirve con el código de barras del producto o con su referencia. Escanear lo mismo dos
            veces suma cantidad.
          </p>
        </div>
      )}


      {lines.length === 0 ? (
        /* ── EL CATÁLOGO A LA VISTA, NO DETRÁS DE UN CLIC ─────────────────────────────────────
           David, 25-ago: «debe ser fácil buscar el producto que se está vendiendo, mira que ahí
           es complejo, no es fácil escoger». El dato que decide el diseño: la clínica más grande
           del principal tiene OCHO ítems de catálogo (promedio: cinco). Con ese volumen no hay
           que buscar — hay que mostrarlos. Antes esta área era un cartel que mandaba a la caja de
           arriba, cuyo popover sólo aparece al enfocarla: los ocho ítems estaban escondidos.

           El tope de 24 no es un límite del catálogo, es de ESTA vitrina: con más, la cuadrícula
           deja de ser un vistazo y el buscador de arriba vuelve a ser el camino. */
        <div className="rounded-xl border border-dashed border-line p-4">
          {items.length === 0 ? (
            <p className="px-0 py-4 text-center text-sm text-fg-faint">
              Busca un producto/servicio o agrega una línea libre.
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs font-medium text-fg-faint">
                Toca para agregar a la cuenta
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {items.slice(0, 24).map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => addCatalogLine(i.id)}
                    className="flex items-baseline justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm transition hover:border-brand/40 hover:bg-surface-2"
                  >
                    <span className="min-w-0 truncate">{i.name}</span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-fg-muted">
                      {formatCOP(i.price_cents)}
                    </span>
                  </button>
                ))}
              </div>
              {items.length > 24 && (
                <p className="mt-2 text-xs text-fg-faint">
                  Se muestran 24 de {items.length}: el resto sale por el buscador de arriba.
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        /* ── CADA LÍNEA ES UNA TARJETA DE DOS FILAS, como en la referencia ────────────────────
           Arriba lo que se teclea en toda venta —concepto, valor unitario, descuento, cantidad— y
           el monto calculado; abajo lo tributario, que casi nunca se toca.

           NO ES SÓLO FIDELIDAD. La tabla que había medía 760 px de ancho mínimo y se desplazaba en
           horizontal: en un portátil de recepción, «Monto» quedaba fuera de la pantalla mientras se
           tecleaba la cantidad. Una tarjeta se acomoda al ancho que haya.

           Y SE PUEDEN PLEGAR: una cuenta de ocho renglones son ocho tarjetas, y a partir de la
           tercera lo único que importa de las anteriores es el concepto y cuánto suman. */
        <>
        {/* El plan, aunque todavía no haya ninguna línea cubierta en el carrito. Sin esto, quien
            factura sólo se entera de que el paciente tiene plan si por casualidad agrega el
            servicio incluido — y si no lo agrega, la clínica cobró un plan que nunca prestó. */}
        {cobertura && (
          <p className="mb-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-fg-muted">
            Este paciente tiene <b className="text-fg">{cobertura.planNombre}</b>. Incluye:{" "}
            {Object.values(cobertura.porItem)
              .map((c) => `${c.nombre} (${c.restantes} de ${c.incluidas})`)
              .join(" · ")}
            .
          </p>
        )}
        <ul className="space-y-2">
          {lines.map((l, idx) => {
            // Del cálculo de arriba, no de un recálculo acá: si esta tarjeta volviera a computar
            // por su cuenta ignoraría el descuento global prorrateado y mostraría un monto de línea
            // que no suma al total de la cuenta.
            const amounts = calculo.montos?.[idx] ?? null
            const plegada = plegadas.has(l.key)
            const base = amounts ? amounts.subtotalCents - amounts.discountCents : null
            return (
              <li key={l.key} className="rounded-xl border border-line bg-surface p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                    {l.description || <span className="text-fg-faint">Línea sin descripción</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {plegada && amounts && (
                      <span className="mr-1 font-mono text-sm tabular-nums text-fg">
                        {formatCOP(amounts.totalCents)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => alternarPlegada(l.key)}
                      aria-expanded={!plegada}
                      aria-label={plegada ? "Desplegar la línea" : "Plegar la línea"}
                      className="rounded-md p-1 text-fg-faint transition hover:bg-surface-2 hover:text-fg"
                    >
                      {plegada ? (
                        <ChevronDown className="size-4" aria-hidden />
                      ) : (
                        <ChevronUp className="size-4" aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeLine(l.key)}
                      className="rounded-md p-1 text-fg-faint transition hover:bg-surface-2 hover:text-warn"
                      aria-label="Quitar línea"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </span>
                </div>

                {/* Lo cubre el plan. Va en el encabezado y NO adentro del pliegue: una tarjeta
                    plegada tiene que seguir diciéndolo — plegar es dejar de mirar los números, no
                    dejar de saber que esto ya está pagado. */}
                {(() => {
                  const cub = l.catalogItemId ? cobertura?.porItem[l.catalogItemId] : undefined
                  if (!cub) return null
                  return (
                    <p
                      className={
                        "mb-2 rounded-md px-2 py-1 text-[11.5px] " +
                        (cub.restantes > 0
                          ? "bg-brand/10 text-brand"
                          : "bg-surface-2 text-fg-faint")
                      }
                    >
                      {cub.restantes > 0 ? (
                        <>
                          Lo cubre <b>{cobertura?.planNombre}</b> — quedan {cub.restantes} de{" "}
                          {cub.incluidas}.
                        </>
                      ) : (
                        <>
                          {cobertura?.planNombre} incluía {cub.incluidas} y ya se usaron todas: esta
                          va cobrada.
                        </>
                      )}
                    </p>
                  )
                })()}

                {!plegada && (
                  <>
                    {/* Fila 1 — lo que se teclea en toda venta. */}
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_130px_110px_100px_auto]">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11.5px] font-medium text-fg-faint">Concepto</span>
                        {l.catalogItemId ? (
                          <span className="py-1.5 text-sm text-fg">{l.description}</span>
                        ) : (
                          <input
                            value={l.description}
                            onChange={(e) => updateLine(l.key, { description: e.target.value })}
                            placeholder="Descripción del servicio/producto"
                            className="min-w-0 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                          />
                        )}
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-[11.5px] font-medium text-fg-faint">Valor unitario</span>
                        {l.catalogItemId ? (
                          <span className="py-1.5 font-mono text-sm tabular-nums text-fg-muted">
                            {formatCOP(l.unitPriceCents)}
                          </span>
                        ) : (
                          <InputMoneda
                            aria-label="Precio unitario en pesos"
                            /* Sin el rótulo COP: la tarjeta ya lo dice en su etiqueta, y en este
                               ancho el prefijo se comería el número. Lo que importa acá es el
                               separador de miles. */
                            mostrarMoneda={false}
                            /* `roundHalfUp` y no `Math.trunc`: con la normalización de arriba el
                               valor ya es múltiplo de 100 y las dos dan lo mismo, pero truncar
                               volvería a mostrar de menos el día que una línea entre por un camino
                               que todavía no normaliza. */
                            value={
                              l.unitPriceCents === 0 ? null : roundHalfUp(l.unitPriceCents / 100)
                            }
                            onValueChange={(pesos) =>
                              updateLine(l.key, { unitPriceCents: (pesos ?? 0) * 100 })
                            }
                            className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                          />
                        )}
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-[11.5px] font-medium text-fg-faint">Descuento</span>
                        {/* En PORCENTAJE, como la referencia — y editable también en líneas de
                            catálogo, que es justamente el caso normal de un descuento. */}
                        <span className="flex items-center">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={l.discountPct}
                            onChange={(e) =>
                              updateLine(l.key, {
                                discountPct: Math.min(100, Math.max(0, Number(e.target.value))),
                              })
                            }
                            aria-label={`Descuento de ${l.description || "la línea"}, en porcentaje`}
                            className="w-full rounded-l-md border border-line bg-surface px-2 py-1.5 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                          />
                          <span className="rounded-r-md border border-l-0 border-line bg-surface-2 px-2 py-1.5 text-xs text-fg-faint">
                            %
                          </span>
                        </span>
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-[11.5px] font-medium text-fg-faint">Cantidad</span>
                        <input
                          type="number"
                          min={0.25}
                          step={0.25}
                          value={l.qty}
                          onChange={(e) => updateLine(l.key, { qty: Number(e.target.value) })}
                          aria-label={`Cantidad de ${l.description || "la línea"}`}
                          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        />
                      </label>

                      <span className="flex flex-col gap-1 sm:items-end">
                        <span className="text-[11.5px] font-medium text-fg-faint">Monto</span>
                        <span className="py-1.5 font-mono text-sm font-medium tabular-nums text-fg">
                          {amounts ? formatCOP(amounts.totalCents) : "—"}
                        </span>
                      </span>
                    </div>

                    {/* Fila 2 — lo tributario. Va abajo porque casi nunca se toca: en una línea de
                        catálogo el IVA ya viene del ítem, y el valor base es un cálculo. */}
                    <div className="mt-3 grid gap-3 border-t border-line-soft pt-3 sm:grid-cols-[130px_1fr]">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11.5px] font-medium text-fg-faint">IVA</span>
                        {l.catalogItemId ? (
                          <span className="py-1.5 text-sm text-fg-muted">{l.taxRate}%</span>
                        ) : (
                          <select
                            value={l.taxRate}
                            onChange={(e) => updateLine(l.key, { taxRate: Number(e.target.value) })}
                            aria-label={`IVA de ${l.description || "la línea"}`}
                            className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            <option value={0}>0%</option>
                            <option value={5}>5%</option>
                            <option value={19}>19%</option>
                          </select>
                        )}
                      </label>

                      <span className="flex flex-col gap-1">
                        <span className="text-[11.5px] font-medium text-fg-faint">Valor base</span>
                        {/* Sobre esto se liquida el IVA: subtotal menos el descuento, incluida la
                            parte prorrateada del global. Mostrarlo es lo que deja ver POR QUÉ el
                            impuesto da lo que da. */}
                        <span className="py-1.5 font-mono text-sm tabular-nums text-fg-muted">
                          {base !== null ? formatCOP(base) : "—"}
                        </span>
                      </span>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
        </>
      )}

      {/* Descuento global y su razón, uno al lado del otro como en la referencia. */}
      <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
        <div>
          <label htmlFor="descuento-global" className="block text-xs font-medium text-fg-muted">
            Descuento global
          </label>
          <input
            id="descuento-global"
            type="number"
            min={0}
            step={1000}
            value={descuentoGlobalCents / 100}
            onChange={(e) =>
              setDescuentoGlobalCents(Math.max(0, Math.round(Number(e.target.value) * 100)))
            }
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-right text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        <div>
          <label htmlFor="razon-descuento" className="block text-xs font-medium text-fg-muted">
            Razón del descuento global
          </label>
          <input
            id="razon-descuento"
            value={razonDelDescuento}
            onChange={(e) => setRazonDelDescuento(e.target.value)}
            maxLength={300}
            required={descuentoGlobalCents > 0}
            placeholder="Requerido al aplicar descuento global"
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      </div>

      <div>
        <label htmlFor="observaciones" className="sr-only">
          Observaciones
        </label>
        <textarea
          id="observaciones"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Observaciones"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="mt-1 text-xs text-fg-faint">Se imprimen en la factura que ve el titular.</p>
      </div>

      {/* Desglose: el descuento sólo aparece si lo hubo, para no llenar la pantalla de ceros. */}
      <dl className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
        <div className="flex justify-between text-fg-muted">
          <dt>Subtotal</dt>
          <dd>{totals ? formatCOP(totals.subtotalCents) : '—'}</dd>
        </div>
        {totals && totals.discountCents > 0 && (
          <div className="flex justify-between text-fg-muted">
            <dt>Descuento</dt>
            <dd>− {formatCOP(totals.discountCents)}</dd>
          </div>
        )}
        <div className="flex justify-between text-fg-muted">
          <dt>IVA</dt>
          <dd>{totals ? formatCOP(totals.taxCents) : '—'}</dd>
        </div>
        <div className="flex justify-between border-t border-line pt-1.5 text-base font-semibold text-fg">
          <dt>Total</dt>
          <dd>{totals ? formatCOP(totals.totalCents) : '—'}</dd>
        </div>
      </dl>

      {calculo.problema && (
        <p className="flex items-start gap-2 rounded-xl border border-warn bg-surface-2 px-4 py-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {calculo.problema}
        </p>
      )}

      {posWarning?.exceeds && (
        <p className="flex items-start gap-2 rounded-xl border border-warn bg-surface-2 px-4 py-3 text-xs text-warn">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {posWarning.message}
        </p>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-warn bg-surface-2 px-4 py-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {error}
            {draftUrl && (
              <>
                {' '}
                <Link href={draftUrl} className="font-medium underline underline-offset-2">
                  Abrir la cuenta guardada
                </Link>
              </>
            )}
          </span>
        </p>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-line bg-surface-2 px-4 py-3 text-xs text-fg-muted">
          {warnings.map((w, i) => (
            <li key={i}>· {w}</li>
          ))}
          {!error && draftUrl && (
            <li className="pt-1">
              La cuenta quedó guardada.{' '}
              <Link href={draftUrl} className="font-medium text-brand underline underline-offset-2">
                Continuar a la cuenta
              </Link>
            </li>
          )}
        </ul>
      )}

      {/* Pie: cerrar a la izquierda, guardar a la derecha — como la referencia. */}
      <div className="flex items-center justify-between border-t border-line pt-4">
        <Link
          href="/dashboard/facturacion"
          className="rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg transition"
        >
          Cerrar
        </Link>
        <button
          type="button"
          disabled={isPending}
          onClick={guardar}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
        >
          <Save className="size-4" aria-hidden />
          {isPending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}

// ─── Selector de catálogo con búsqueda + filtro por tipo ─────────────────────

const TYPE_FILTERS = [
  { key: '', label: 'Todo' },
  { key: 'SERVICIO', label: 'Servicios' },
  { key: 'PRODUCTO', label: 'Productos' },
  { key: 'MEDICAMENTO', label: 'Medicamentos' },
  { key: 'INSUMO', label: 'Insumos' },
] as const;

const TYPE_LABELS: Record<string, string> = {
  SERVICIO: 'Servicio',
  PRODUCTO: 'Producto',
  MEDICAMENTO: 'Medicamento',
  INSUMO: 'Insumo',
};

function CatalogPicker({
  items,
  onPick,
}: {
  items: CatalogItemRow[];
  onPick: (itemId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  // Índice del resultado resaltado por teclado, sobre la lista PLANA en orden de render. -1 = el
  // teclado todavía no navegó (Enter entonces elige el primero: lo que un cajero espera).
  const [activo, setActivo] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cerrar al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => (typeFilter ? i.item_type === typeFilter : true))
      .filter((i) => (q ? i.name.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q) : true))
      .slice(0, 60);
  }, [items, query, typeFilter]);

  // Agrupar por tipo cuando se ve "Todo" (con filtro activo la lista es plana).
  const grouped = useMemo(() => {
    if (typeFilter) return [[typeFilter, filtered] as const];
    const map = new Map<string, CatalogItemRow[]>();
    for (const i of filtered) {
      const arr = map.get(i.item_type) ?? [];
      arr.push(i);
      map.set(i.item_type, arr);
    }
    // Servicios primero (lo más facturado), luego el resto.
    const order = ['SERVICIO', 'MEDICAMENTO', 'PRODUCTO', 'INSUMO'];
    return order.filter((t) => map.has(t)).map((t) => [t, map.get(t)!] as const);
  }, [filtered, typeFilter]);

  // La misma lista que se pinta, aplanada: el ↑/↓ recorre lo que el ojo ve, cruzando los grupos.
  const planos = useMemo(() => grouped.flatMap(([, arr]) => arr), [grouped]);

  // Nota del port: en el origen esto era una función `pick(id)` que el onClick llamaba. La regla
  // `react-hooks/refs` del compilador de React no puede probar que ese closure solo corre en el
  // click (la lectura del ref queda a una indirección) y lo marcaba como acceso en render. El
  // handler ahora es directo — mismo comportamiento, análisis demostrable.
  function pick(id: string) {
    onPick(id);
    setQuery('');
    setActivo(-1);
  }

  return (
    <div ref={rootRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint"
          aria-hidden
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActivo(-1); // lo resaltado era de la lista anterior
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            // ── EL TECLADO DEL CAJERO ─────────────────────────────────────────────────────────
            // David, 25-ago: «no es fácil escoger». Antes este buscador no tenía NI UNA tecla —
            // no existía un solo ArrowDown en todo el repo—: cada ítem exigía soltar el teclado y
            // agarrar el ratón, en la pantalla donde más se encadena (buscar → agregar → buscar).
            if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) setOpen(true);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActivo((a) => Math.min(a + 1, planos.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActivo((a) => Math.max(a - 1, -1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const elegido = planos[activo] ?? planos[0];
              if (elegido) pick(elegido.id);
            }
          }}
          role="combobox"
          aria-expanded={open}
          aria-controls="catalogo-resultados"
          aria-activedescendant={activo >= 0 ? `catalogo-opcion-${planos[activo]?.id}` : undefined}
          placeholder="Buscar en el catálogo (nombre o SKU)…"
          className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-popover">
          {/* Filtros por tipo */}
          <div className="flex flex-wrap gap-1 border-b border-line px-2 py-2">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setTypeFilter(f.key)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                  typeFilter === f.key
                    ? 'bg-brand text-on-brand'
                    : 'bg-surface-2 text-fg-muted hover:text-fg'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div id="catalogo-resultados" role="listbox" aria-label="Catálogo" className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-fg-faint">
                Sin resultados{query ? ` para «${query}»` : ''}.
              </p>
            ) : (
              grouped.map(([type, groupItems]) => (
                <div key={type}>
                  {!typeFilter && (
                    <p className="sticky top-0 bg-surface-2 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-fg-faint">
                      {TYPE_LABELS[type] ?? type}
                    </p>
                  )}
                  {groupItems.map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      id={`catalogo-opcion-${i.id}`}
                      role="option"
                      aria-selected={planos[activo]?.id === i.id}
                      onClick={() => {
                        pick(i.id)
                        inputRef.current?.focus() // seguir agregando sin reabrir
                      }}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-surface-2 ${
                        planos[activo]?.id === i.id ? 'bg-surface-2' : ''
                      }`}
                    >
                      <span className="min-w-0 truncate text-fg">{i.name}</span>
                      <span className="shrink-0 text-xs text-fg-muted">
                        {formatCOP(i.price_cents)}
                        <span className="ml-1.5 text-fg-faint">
                          {i.tax_status === 'GRAVADO' ? `IVA ${i.tax_rate}%` : 'sin IVA'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
