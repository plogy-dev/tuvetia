// Política de recordatorios de la clínica: pasos por defecto y parsing de la
// política guardada en billing_settings.reminder_policy (jsonb). Determinista.

import { DEFAULT_POLICY_STEPS, type PolicyStep } from '@/lib/facturacion/domain/reminders';
import type { ReminderStepKind } from '@/lib/facturacion/domain/types';

const VALID_KINDS: ReminderStepKind[] = [
  'ENVIO_FACTURA',
  'RECORDATORIO_1',
  'RECORDATORIO_2',
  'AVISO_SALDO',
  'ESCALAMIENTO',
];

/** Lee la política del vet o cae a la por defecto (vencimiento → +3 → +7 → +15). */
export function resolvePolicySteps(raw: unknown): PolicyStep[] {
  if (!raw || typeof raw !== 'object') return DEFAULT_POLICY_STEPS;
  const steps = (raw as { steps?: unknown }).steps ?? raw;
  if (!Array.isArray(steps)) return DEFAULT_POLICY_STEPS;
  const parsed: PolicyStep[] = [];
  for (const s of steps) {
    if (!s || typeof s !== 'object') continue;
    const kind = (s as { kind?: unknown }).kind;
    const offset = (s as { offsetDays?: unknown }).offsetDays;
    if (
      typeof kind === 'string' &&
      VALID_KINDS.includes(kind as ReminderStepKind) &&
      typeof offset === 'number' &&
      Number.isFinite(offset)
    ) {
      parsed.push({ kind: kind as ReminderStepKind, offsetDays: offset });
    }
  }
  return parsed.length > 0 ? parsed : DEFAULT_POLICY_STEPS;
}
