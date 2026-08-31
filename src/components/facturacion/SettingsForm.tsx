'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check } from 'lucide-react';
import { saveBillingSettings, type SaveSettingsInput } from '@/lib/facturacion/actions';
import type { BillingSettingsRow } from '@/lib/supabase/types';
import { toast } from "sonner"

/**
 * Configuración del emisor en 4 secciones (funciones → datos fiscales →
 * numeración → activar). Guardar ACTIVA el módulo; mientras no haya proveedor
 * fiscal real conectado, la numeración corre en modo sandbox.
 */
export function SettingsForm({ settings }: { settings: BillingSettingsRow | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const fd = new FormData(e.currentTarget);
    const input: SaveSettingsInput = {
      fiscalName: String(fd.get('fiscalName') ?? ''),
      fiscalIdType: fd.get('fiscalIdType') as SaveSettingsInput['fiscalIdType'],
      fiscalIdNumber: String(fd.get('fiscalIdNumber') ?? ''),
      fiscalRegime: fd.get('fiscalRegime') as SaveSettingsInput['fiscalRegime'],
      fiscalAddress: (fd.get('fiscalAddress') as string) || null,
      municipalityCode: (fd.get('municipalityCode') as string) || null,
      departmentCode: null,
      defaultDocKind: fd.get('defaultDocKind') as SaveSettingsInput['defaultDocKind'],
      inventoryEnabled: fd.get('inventoryEnabled') === 'on',
      remindersEnabled: fd.get('remindersEnabled') === 'on',
      blockOnInsufficientStock: fd.get('blockOnInsufficientStock') === 'on',
    };
    startTransition(async () => {
      // La guarda que devuelve los botones (28-ago): si esta promesa RECHAZA —sesión vencida,
      // red caída, o un id de Server Action viejo tras un deploy— React nunca cierra la
      // transición e `isPending` deja los botones deshabilitados hasta recargar.
      try {
        const r = await saveBillingSettings(input);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setSaved(true);
        router.refresh();
    
      } catch (e) {
        toast.error(`No se pudo completar la acción: ${(e as Error)?.message ?? e}`)
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* 1 · Funciones */}
      <div className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-medium text-fg">1 · Funciones del módulo</h2>
        <p className="mt-0.5 text-xs text-fg-faint">
          Facturar siempre queda activo. El inventario es opcional.
        </p>
        <div className="mt-3 space-y-2">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="inventoryEnabled"
              defaultChecked={settings?.inventory_enabled ?? true}
              className="mt-1 size-4 accent-[var(--accent)]"
            />
            <span>
              <span className="block text-sm text-fg">Inventario de productos</span>
              <span className="block text-xs text-fg-faint">
                Existencias por movimientos, lotes y alertas de vencimiento.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="blockOnInsufficientStock"
              defaultChecked={settings?.block_on_insufficient_stock ?? false}
              className="mt-1 size-4 accent-[var(--accent)]"
            />
            <span>
              <span className="block text-sm text-fg">Bloquear venta sin existencias</span>
              <span className="block text-xs text-fg-faint">
                Si está apagado, vender sin stock solo muestra una advertencia.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="remindersEnabled"
              defaultChecked={settings?.reminders_enabled ?? false}
              className="mt-1 size-4 accent-[var(--accent)]"
            />
            <span>
              <span className="block text-sm text-fg">
                Recordatorios de cobranza (facturas a crédito)
              </span>
              <span className="block text-xs text-fg-faint">
                Emails automáticos al vencer: día 0, +3, +7 y +15 — cumpliendo la Ley
                2300 (horario hábil, máx. 1 contacto/día, requiere autorización del
                cliente y se detienen con el pago).
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* 2 · Datos fiscales del emisor */}
      <div className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-medium text-fg">2 · Tus datos fiscales (emisor)</h2>
        <p className="mt-0.5 text-xs text-fg-faint">
          Con estos datos se emiten tus documentos ante la DIAN.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="fiscalName" className="block text-xs font-medium text-fg-muted">
              Nombre o razón social
            </label>
            <input
              id="fiscalName"
              name="fiscalName"
              required
              defaultValue={settings?.fiscal_name ?? ''}
              placeholder="Dra. Ana Pérez / Veterinaria Pérez SAS"
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <label htmlFor="fiscalIdType" className="block text-xs font-medium text-fg-muted">
              Tipo de identificación
            </label>
            <select
              id="fiscalIdType"
              name="fiscalIdType"
              defaultValue={settings?.fiscal_id_type ?? 'NIT'}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="NIT">NIT</option>
              <option value="CC">Cédula de ciudadanía</option>
              <option value="CE">Cédula de extranjería</option>
            </select>
          </div>
          <div>
            <label htmlFor="fiscalIdNumber" className="block text-xs font-medium text-fg-muted">
              Número
            </label>
            <input
              id="fiscalIdNumber"
              name="fiscalIdNumber"
              required
              defaultValue={settings?.fiscal_id_number ?? ''}
              placeholder="900123456-7"
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <label htmlFor="fiscalRegime" className="block text-xs font-medium text-fg-muted">
              Régimen
            </label>
            <select
              id="fiscalRegime"
              name="fiscalRegime"
              defaultValue={settings?.fiscal_regime ?? 'COMUN'}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="COMUN">Responsable de IVA (común)</option>
              <option value="SIMPLE">Régimen SIMPLE</option>
              <option value="NO_RESPONSABLE">No responsable de IVA</option>
            </select>
          </div>
          <div>
            <label htmlFor="municipalityCode" className="block text-xs font-medium text-fg-muted">
              Municipio (código DANE, opcional)
            </label>
            <input
              id="municipalityCode"
              name="municipalityCode"
              defaultValue={settings?.municipality_code ?? ''}
              placeholder="11001 (Bogotá)"
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="fiscalAddress" className="block text-xs font-medium text-fg-muted">
              Dirección (opcional)
            </label>
            <input
              id="fiscalAddress"
              name="fiscalAddress"
              defaultValue={settings?.fiscal_address ?? ''}
              placeholder="Cra 7 # 12-34, Bogotá"
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
        </div>
      </div>

      {/* 3 · Numeración y documento por defecto */}
      <div className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-medium text-fg">3 · Numeración y tipo de documento</h2>
        <p className="mt-0.5 text-xs text-fg-faint">
          Mientras no conectes un proveedor fiscal, los documentos se emiten en{' '}
          <strong>modo sandbox</strong> (rango de prueba, CUFE simulado, sin validez
          ante la DIAN). Cuando el proveedor esté conectado, acá cargarás tu
          resolución de numeración real.
        </p>
        <div className="mt-3">
          <label htmlFor="defaultDocKind" className="block text-xs font-medium text-fg-muted">
            Documento por defecto al facturar
          </label>
          <select
            id="defaultDocKind"
            name="defaultDocKind"
            defaultValue={settings?.default_doc_kind ?? 'POS'}
            className="mt-1 w-full max-w-sm rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="POS">Tiquete POS electrónico (ventas del día a día)</option>
            <option value="FACTURA_VENTA">Factura electrónica de venta</option>
          </select>
          <p className="mt-1.5 text-xs text-fg-faint">
            Si una venta por POS supera 5 UVT (≈ $261.870 en 2026), la app te
            avisa que puede requerirse factura de venta.
          </p>
        </div>
      </div>

      {/* 4 · Activar */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
        >
          {isPending
            ? 'Guardando…'
            : settings?.module_status === 'ACTIVO'
              ? 'Guardar cambios'
              : 'Guardar y activar facturación'}
        </button>
        {!isPending && saved && (
          <span className="inline-flex items-center gap-1 text-xs text-ok">
            <Check className="size-3.5" aria-hidden />
            Guardado — módulo activo
          </span>
        )}
        {!isPending && error && (
          <span className="inline-flex items-center gap-1 text-xs text-warn">
            <AlertTriangle className="size-3.5" aria-hidden />
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
