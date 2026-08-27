"use client"

// El panel de la consulta en curso: cuelga del notch, no cubre la app.
//
// LO QUE CAMBIA RESPECTO DE ANTES, y sale del prototipo del cliente. El panel bajaba desde arriba
// ocupando hasta el 82% de la pantalla, con un velo detrás. O sea que mirar la transcripción tapaba
// justamente aquello sobre lo que se estaba trabajando — y "grabar no te saca de donde estás", que
// es la idea entera del Modo Fantasma, dejaba de cumplirse en el momento de mirarlo.
//
// Ahora son 540px colgando del notch. Cabe al lado de la agenda, de una ficha o de una factura, y el
// velo sólo atenúa: se sigue viendo qué hay debajo.
//
// EN PESTAÑAS Y NO EN TRES COLUMNAS. A lo ancho de la pantalla entraban transcripción, VetGPT y
// cuaderno a la vez; en 540px no. Y mirándolo de cerca tampoco hacía falta: son tres cosas que se
// consultan de a una, y la que importa queda primero.
//
// POR QUÉ ESTO NO TOCA EL GRABADOR. `consultation-recorder.tsx` sigue siendo el único que pide el
// micrófono, el consentimiento y llama a `iniciar()`. Este panel sólo OBSERVA `consultaViva`,
// exactamente como el notch. Es lo que habilita sacar el estado del árbol de React: un segundo
// observador no cuesta nada y no puede romper al primero.
//
// LO QUE NO HACE, Y ES A PROPÓSITO. El prototipo muestra la transcripción SEPARADA POR HABLANTE
// ("Titular" / "Veterinaria"). No se puede hacer honestamente hoy: `athos-live.ts` entrega dos
// cadenas planas —estable y provisional— sin roles, e inventar etiquetas de hablante sería adivinar
// quién dijo qué en una historia clínica.

import { useState } from "react"
import Link from "next/link"

import { AthosEnVivo } from "@/components/athos/athos-en-vivo"
import { CasosParecidos } from "@/components/athos/casos-parecidos"
import { Cuaderno } from "@/components/athos/cuaderno"
import { useConsultaViva } from "@/lib/consulta-viva/usar"
import type { InteligenciaViva } from "@/lib/consulta-viva/usar-inteligencia-viva"

/**
 * Las cinco pestañas del prototipo, en su orden.
 *
 * Eran tres —VetGPT, Mis notas, Transcripción— y el cliente pidió las suyas: "sugerencias, casos
 * parecidos, etc., eso también debe estar". No es una lista más larga por gusto; separa cosas que
 * estaban amontonadas:
 *
 *   · TRANSCRIPCIÓN — lo que se está diciendo, crudo.
 *   · NOTAS EN VIVO — lo que VetGPT va ordenando de eso.
 *   · CASOS PARECIDOS — la memoria de la propia clínica: "esto ya lo viste en marzo".
 *   · SUGERENCIAS   — qué preguntar y qué no dejar pasar, con literatura detrás.
 *   · MIS NOTAS     — la hoja en blanco del vet.
 *
 * Antes "VetGPT" mezclaba live notes y sugerencias en una sola pestaña, que son dos cosas con
 * cadencias, costos y grados de certeza distintos.
 */
const PESTANAS = [
  { id: "transcripcion", rotulo: "Transcripción" },
  { id: "notas", rotulo: "Notas en vivo" },
  { id: "casos", rotulo: "Casos parecidos" },
  { id: "sugerencias", rotulo: "Sugerencias" },
  { id: "cuaderno", rotulo: "Mis notas" },
] as const

type Pestana = (typeof PESTANAS)[number]["id"]

// OSCURO EN LOS DOS TEMAS, igual que el notch, con la clase `.consulta` que el sistema ya tiene:
// declara la paleta oscura completa —en nuestro menta, no en el azul del prototipo— sobre cualquier
// subárbol. Así el panel no lleva un solo color crudo y sus hijos, que están escritos con tokens
// semánticos, se resuelven solos.

