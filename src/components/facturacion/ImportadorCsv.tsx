'use client';

// El wizard de importación de inventario, por CSV.
//
// POR QUÉ SÓLO CSV, Y POR QUÉ AHORA. El motor de importación —parsear, proponer el mapeo, validar,
// confirmar, revertir— estaba portado y probado desde hace semanas, pero no había una sola pantalla
// que lo usara: `/inventario/importar` era una página que explicaba por qué no se podía importar.
// La causa era `xlsx@0.18.5` (prototype pollution + ReDoS, sin fix en npm), y la guarda bloqueaba
// la action ENTERA.
//
// Pero el camino del CSV nunca tocó xlsx: es Papaparse. Se estaba bloqueando un parser sano para
// tapar a otro. Con la guarda acotada a `.xlsx`/`.xls`, "Guardar como → CSV" en Excel —un paso que
// cualquier clínica sabe dar— vuelve a ser un camino de importación completo.
//
// ── LOS TRES PASOS, Y POR QUÉ NO SON DOS ────────────────────────────────────────────────────────
//
// Subir → REVISAR EL MAPEO → confirmar. El del medio es el que parece de más y es el único que
// evita el desastre: la heurística de columnas acierta casi siempre, y "casi siempre" sobre una
// lista de precios significa que un día el precio entra en la columna del costo y nadie lo nota
// hasta que factura. Que el vet VEA qué columna va a qué campo, y pueda cambiarlo, es la
// diferencia entre una herramienta y una ruleta.
//
// NADA SE ESCRIBE HASTA CONFIRMAR. El preview vive en `import_batches` con status PREVIEW; los
// ítems se crean recién en `commitImport`, y una importación confirmada se puede revertir entera
// desde el inventario mientras nada dependa de ella.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, UploadCloud } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  createImportPreview,
  commitImport,
  updateImportMapping,
} from '@/lib/facturacion/import/actions';
import {
  FIELD_LABELS,
  IMPORT_FIELDS,
  type ImportField,
  type ImportMapping,
  type ImportPreset,
  type ImportReport,
  type RowStatus,
  type ValidatedRow,
} from '@/lib/facturacion/import/fields';

const inputCls =
  'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
const labelCls = 'block text-xs font-medium text-fg-muted';

const TONO: Record<RowStatus, string> = {
  OK: 'text-ok',
  AVISO: 'text-warn',
  DUPLICADO: 'text-warn',
  ERROR: 'text-danger',
};

type Preview = {
  batchId: string;
  fileName: string;
  columns: string[];
  mapping: ImportMapping;
  validated: ValidatedRow[];
  report: ImportReport;
};

