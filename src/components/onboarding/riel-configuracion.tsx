"use client"

// "Configuración de la clínica — 50%", con los pasos que faltan y a dónde ir.
//
// SE COLAPSA, NO SE DESCARTA. El checklist anterior se cerraba con una X que escribía en
// `localStorage` y no volvía nunca — así que el vet que lo cerraba el primer día perdía para
// siempre el único lugar que le decía que su clínica estaba a medio configurar. Acá el estado
// plegado también se recuerda, pero el encabezado con el porcentaje SIEMPRE queda visible: se puede
// dejar de mirar el detalle, no dejar de saber.
//
// Y desaparece solo al llegar al 100%. Nadie tiene que cerrarlo.
//
// ── DEL TAMAÑO DEL CHAT, que es lo que pidió David el 17-ago ────────────────────────────────────
//
//     "ampliaría lo que dice Configura tu clínica y lo haría más grande"
//
// Estaba al revés de como se ve un bloque importante: ocupaba TODO el ancho de la pantalla —más
// que la conversación, que está acotada a 780px— pero con letra de 14 y 12, una barra de 6px de
// alto y el porcentaje del mismo cuerpo que el título. Ancho y flaco: leía como un pie de página
// estirado, no como la única cosa que le dice al vet que su clínica está a medio armar.
//
// Ahora comparte columna con el chat y con el compositor. Que las tres cosas empiecen y terminen
// en la misma línea es lo que las vuelve piezas de una pantalla en vez de tres bloques sueltos —
// y de paso el porcentaje deja de estar a un metro de su propia etiqueta en un monitor ancho.

import { useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { Check, ChevronDown, Circle } from "lucide-react"

import type { Progreso } from "@/lib/onboarding/progreso"

const CLAVE_PLEGADO = "tuvetia_riel_plegado"

const noopSubscribe = () => () => {}
const leerPlegado = () =>
  typeof window !== "undefined" && localStorage.getItem(CLAVE_PLEGADO) === "1"

export function RielConfiguracion({ progreso }: { progreso: Progreso }) {
  const plegadoGuardado = useSyncExternalStore(noopSubscribe, leerPlegado, () => false)
  const [plegadoLocal, setPlegadoLocal] = useState<boolean | null>(null)
  const plegado = plegadoLocal ?? plegadoGuardado

  // Una clínica configurada no necesita que se lo recuerden.
  if (progreso.completo) return null

  function alternar() {
    const siguiente = !plegado
    setPlegadoLocal(siguiente)
    try {
      localStorage.setItem(CLAVE_PLEGADO, siguiente ? "1" : "0")
    } catch {
      // Modo incógnito o storage lleno: se pierde la preferencia, no el riel.
    }
  }

  return (
    // `mx-auto max-w-[780px]`: la MISMA columna que el hilo y el compositor de Athos. Antes era
    // `mx-4 lg:mx-6`, que además se sumaba al padding de la pantalla — o sea que el riel quedaba
    // más indentado que todo lo demás, y encima más ancho.
    <section className="mx-auto w-full max-w-[780px] rounded-xl border border-line-soft bg-card">
      <button
        type="button"
        onClick={alternar}
        aria-expanded={!plegado}
        className="flex w-full items-center gap-3 rounded-xl px-5 py-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-semibold">Configuración de la clínica</h2>
            {/* EL PORCENTAJE ES EL DATO, no una nota al pie: es lo único que se lee de un vistazo
                con el riel plegado, y estaba del mismo cuerpo que el título. */}
            <span className="shrink-0 font-mono text-[17px] font-semibold tabular-nums text-brand-text">
              {progreso.porcentaje}%
            </span>
          </div>

          {/* La barra. `role="progressbar"` porque un div de color no le dice nada a un lector de
              pantalla, y el porcentaje de al lado es texto suelto sin relación semántica. */}
          <div
            role="progressbar"
            aria-valuenow={progreso.porcentaje}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Configuración de la clínica: ${progreso.hechos} de ${progreso.total} pasos`}
            className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-brand-soft"
          >
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500"
              style={{ width: `${progreso.porcentaje}%` }}
            />
          </div>

          {/* Plegado, el encabezado tiene que seguir diciendo qué sigue: si no, es sólo un número. */}
          {plegado && progreso.siguiente && (
            <p className="mt-2 text-[13px] text-fg-muted">
              Sigue: <span className="font-medium text-fg">{progreso.siguiente.titulo}</span>
            </p>
          )}
        </div>

        <ChevronDown
          aria-hidden
          className={`size-4 shrink-0 text-fg-faint transition-transform ${plegado ? "" : "rotate-180"}`}
        />
        <span className="sr-only">{plegado ? "Mostrar los pasos" : "Ocultar los pasos"}</span>
      </button>

      {!plegado && (
        <ul className="flex flex-col gap-0.5 border-t border-line-soft p-3">
          {progreso.pasos.map((paso) => (
            <li key={paso.id}>
              {paso.hecho ? (
                // Hecho: NO es un enlace. Que siga siendo clicable invita a volver a una pantalla
                // que ya no tiene nada que pedirle al vet.
                <div className="flex items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-sm">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
                  <span className="text-fg-muted line-through">{paso.titulo}</span>
                </div>
              ) : (
                <Link
                  href={paso.href}
                  className="flex items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-sm hover:bg-brand-soft"
                >
                  <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-faint" />
                  <span className="min-w-0">
                    <span className="font-medium">{paso.titulo}</span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-fg-muted">{paso.porQue}</span>
                  </span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
