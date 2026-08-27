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

import Link from 'next/link';
import { useEffect } from 'react';

export function PrintAutoTrigger({
  /**
   * A dónde se vuelve. SIN ESTO LA PANTALLA ES UN CALLEJÓN: estas rutas se abren con
   * `target="_blank"`, o sea pestaña nueva y sin historial, así que el «atrás» del navegador está
   * deshabilitado y no hay cabecera ni barra lateral alrededor del documento. La única salida era
   * cerrar la pestaña — y quien no cayera en eso se quedaba mirando una factura sin nada más.
   *
   * Es opcional para no obligar a quien la abra en la MISMA pestaña, donde el «atrás» sí funciona.
   */
  volverA,
  rotuloVolver = 'Volver',
}: {
  volverA?: string;
  rotuloVolver?: string;
} = {}) {
  useEffect(() => {
    const id = setTimeout(() => {
      window.print();
    }, 350);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="print-toolbar no-print">
      {volverA && (
        // Antes del botón de imprimir: el diálogo de impresión ya se abrió solo, así que quien
        // sigue mirando esta barra es justamente el que NO quería imprimir.
        <Link href={volverA} className="print-toolbar-volver">
          ← {rotuloVolver}
        </Link>
      )}
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