export function ImportadorCsv() {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [creadas, setCreadas] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, arrancar] = useTransition();

  function subir(formData: FormData) {
    setError(null);
    arrancar(async () => {
      const r = await createImportPreview(formData);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setPreview({
        batchId: r.batchId,
        fileName: r.fileName,
        columns: r.columns,
        mapping: r.mapping,
        validated: r.validated,
        report: r.report,
      });
    });
  }

  // CAMBIAR UNA COLUMNA REVALIDA TODO EL ARCHIVO, en el servidor y contra el catálogo real. Validar
  // en el navegador con lo que ya se trajo sería más rápido y estaría mal: la detección de
  // duplicados necesita los nombres que hoy existen en la clínica, y ésos cambian mientras el vet
  // mira la pantalla.
  function cambiarMapeo(columna: string, campo: ImportField | '') {
    if (!preview) return;
    const mapping: ImportMapping = { ...preview.mapping, [columna]: campo };
    setPreview({ ...preview, mapping });
    setError(null);
    arrancar(async () => {
      const r = await updateImportMapping({ batchId: preview.batchId, mapping });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setPreview((p) => (p ? { ...p, mapping, validated: r.validated, report: r.report } : p));
    });
  }

  function confirmar() {
    if (!preview) return;
    setError(null);
    arrancar(async () => {
      const r = await commitImport({ batchId: preview.batchId });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCreadas(r.created);
      setPreview(null);
      router.refresh();
    });
  }

  if (creadas !== null) {
    return (
      <div className="rounded-lg border border-line-soft bg-card p-8">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="size-5 text-ok" aria-hidden />
          <div>
            <h2 className="text-lg font-medium text-fg">
              {creadas === 1 ? 'Se importó 1 ítem' : `Se importaron ${creadas} ítems`}
            </h2>
            {/* Que se pueda deshacer se dice ACÁ y no en un doc: es el momento en que la duda
                aparece, y saber que hay vuelta atrás es lo que permite animarse a importar. */}
            <p className="text-sm text-fg-faint">
              Podés revertir esta importación desde el inventario mientras nada dependa de ella.
            </p>
          </div>
        </div>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button onClick={() => setCreadas(null)}>Importar otro archivo</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {!preview && (
        <form action={subir} className="rounded-lg border border-line-soft bg-card p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg bg-secondary">
              <FileSpreadsheet className="size-5 text-fg" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-medium text-fg">Subí la planilla en CSV</h2>
              {/* SE DICE CÓMO, no sólo qué formato. "Sólo CSV" a secas manda al vet a buscar en
                  Google; el paso concreto en Excel es lo que hace que el límite no sea un muro. */}
              <p className="text-sm text-fg-faint">
                Si la tenés en Excel: <b>Archivo → Guardar como → CSV</b>. Hasta 2 MB y 1000 filas.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="archivo">
                Archivo
              </label>
              <input
                id="archivo"
                type="file"
                name="file"
                accept=".csv,text/csv"
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="preset">
                Qué estás cargando
              </label>
              {/* El preset cambia la validación, no el pipeline: 'servicios' fuerza el tipo, ignora
                  las existencias y lee la duración en minutos. Sin esto, importar una lista de
                  servicios daba un aviso de "falta la unidad" en cada fila. */}
              <select id="preset" name="preset" defaultValue="productos" className={inputCls}>
                <option value="productos">Productos e insumos</option>
                <option value="servicios">Servicios</option>
              </select>
            </div>
          </div>

          <div className="mt-6">
            <Button type="submit" disabled={pendiente}>
              {pendiente ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UploadCloud className="size-4" aria-hidden />}
              Leer el archivo
            </Button>
          </div>
        </form>
      )}

      {preview && (
        <>
          <Resumen report={preview.report} archivo={preview.fileName} />

          <section className="rounded-lg border border-line-soft bg-card p-6">
            <h2 className="text-sm font-semibold text-fg">Qué columna es cada cosa</h2>
            <p className="mt-1 text-[13px] text-fg-muted">
              Lo proponemos por el nombre del encabezado. Revisalo — sobre todo <b>Precio</b> y{' '}
              <b>Costo</b>, que son los que más se parecen entre sí.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {preview.columns.map((col) => (
                <div key={col}>
                  <label className={labelCls} htmlFor={`map-${col}`}>
                    {col}
                  </label>
                  <select
                    id={`map-${col}`}
                    value={preview.mapping[col] ?? ''}
                    onChange={(e) => cambiarMapeo(col, e.target.value as ImportField | '')}
                    disabled={pendiente}
                    className={inputCls}
                  >
                    <option value="">— No importar —</option>
                    {IMPORT_FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {FIELD_LABELS[f]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </section>

          <TablaDeFilas filas={preview.validated} />

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={confirmar} disabled={pendiente || preview.report.ready + preview.report.withWarnings === 0}>
              {pendiente && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Importar {preview.report.ready + preview.report.withWarnings} filas
            </Button>
            <Button variant="outline" onClick={() => setPreview(null)} disabled={pendiente}>
              Cancelar
            </Button>
            {/* Se dice EN EL BOTÓN de al lado qué queda afuera, no después de confirmar: descubrir
                que se perdieron doce filas cuando ya se importó es cuando menos sirve saberlo. */}
            {preview.report.errors + preview.report.duplicates > 0 && (
              <span className="text-[13px] text-fg-muted">
                {preview.report.errors > 0 && `${preview.report.errors} con error`}
                {preview.report.errors > 0 && preview.report.duplicates > 0 && ' y '}
                {preview.report.duplicates > 0 && `${preview.report.duplicates} duplicadas`} no se
                importan.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Resumen({ report, archivo }: { report: ImportReport; archivo: string }) {
  const dato = (n: number, etiqueta: string, tono?: string) => (
    <div>
      <p className={`text-lg font-semibold ${tono ?? 'text-fg'}`}>{n}</p>
      <p className="text-[11px] uppercase tracking-wider text-fg-faint">{etiqueta}</p>
    </div>
  );
  return (
    <section className="rounded-lg border border-line-soft bg-card p-6">
      <p className="text-sm text-fg-muted">
        <b className="text-fg">{archivo}</b>
      </p>
      <div className="mt-4 flex flex-wrap gap-8">
        {dato(report.total, 'filas leídas')}
        {dato(report.ready, 'listas', 'text-ok')}
        {dato(report.withWarnings, 'con aviso', report.withWarnings ? 'text-warn' : undefined)}
        {dato(report.duplicates, 'duplicadas', report.duplicates ? 'text-warn' : undefined)}
        {dato(report.errors, 'con error', report.errors ? 'text-danger' : undefined)}
      </div>
    </section>
  );
}

/**
 * Las filas, como van a quedar.
 *
 * SE MUESTRAN TODAS Y NO SÓLO LAS QUE FALLAN. Ver el archivo entero interpretado es lo que permite
 * cazar el error que NO da error: un precio que entró en la columna del costo valida perfecto y
 * está mal. Los mensajes de cada fila van al lado, en su fila, y no juntos en una lista arriba.
 */
function TablaDeFilas({ filas }: { filas: ValidatedRow[] }) {
  if (filas.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-lg border border-line-soft bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-[11px] uppercase tracking-wider text-fg-faint">
            <tr>
              <th className="px-5 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Nombre</th>
              <th className="px-3 py-2 text-right font-medium">Precio</th>
              <th className="px-3 py-2 text-right font-medium">Costo</th>
              <th className="px-3 py-2 text-right font-medium">IVA</th>
              <th className="px-3 py-2 text-right font-medium">Existencia</th>
              <th className="px-5 py-2 font-medium">Observaciones</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.index} className="border-b border-line-soft last:border-0">
                <td className="px-5 py-2 text-fg-faint">{f.index + 1}</td>
                <td className={`px-3 py-2 font-medium ${TONO[f.status]}`}>{f.status}</td>
                <td className="px-3 py-2 text-fg">{f.parsed?.name ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-fg">
                  {f.parsed ? (f.parsed.priceCents / 100).toLocaleString('es-CO') : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                  {f.parsed ? (f.parsed.costCents / 100).toLocaleString('es-CO') : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                  {f.parsed ? `${f.parsed.taxRate}%` : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                  {f.parsed ? f.parsed.initialQty : '—'}
                </td>
                <td className="px-5 py-2 text-[13px] text-fg-muted">{f.messages.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
