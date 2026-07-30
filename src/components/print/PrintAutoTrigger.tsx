/**
 * Componente cliente que:
 *   1. Dispara el diálogo nativo de impresión cuando la página termina de
 *      cargar (delay corto para que el browser termine de pintar antes —
 *      sin esto, algunos browsers abren el diálogo sobre un layout a medio
 *      renderizar y el PDF sale roto).
 *   2. Renderiza la toolbar de instrucciones + el botón manual "Imprimir /
 *      Guardar PDF" para reintentar si el vet cerró el diálogo automático.
 *
 * Ambas cosas viven acá juntas porque las dos requieren `window` / event
 * handler, y la print page (server component) no puede tener onClick
 * directo en sus botones.
 */
'use client';

import { useEffect } from 'react';

export function PrintAutoTrigger() {
  useEffect(() => {
    const id = setTimeout(() => {
      window.print();
    }, 350);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="print-toolbar no-print">
      <button
        type="button"
        onClick={() => window.print()}
        className="print-button"
      >
        Imprimir / Guardar PDF
      </button>
      <p className="print-toolbar-help">
        Se abrió el diálogo de impresión. Elegí <strong>&quot;Guardar como
        PDF&quot;</strong> como destino para descargar.
      </p>
    </div>
  );
}
