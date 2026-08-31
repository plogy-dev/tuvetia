'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Plus, Trash2, Upload, Sparkles, FileText } from 'lucide-react';
import {
  getServiceRecipeAction,
  ingestRecipeAction,
  saveServiceRecipeAction,
} from '@/lib/facturacion/actions';
import { toast } from "sonner"

export type RecipeComponentOption = { id: string; name: string; use_unit: string };
type Row = { componentId: string; qty: number };
type Reviewed = { name: string; qty: number; unit: string | null; componentId: string | null; score: number };

/**
 * Editor de la receta de un servicio: filas (componente + cantidad) que el vet
 * arma a mano o importando una imagen/Excel/texto. La IA propone un borrador; el
 * vet corrige el emparejamiento y CONFIRMA — nada se guarda hasta «Guardar».
 */
export function RecipeEditor({
  serviceId,
  components,
}: {
  serviceId: string;
  components: RecipeComponentOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Importación IA
  const [text, setText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [reviewed, setReviewed] = useState<Reviewed[] | null>(null);

  useEffect(() => {
    let vigente = true; // una respuesta obsoleta (cambio rápido de servicio) no pisa la actual
    getServiceRecipeAction({ serviceId })
      .then((r) => {
        if (!vigente) return;
        if (r.ok) setRows(r.components.map((c) => ({ componentId: c.componentId, qty: c.qty })));
        else setError(r.error);
      })
      .catch(() => {
        if (vigente) setError('No se pudo cargar la receta. Cierra y vuelve a abrir.');
      })
      .finally(() => {
        // Sin el finally, un rechazo de transporte dejaba "Cargando receta…" para siempre.
        if (vigente) setLoaded(true);
      });
    return () => {
      vigente = false;
    };
  }, [serviceId]);

  const unit = (id: string) => components.find((c) => c.id === id)?.use_unit ?? '';

  function addRow() {
    const firstFree = components.find((c) => !rows.some((r) => r.componentId === c.id));
    if (firstFree) setRows((rs) => [...rs, { componentId: firstFree.id, qty: 1 }]);
  }
  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, j) => j !== i));
  }

  function save() {
    setError(null);
    setOkMsg(null);
    startTransition(async () => {
      // La guarda que devuelve los botones (28-ago): si esta promesa RECHAZA —sesión vencida,
      // red caída, o un id de Server Action viejo tras un deploy— React nunca cierra la
      // transición e `isPending` deja los botones deshabilitados hasta recargar.
      try {
        const r = await saveServiceRecipeAction({
          serviceId,
          components: rows.map((x) => ({ componentId: x.componentId, qty: x.qty })),
        });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setOkMsg('Receta guardada.');
        router.refresh();
    
      } catch (e) {
        toast.error(`No se pudo completar la acción: ${(e as Error)?.message ?? e}`)
      }
    });
  }

  async function analyzeFile(file: File) {
    setError(null);
    setReviewed(null);
    setAnalyzing(true);
    try {
      const dataUrl: string = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => rej(new Error('No se pudo leer el archivo'));
        fr.readAsDataURL(file);
      });
      const base64 = dataUrl.split(',')[1] ?? '';
      const isImage = file.type.startsWith('image/');
      const input = isImage
        ? ({ kind: 'image', base64, mediaType: file.type } as const)
        : ({ kind: 'excel', base64 } as const);
      const r = await ingestRecipeAction(input);
      if (!r.ok) setError(r.error);
      else setReviewed(toReviewed(r.components));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error analizando el archivo');
    } finally {
      setAnalyzing(false);
    }
  }

  async function analyzeText() {
    if (!text.trim()) return;
    setError(null);
    setReviewed(null);
    setAnalyzing(true);
    try {
      const r = await ingestRecipeAction({ kind: 'text', text: text.trim() });
      if (!r.ok) setError(r.error);
      else setReviewed(toReviewed(r.components));
    } catch {
      setError('No se pudo analizar el texto. Intenta de nuevo.');
    } finally {
      // analyzeFile ya lo hacía; sin esto un rechazo dejaba "Analizar" deshabilitado para siempre.
      setAnalyzing(false);
    }
  }

  function applyReviewed() {
    if (!reviewed) return;
    setRows((rs) => {
      // Copia por elemento: mutar `existing.qty` sobre el spread superficial modificaba los
      // objetos de la instantánea anterior de `rows`.
      const next = rs.map((r) => ({ ...r }));
      for (const rv of reviewed) {
        if (!rv.componentId) continue;
        const existing = next.find((r) => r.componentId === rv.componentId);
        if (existing) existing.qty = rv.qty;
        else next.push({ componentId: rv.componentId, qty: rv.qty });
      }
      return next;
    });
    setReviewed(null);
    setText('');
  }

  const selCls =
    'rounded-md border border-line bg-surface px-2 py-1 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

  if (!loaded) return <p className="px-1 py-2 text-xs text-fg-faint">Cargando receta…</p>;

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
      <p className="text-xs text-fg-muted">
        Al facturar este servicio se descuentan del inventario los componentes con control de stock.
      </p>

      {/* Filas de la receta */}
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-fg-faint">Sin componentes todavía.</p>}
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={r.componentId}
              onChange={(e) => setRow(i, { componentId: e.target.value })}
              className={`${selCls} flex-1`}
            >
              {components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              step="0.25"
              value={r.qty}
              onChange={(e) => setRow(i, { qty: Number(e.target.value) })}
              className={`${selCls} w-24 text-right`}
            />
            <span className="w-16 text-xs text-fg-faint">{unit(r.componentId)}</span>
            <button type="button" onClick={() => removeRow(i)} className="text-fg-faint hover:text-warn" aria-label="Quitar">
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg transition"
        >
          <Plus className="size-3.5" aria-hidden />
          Agregar componente
        </button>
      </div>

      {/* Importar con IA */}
      <details className="rounded-lg border border-line bg-surface p-3">
        <summary className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
          <Sparkles className="size-4 text-brand" aria-hidden />
          Importar receta (foto o texto) — la IA propone, tú confirmas
        </summary>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg transition">
              <Upload className="size-4" aria-hidden />
              Foto de la receta
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && analyzeFile(e.target.files[0])}
              />
            </label>
            {analyzing && <span className="text-xs text-fg-faint">Analizando…</span>}
          </div>
          <div className="flex items-start gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              placeholder="…o escribe la receta: 2 gasas, 1 sutura 3-0, 0.5 ml ketamina"
              className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <button
              type="button"
              onClick={analyzeText}
              disabled={analyzing || !text.trim()}
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg transition disabled:opacity-60"
            >
              <FileText className="size-4" aria-hidden />
              Analizar
            </button>
          </div>

          {reviewed && (
            <div className="space-y-2 rounded-lg border border-brand/40 bg-surface p-3">
              <p className="text-xs font-medium text-fg">
                Borrador propuesto — revisa el emparejamiento y confirma:
              </p>
              {reviewed.map((rv, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-40 shrink-0 truncate text-xs text-fg-muted" title={rv.name}>
                    {rv.name}
                    {rv.unit ? ` · ${rv.unit}` : ''}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.25"
                    value={rv.qty}
                    onChange={(e) =>
                      setReviewed((rs) => rs2(rs, i, { qty: Number(e.target.value) }))
                    }
                    className={`${selCls} w-20 text-right`}
                  />
                  <select
                    value={rv.componentId ?? ''}
                    onChange={(e) =>
                      setReviewed((rs) => rs2(rs, i, { componentId: e.target.value || null }))
                    }
                    className={`${selCls} flex-1 ${rv.componentId ? '' : 'border-warn text-warn'}`}
                  >
                    <option value="">Sin asignar…</option>
                    {components.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <button
                type="button"
                onClick={applyReviewed}
                className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-on-brand hover:bg-brand-deep transition"
              >
                <Check className="size-3.5" aria-hidden />
                Agregar a la receta
              </button>
            </div>
          )}
        </div>
      </details>

      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-warn bg-surface px-3 py-2 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      {okMsg && <p className="text-sm text-ok">{okMsg}</p>}

      <button
        type="button"
        onClick={save}
        disabled={isPending}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
      >
        {isPending ? 'Guardando…' : 'Guardar receta'}
      </button>
    </div>
  );
}

function rs2(list: Reviewed[] | null, i: number, patch: Partial<Reviewed>): Reviewed[] | null {
  if (!list) return list;
  return list.map((r, j) => (j === i ? { ...r, ...patch } : r));
}

/** ResolvedComponent (matchId) → Reviewed (componentId editable por el vet). */
function toReviewed(
  comps: { name: string; qty: number; unit?: string | null; matchId: string | null; score: number }[],
): Reviewed[] {
  return comps.map((c) => ({
    name: c.name,
    qty: c.qty,
    unit: c.unit ?? null,
    componentId: c.matchId,
    score: c.score,
  }));
}