export function PanelModoFantasma({
  vivo,
  abierto,
  alCerrar,
}: {
  /** Lo trae `NotchDeConsulta`: el gancho vive allá para que las notas sobrevivan al contraer. */
  vivo: InteligenciaViva & { vistoLaAlerta: () => void }
  abierto: boolean
  alCerrar: () => void
}) {
  const estado = useConsultaViva()
  const [pestana, setPestana] = useState<Pestana>("transcripcion")


  if (!abierto || estado.fase === "inactiva") return null

  const fallo = estado.fase === "perdida"

  return (
    <>
      {/* ── SIN VELO, Y ES LA SEGUNDA VEZ QUE EL CLIENTE LO PIDE ──────────────────────────────
          Acá había un botón `fixed inset-0 bg-black/20`: un gris sobre LA PANTALLA ENTERA que
          además interceptaba todos los clics. David lo señaló el 26-ago por la mañana
          («quitarlo de fondo» — se interpretó otra cosa) y de nuevo por la noche, con captura:
          el contorno gris del panel.

          El velo contradecía las dos promesas de este mismo archivo: «cuelga del notch, NO cubre
          la app» y «grabar no te saca de donde estás» — con el fondo atenuado y los clics
          bloqueados, sí te sacaba. Un panel que atenúa lo de atrás es un modal con otro nombre.

          El cierre por clic afuera no se pierde: vive en `notch-de-consulta.tsx` como un listener
          de documento que no pinta nada ni bloquea nada — la app de atrás queda 100% usable con
          el panel abierto, que es la idea entera del Modo Fantasma. */}
      <div
        // Cuelga del notch: lo posiciona el dock, y acá sólo se resuelve que los dos leen como una
        // sola pieza — el notch pierde su redondeo de abajo y esto no tiene borde arriba.
        className="consulta pointer-events-auto relative z-40 w-[540px] max-w-[calc(100vw-24px)] overflow-hidden rounded-b-[18px] border border-t-0 border-line bg-ink text-fg shadow-popover"
      >
        {/* LA TIRA SE DESBORDABA Y SE RECORTABA EN SILENCIO. Las cinco pestañas y el enlace "Ir a
            la consulta" eran todos `shrink-0` en una fila sin `overflow`, dentro de un panel con
            `overflow-hidden`: lo que no entraba se cortaba, y lo que no entraba era el enlace. En
            el ancho completo (540px) ya rozaba; con `max-w-[calc(100vw-24px)]` en cualquier pantalla
            angosta desaparecía del todo.
            Se arregla por los dos lados: el enlace se va al pie —no es una pestaña, no tiene por
            qué competir con ellas por el ancho— y la tira scrollea en vez de recortar, que es el
            respaldo para cuando cinco etiquetas tampoco entren. */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-2">
          {PESTANAS.map((p) => {
            const activa = p.id === pestana
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setPestana(p.id)
                  // MIRAR LA ALERTA ES LO QUE LA APAGA. Si se apagara sola al llegar la siguiente,
                  // sería una luz que nadie vio.
                  if (p.id === "sugerencias") vivo.vistoLaAlerta()
                }}
                aria-current={activa ? "page" : undefined}
                className={`-mb-px shrink-0 border-b-2 px-2.5 py-2 text-[12.5px] font-medium transition-colors ${
                  activa ? "border-brand text-fg" : "border-transparent text-fg-muted hover:text-fg"
                }`}
              >
                {p.rotulo}
                {/* El punto en la pestaña, además del aro del notch: con el panel ya abierto, el
                    aro de afuera no se ve, y sin esto la sugerencia urgente quedaría escondida
                    detrás de una pestaña que no llama. */}
                {p.id === "sugerencias" && vivo.alerta && (
                  <span aria-hidden className="ml-1.5 inline-block size-1.5 rounded-full bg-warn" />
                )}
              </button>
            )
          })}

        </div>

        {/* Alto acotado CON UN MÍNIMO: sin el mínimo, el panel salta de tamaño cada vez que llega una
            nota nueva, y saltar es lo último que puede hacer algo que se mira de reojo. */}
        <div className="max-h-[55svh] min-h-[180px] overflow-y-auto p-3.5">
          {pestana === "notas" && <AthosEnVivo vivo={vivo} soloNotas />}

          {pestana === "sugerencias" && <AthosEnVivo vivo={vivo} soloSugerencias />}

          {pestana === "casos" && (
            <CasosParecidos
              consultaId={estado.consultaId}
              transcripcion={`${estado.estable} ${estado.provisional}`.trim()}
            />
          )}

          {pestana === "cuaderno" && <Cuaderno consultaId={estado.consultaId} filas={10} />}

          {pestana === "transcripcion" &&
            (fallo ? (
              <p className="text-[13px] text-danger">{estado.error ?? "La grabación falló."}</p>
            ) : estado.estable || estado.provisional ? (
              <p className="text-[13px] leading-relaxed">
                {estado.estable}{" "}
                {/* Lo provisional se pinta apagado: el proveedor todavía puede reemplazarlo, y en
                    una historia clínica la diferencia entre "lo dijo" y "creo que lo dijo"
                    importa. */}
                <span className="text-fg-muted">{estado.provisional}</span>
              </p>
            ) : (
              <p className="text-[13px] text-fg-muted">
                {estado.vivo
                  ? "Escuchando… el texto aparece a medida que se habla."
                  : "La transcripción en vivo no está disponible; la consulta se transcribe completa al terminar."}
              </p>
            ))}
        </div>

        {/* EL PIE. Antes existía sólo mientras se grababa, para la nota del micrófono. Ahora
            también sostiene "Ir a la consulta", y por eso se pinta siempre que haya una consulta:
            el enlace tiene que seguir estando en `Guardando…` y en el fallo, que son justo los dos
            momentos en que la pastilla NO pinta su botón de ampliar — sin él, el panel se quedaba
            sin ninguna salida hacia la consulta. */}
        {(estado.fase === "grabando" || estado.consultaId) && (
          <div className="flex items-center gap-3 border-t border-line px-3.5 py-2">
            {estado.fase === "grabando" && (
              <p className="min-w-0 text-[11px] leading-snug text-fg-muted">
                {estado.pausada
                  ? // Decirlo explícito importa: el micrófono sigue tomado —el navegador lo sigue
                    // mostrando— y el vet tiene que saber que eso NO significa que se esté grabando.
                    "En pausa: no se está capturando nada. El micrófono sigue tomado para poder reanudar sin volver a pedir permiso."
                  : "Grabando con el micrófono del dispositivo. La transcripción se guarda sólo si usted aprueba la nota."}
              </p>
            )}
            {estado.consultaId && (
              <Link
                href={`/dashboard/consultas/${estado.consultaId}`}
                onClick={alCerrar}
                className="ml-auto shrink-0 text-[11.5px] text-fg-muted hover:underline"
              >
                Ir a la consulta
              </Link>
            )}
          </div>
        )}
      </div>
    </>
  )
}
