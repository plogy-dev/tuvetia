// Proveedor fiscal SANDBOX: determinista, sin red, para desarrollo y tests.
// Port del MockDianProvider de Vetnia. Reglas:
//   • docNumber "999999999" → RECHAZADO (para probar el camino de rechazo).
//   • docNumber "888888888" → lanza (para probar el camino PENDIENTE/reintento).
//   • Todo lo demás → ACEPTADO con CUFE simulado determinista.
// El CUFE lleva prefijo CUFE-SANDBOX para que jamás se confunda con uno real;
// la representación gráfica debe marcar "AMBIENTE DE PRUEBAS" cuando isSandbox.

import type {
  FiscalCreditNoteSubmission,
  FiscalProvider,
  FiscalResult,
  FiscalSubmission,
} from './types';

/** Hash determinista simple para CUFEs simulados (NO criptográfico). */
function pseudoCufe(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  return `CUFE-SANDBOX-${hex}${hex.split('').reverse().join('')}`;
}

export const SANDBOX_REJECT_DOC = '999999999';
export const SANDBOX_ERROR_DOC = '888888888';

export class SandboxFiscalProvider implements FiscalProvider {
  readonly name = 'SANDBOX';

  async submitInvoice(sub: FiscalSubmission): Promise<FiscalResult> {
    if (sub.buyer.docNumber === SANDBOX_ERROR_DOC) {
      throw new Error('Proveedor fiscal no disponible (falla simulada)');
    }
    if (sub.buyer.docNumber === SANDBOX_REJECT_DOC) {
      return {
        accepted: false,
        status: 'RECHAZADO',
        cufe: null,
        providerMessage: 'Documento del adquiriente inválido (rechazo simulado)',
        providerRef: null,
      };
    }
    return {
      accepted: true,
      status: 'ACEPTADO',
      cufe: pseudoCufe(`${sub.fullNumber}|${sub.totalCents}`),
      providerMessage: `Documento ${sub.docKind} validado (sandbox)`,
      providerRef: `sandbox-${sub.fullNumber}`,
    };
  }

  async submitCreditNote(sub: FiscalCreditNoteSubmission): Promise<FiscalResult> {
    return {
      accepted: true,
      status: 'ACEPTADO',
      cufe: pseudoCufe(`NC|${sub.fullNumber}|${sub.totalCents}`),
      providerMessage: 'Nota crédito validada (sandbox)',
      providerRef: `sandbox-${sub.fullNumber}`,
    };
  }
}

export const sandboxFiscalProvider = new SandboxFiscalProvider();
