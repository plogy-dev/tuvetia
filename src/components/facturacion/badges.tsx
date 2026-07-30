import type {
  CollectionStatus,
  DeliveryStatus,
  FiscalStatus,
  FollowupStatus,
} from '@/lib/facturacion/domain/types';
import type { InvoiceLifecycleStatus } from '@/lib/supabase/types';

/**
 * Badges de las 4 dimensiones de estado de una factura (fiscal / recaudo /
 * entrega / seguimiento) + el ciclo operativo. Server-safe (sin hooks).
 */

const FISCAL_LABELS: Record<FiscalStatus, string> = {
  BORRADOR: 'Borrador',
  PENDIENTE_VALIDACION: 'Pendiente de validación',
  VALIDADA: 'Validada',
  RECHAZADA: 'Rechazada',
  AFECTADA_POR_NOTA_CREDITO: 'Con nota crédito',
};

const COLLECTION_LABELS: Record<CollectionStatus, string> = {
  PENDIENTE: 'Pendiente de pago',
  PARCIALMENTE_PAGADA: 'Pago parcial',
  PAGADA: 'Pagada',
  VENCIDA: 'Vencida',
  EN_DISPUTA: 'En disputa',
  EN_PROMESA_DE_PAGO: 'Promesa de pago',
  CASTIGADA: 'Castigada',
};

const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  NO_ENVIADA: 'No enviada',
  EN_COLA: 'En cola de envío',
  ENVIADA: 'Enviada',
  ENTREGADA: 'Entregada',
  FALLIDA: 'Envío fallido',
};

const FOLLOWUP_LABELS: Record<FollowupStatus, string> = {
  NO_REQUERIDO: 'Sin seguimiento',
  PROGRAMADO: 'Seguimiento programado',
  ACTIVO: 'Seguimiento activo',
  PAUSADO: 'Seguimiento en pausa',
  COMPLETADO: 'Seguimiento completado',
  CANCELADO: 'Seguimiento cancelado',
  REQUIERE_ATENCION_HUMANA: 'Requiere atención',
};

const STATUS_LABELS: Record<InvoiceLifecycleStatus, string> = {
  BORRADOR: 'Borrador',
  EMITIENDO: 'Emitiendo…',
  EMITIDA: 'Emitida',
  ANULADA: 'Anulada',
};

function tone(kind: 'ok' | 'warn' | 'bad' | 'neutral'): string {
  switch (kind) {
    case 'ok':
      return 'border-ok/40 bg-surface text-ok';
    case 'warn':
      return 'border-warn/40 bg-surface text-warn';
    case 'bad':
      return 'border-transparent bg-danger-soft text-danger';
    default:
      return 'border-line bg-surface text-fg-muted';
  }
}

function Badge({ label, kind }: { label: string; kind: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  return (
    <span
      className={`inline-flex h-[21px] items-center gap-[5px] whitespace-nowrap rounded-full border px-2 text-[11.5px] font-medium tracking-[0.015em] ${tone(kind)}`}
    >
      {/* Punto de estado (como en el mockup); los neutros van sin punto */}
      {kind !== 'neutral' && (
        <span aria-hidden className="size-[5px] shrink-0 rounded-full bg-current" />
      )}
      {label}
    </span>
  );
}

export function FiscalBadge({ status }: { status: FiscalStatus }) {
  const kind =
    status === 'VALIDADA' ? 'ok' : status === 'RECHAZADA' ? 'bad' : status === 'PENDIENTE_VALIDACION' ? 'warn' : 'neutral';
  return <Badge label={FISCAL_LABELS[status]} kind={kind} />;
}

export function CollectionBadge({ status }: { status: CollectionStatus }) {
  const kind =
    status === 'PAGADA' ? 'ok' : status === 'VENCIDA' || status === 'EN_DISPUTA' ? 'bad' : status === 'PARCIALMENTE_PAGADA' ? 'warn' : 'neutral';
  return <Badge label={COLLECTION_LABELS[status]} kind={kind} />;
}

export function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  const kind = status === 'ENTREGADA' ? 'ok' : status === 'FALLIDA' ? 'bad' : status === 'ENVIADA' ? 'warn' : 'neutral';
  return <Badge label={DELIVERY_LABELS[status]} kind={kind} />;
}

export function LifecycleBadge({ status }: { status: InvoiceLifecycleStatus }) {
  const kind = status === 'EMITIDA' ? 'ok' : status === 'ANULADA' ? 'bad' : 'neutral';
  return <Badge label={STATUS_LABELS[status]} kind={kind} />;
}

export function FollowupBadge({ status }: { status: FollowupStatus }) {
  if (status === 'NO_REQUERIDO') return null; // sin ruido cuando no aplica
  const kind =
    status === 'REQUIERE_ATENCION_HUMANA'
      ? 'bad'
      : status === 'PAUSADO' || status === 'CANCELADO'
        ? 'warn'
        : status === 'COMPLETADO'
          ? 'ok'
          : 'neutral';
  return <Badge label={FOLLOWUP_LABELS[status]} kind={kind} />;
}
