"use client"

import Link from "next/link"
import { Target } from "lucide-react"
import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts"

import { formatCOP } from "@/lib/facturacion/format"
import { cumplimiento, type DiaDelMes } from "@/lib/tablero/cumplimiento"

// El anillo de cumplimiento — «Cumplimiento de ventas» de la captura de OkVet (David, 25-ago).
//
// ── QUÉ AGREGA SOBRE LO QUE YA HABÍA ───────────────────────────────────────────────────────────
//
// El tablero ya tenía la pastilla con el total del mes y su insignia de variación. Eso contesta
// «¿voy mejor que el mes pasado?»; esto contesta «¿voy a llegar?», que es otra pregunta. Una
// clínica puede ir +30% contra un mes malo y quedar lejísimos de la meta — con sólo la insignia,
// eso se lee como buena noticia.
//
// ── LAS DECISIONES DE FORMA ────────────────────────────────────────────────────────────────────
//
// · ANILLO Y NO BARRA: el porcentaje contra un tope conocido tiene un final visible —la vuelta
//   completa— y eso es justo lo que una barra sin marca no muestra. Además cierra la familia con
//   las dos donas del tablero en vez de meter una cuarta forma.
// · ARRANCA ARRIBA Y VA EN SENTIDO HORARIO: es como se lee un reloj, y el mes es tiempo.
// · LA MARCA DEL RITMO es la mitad del bloque. Un anillo al 40% no dice nada solo: al 40% el día
//   12 va sobrando y al 40% el día 28 no llega. La marca dice dónde DEBERÍA ir el arco hoy, así
//   que la lectura es la distancia entre el arco y la marca — no el número suelto.
// · EL COLOR NO ES LA ÚNICA SEÑAL: el texto de abajo dice en palabras si va en ritmo o no. Con
//   daltonismo el ámbar y la marca de la casa se parecen; la frase no.
// · TOKENS Y NUNCA HEX (los pone `cumplimiento()`): la app tiene tema claro y oscuro.

// El carril por donde corre el anillo: es una LÍNEA, no texto.
//
// Estaba escrito `var(--color-bg-subtle, var(--muted))`, y las dos mitades estaban mal.
// `--color-bg-subtle` no existe en ningún lado del repo —cero apariciones en el CSS— así que
// ganaba siempre el respaldo; y `--muted` es el color de TEXTO tenue (#5d706a, calibrado a 5.26:1
// de contraste sobre blanco). O sea que el carril se pintaba de un gris de texto y competía con el
// dato que tenía que enmarcar. `--border` es lo que corresponde: se ve, y se retira.
const CARRIL_DEL_ANILLO = { fill: "var(--border)" }

export function CumplimientoDeVentas({
  vendidoCents,
  metaCents,
  hoy,
  puedeEditar,
}: {
  vendidoCents: number
  metaCents: number | null
  hoy: DiaDelMes
  puedeEditar: boolean
}) {
  const c = cumplimiento(vendidoCents, metaCents, hoy)

  return (
    <div className="flex h-full flex-col rounded-xl border border-line-soft bg-panel p-4">
      <div className="mb-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Target aria-hidden className="size-4" style={{ color: "var(--color-brand)" }} />
          Cumplimiento de ventas
        </div>
        <div className="text-xs text-muted-foreground">
          Lo vendido este mes contra la meta que se puso la clínica.
        </div>
      </div>

      {/* SIN META NO SE INVENTA UN CERO. El bloque existe igual —la personalización lo lista— pero
          dice qué falta para que sirva, en vez de pintar un anillo vacío que parece un bug. El
          enlace sólo se le ofrece a quien puede guardarlo: la policy `clinics_update` exige admin,
          así que mandar a un vet a Configuración sería mandarlo a un rechazo de la base. */}
      {!c ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            Todavía no hay una meta de ventas para este mes.
          </p>
          {puedeEditar && (
            <Link
              href="/dashboard/facturacion/configuracion"
              className="text-xs text-primary hover:underline"
            >
              Ponerle una meta
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <div className="relative h-[170px] w-[170px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              {/* `PolarAngleAxis` con dominio 0–100 es lo que hace que el arco sea un PORCENTAJE y
                  no una proporción del máximo de la serie: sin él, un único dato pinta la vuelta
                  entera siempre, y el anillo diría 100% con cualquier venta. */}
              <RadialBarChart
                innerRadius="72%"
                outerRadius="100%"
                data={[{ valor: c.pctDeArco }]}
                startAngle={90}
                endAngle={-270}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                <RadialBar
                  dataKey="valor"
                  angleAxisId={0}
                  cornerRadius={999}
                  fill={c.color}
                  background={CARRIL_DEL_ANILLO}
                  isAnimationActive={false}
                />
              </RadialBarChart>
            </ResponsiveContainer>

            {/* LA MARCA DEL RITMO, encima del anillo. Va como una línea rotada y no como una serie
                más del gráfico: recharts pintaría una segunda serie como otro anillo concéntrico, y
                lo que hace falta es un punto SOBRE el mismo arco para poder compararlos.
                `ritmoPct * 3.6` son los grados de la vuelta; arranca arriba, igual que el arco. */}
            {c.ritmoPct != null && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{ transform: `rotate(${c.ritmoPct * 3.6}deg)` }}
              >
                <div className="mx-auto h-[15%] w-0.5 rounded-full bg-foreground/45" />
              </div>
            )}

            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-semibold tabular-nums" style={{ color: c.color }}>
                {c.pct}%
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {formatCOP(vendidoCents)}
              </span>
            </div>
          </div>

          {/* EL TEXTO NO REPITE EL ANILLO: dice lo que el anillo no puede: cuánta plata falta, y si
              eso está bien o mal para el día del mes en que estamos. */}
          <div className="space-y-0.5 text-center">
            <p className="text-xs text-muted-foreground">
              Meta del mes:{" "}
              <span className="font-mono tabular-nums">{formatCOP(metaCents ?? 0)}</span>
            </p>
            <p className="text-xs font-medium">
              {c.cumplida ? (
                <span style={{ color: "var(--color-ok)" }}>Meta cumplida</span>
              ) : (
                <>
                  Faltan <span className="font-mono tabular-nums">{formatCOP(c.faltanCents)}</span>
                </>
              )}
            </p>
            {c.ritmoPct != null && !c.cumplida && (
              <p className="text-xs text-muted-foreground">
                Va corrido el {c.ritmoPct}% del mes —{" "}
                {c.enRitmo ? "vas en ritmo" : "vas por debajo del ritmo"}.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
