'use client';

// El texto de los recordatorios de cobranza, escrito por la clínica.
//
// ── QUÉ ES ESTA PANTALLA ──────────────────────────────────────────────────────────────────────
//
// Pedido del cliente (24-ago): «plantillas de WhatsApp predeterminadas configurables por
// veterinario (no genéricas para todos)». Hasta hoy el texto estaba escrito a mano en el código y
// todas las clínicas mandaban el mismo mensaje.
//
// ── POR QUÉ LA VISTA PREVIA NO ES UN ADORNO ───────────────────────────────────────────────────
//
// Lo que se edita tiene huecos —`{number}`, `{balance}`, `{link}`— y lo que el titular recibe es
// otra cosa: el texto con los huecos llenos. Sin ver el resultado, es fácil escribir algo que se
// lee bien con las llaves y se lee mal sin ellas («Su factura {number} de {balance}» → «Su factura
// SETP-1024 de $ 120.000», bien; pero «Su {number} vencida» → «Su SETP-1024 vencida», no).
//
// Es también donde se nota lo que ninguna validación puede decir: si el mensaje suena a la clínica.
//
// ── EL ERROR SE MUESTRA ANTES DE GUARDAR ──────────────────────────────────────────────────────
//
// La revisión (`revisarPlantilla`) es la MISMA función que corre en el servidor. Acá sirve para que
// el vet vea el problema mientras escribe, no después de perder el intento; allá es la que manda,
// porque un formulario se puede saltar.

import { useMemo, useState, useTransition } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';

import { guardarPlantillasDeRecordatorio } from '@/lib/cartera/actions';
import {
  LARGO_MAXIMO,
  NOMBRE_DEL_PASO,
  PLANTILLAS_POR_DEFECTO,
  leerPlantillas,
  llenarPlantilla,
  revisarPlantilla,
} from '@/lib/cartera/plantillas';
import { REMINDER_STEP_KINDS, type ReminderStepKind } from '@/lib/supabase/facturacion-enums';

/** Valores de muestra para la vista previa. No salen de ninguna factura real. */
const MUESTRA = {
  number: 'FV-1024',
  balance: '$ 120.000',
  link: 'https://tuvetia.co/f/9f3c…',
};

export function PlantillasDeRecordatorio({
  guardadas,
  canal,
}: {
  /** Lo que hay en `billing_settings.reminder_templates`, tal cual. */
  guardadas: unknown;
  /** Por dónde salen hoy los recordatorios, para nombrarlo bien en pantalla. */
  canal: 'WHATSAPP' | 'EMAIL';
}) {
  const [isPending, startTransition] = useTransition();
  const inicial = useMemo(() => leerPlantillas(guardadas), [guardadas]);
  const [textos, setTextos] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      REMINDER_STEP_KINDS.map((paso) => [paso, inicial[paso] ?? PLANTILLAS_POR_DEFECTO[paso]]),
    ),
  );

  function guardar() {
    startTransition(async () => {
      // La guarda que devuelve los botones (28-ago): si esta promesa RECHAZA —sesión vencida,
      // red caída, o un id de Server Action viejo tras un deploy— React nunca cierra la
      // transición e `isPending` deja los botones deshabilitados hasta recargar.
      try {
        const r = await guardarPlantillasDeRecordatorio({ plantillas: textos });
        if (r.ok) toast.success('Listo, los recordatorios saldrán con tu texto.');
        else toast.error(r.error);
    
      } catch (e) {
        toast.error(`No se pudo completar la acción: ${(e as Error)?.message ?? e}`)
      }
    });
  }

  return (
    <section className="mt-8 rounded-xl border border-line bg-surface p-5">
      <header className="mb-1">
        <h2 className="text-base font-semibold text-fg">Texto de los recordatorios</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Lo que se le escribe al titular por {canal === 'WHATSAPP' ? 'WhatsApp' : 'correo'} en cada
          paso de la cobranza. Si dejás un campo en blanco, vuelve al texto por defecto.
        </p>
      </header>

      <p className="mb-5 mt-3 text-xs text-fg-faint">
        Podés usar{' '}
        <code className="rounded bg-surface-2 px-1">{'{number}'}</code> (número de la factura),{' '}
        <code className="rounded bg-surface-2 px-1">{'{balance}'}</code> (saldo) y{' '}
        <code className="rounded bg-surface-2 px-1">{'{link}'}</code> (enlace para pagar).{' '}
        <strong className="text-fg-muted">{'{number}'} y {'{link}'} son obligatorios</strong>: sin
        ellos el mensaje sale, pero el titular no sabe de qué factura le hablan ni por dónde pagar.
      </p>

      <div className="space-y-5">
        {REMINDER_STEP_KINDS.map((paso: ReminderStepKind) => {
          const valor = textos[paso] ?? '';
          const problema = valor.trim() ? revisarPlantilla(valor) : null;
          const esElDePorDefecto = valor.trim() === PLANTILLAS_POR_DEFECTO[paso];
          return (
            <div key={paso}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <label htmlFor={`plantilla-${paso}`} className="text-sm font-medium text-fg">
                  {NOMBRE_DEL_PASO[paso]}
                </label>
                {!esElDePorDefecto && (
                  <button
                    type="button"
                    onClick={() =>
                      setTextos((t) => ({ ...t, [paso]: PLANTILLAS_POR_DEFECTO[paso] }))
                    }
                    className="inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
                  >
                    <RotateCcw className="size-3" aria-hidden />
                    Volver al texto por defecto
                  </button>
                )}
              </div>
              <textarea
                id={`plantilla-${paso}`}
                value={valor}
                onChange={(e) => setTextos((t) => ({ ...t, [paso]: e.target.value }))}
                rows={2}
                maxLength={LARGO_MAXIMO}
                aria-invalid={problema ? true : undefined}
                className={`w-full rounded-lg border bg-surface px-3 py-2 text-sm text-fg outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                  problema ? 'border-warn' : 'border-line focus-visible:border-ring'
                }`}
              />
              {problema ? (
                <p className="mt-1 text-xs text-warn">{problema}</p>
              ) : (
                // LO QUE VA A RECIBIR EL TITULAR, no lo que está escrito. Es la única forma de ver
                // si el mensaje se lee bien una vez llenos los huecos.
                <p className="mt-1 text-xs text-fg-faint">
                  <span className="font-medium">Se verá así:</span>{' '}
                  {valor.trim()
                    ? llenarPlantilla(valor, MUESTRA)
                    : llenarPlantilla(PLANTILLAS_POR_DEFECTO[paso], MUESTRA)}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={guardar}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
        >
          <Save className="size-4" aria-hidden />
          {isPending ? 'Guardando…' : 'Guardar textos'}
        </button>
        <span className="text-xs text-fg-faint">
          Aplica a los recordatorios que salgan desde ahora; los ya enviados no cambian.
        </span>
      </div>
    </section>
  );
}
