"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Target } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { InputMoneda } from "@/components/ui/input-moneda";

/**
 * La meta de ventas del mes — contra qué se mide el anillo del tablero (0094).
 *
 * ── POR QUÉ ACÁ Y NO EN EL TABLERO ────────────────────────────────────────
 *
 * El tablero MUESTRA; lo que se configura vive donde ya se configura el resto
 * del módulo. Un campo de edición metido en un bloque de métricas obliga a
 * decidir quién lo ve —un vet no puede guardarlo— y a manejar ahí el rechazo.
 *
 * ── EN PESOS ARRIBA, EN CENTAVOS ABAJO ────────────────────────────────────
 *
 * `InputMoneda` trabaja en pesos porque es lo que la persona escribe; la
 * columna es `bigint` de centavos como todo el dinero de la app. La conversión
 * pasa una sola vez, acá, y no en cada lectura del tablero: el día que alguien
 * se olvide de multiplicar, la meta queda cien veces más chica y el anillo dice
 * 10.000% sin que nada falle.
 *
 * ── QUIÉN PUEDE GUARDARLA ─────────────────────────────────────────────────
 *
 * La policy `clinics_update` exige `private.my_role() = 'admin'`, así que a un
 * vet la base le rechaza el update igual. Acá se le muestra en lectura para que
 * vea contra qué se está midiendo, en vez de toparse con un error que no puede
 * resolver.
 */
export function MetaDeVentas({
  clinicId,
  initialMetaCents,
  isAdmin,
}: {
  clinicId: string;
  initialMetaCents: number | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [pesos, setPesos] = useState<number | null>(
    initialMetaCents == null ? null : Math.round(initialMetaCents / 100),
  );
  const [saving, setSaving] = useState(false);

  const enPesosGuardados = initialMetaCents == null ? null : Math.round(initialMetaCents / 100);
  const sinCambios = pesos === enPesosGuardados;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    // VACÍO GUARDA `null`, NO CERO. Son estados distintos para el tablero: sin
    // meta el anillo no se pinta —no hay nada que cumplir— y una meta en cero sí
    // se pinta. Guardar 0 al borrar el campo le dejaría a la clínica un anillo
    // cumplido al 100% desde el primer peso, que nadie pidió.
    const { error } = await supabase
      .from("clinics")
      .update({ meta_ventas_mensual_cents: pesos == null ? null : pesos * 100 })
      .eq("id", clinicId);
    setSaving(false);
    if (error) {
      toast.error(`No se pudo guardar: ${error.message}`);
      return;
    }
    toast.success(pesos == null ? "Meta quitada" : "Meta actualizada");
    router.refresh();
  }

  if (!isAdmin) {
    return (
      <section className="mt-6 rounded-xl border border-line bg-surface-1 p-5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <Target className="size-4" aria-hidden />
          Meta de ventas del mes
        </h2>
        <p className="mt-2 text-sm text-fg-muted">
          {enPesosGuardados == null
            ? "La clínica todavía no tiene meta de ventas, así que el tablero no muestra el anillo de cumplimiento. Pedile a un administrador que la cargue."
            : "El tablero mide el cumplimiento contra esta meta. Sólo un administrador puede cambiarla."}
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={guardar} className="mt-6 rounded-xl border border-line bg-surface-1 p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
        <Target className="size-4" aria-hidden />
        Meta de ventas del mes
      </h2>
      <p className="mt-1 text-sm text-fg-faint">
        Contra esto mide el anillo de cumplimiento del tablero, y también si vas en ritmo para el
        día del mes en que estás. Dejalo vacío para no tener meta.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <InputMoneda
          id="meta-ventas"
          aria-label="Meta de ventas del mes"
          value={pesos}
          onValueChange={setPesos}
          placeholder="20.000.000"
          className="max-w-[240px]"
        />
        <button
          type="submit"
          disabled={saving || sinCambios}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          Guardar meta
        </button>
      </div>
    </form>
  );
}
