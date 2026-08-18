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
// EN PESTAÑAS Y NO EN TRES COLUMNAS. A lo ancho de la pantalla entraban transcripción, Athos y
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
import { Cuaderno } from "@/components/athos/cuaderno"
import { useConsultaViva } from "@/lib/consulta-viva/usar"
import { useInteligenciaViva } from "@/lib/consulta-viva/usar-inteligencia-viva"

/** Las tres cosas que se miran durante una consulta, en el orden en que se miran. */
const PESTANAS = [
  { id: "athos", rotulo: "Athos" },
  { id: "cuaderno", rotulo: "Mis notas" },
  { id: "transcripcion", rotulo: "Transcripción" },
] as const

type Pestana = (typeof PESTANAS)[number]["id"]

// OSCURO EN LOS DOS TEMAS, igual que el notch, con la clase `.consulta` que el sistema ya tiene:
// declara la paleta oscura completa —en nuestro menta, no en el azul del prototipo— sobre cualquier
// subárbol. Así el panel no lleva un solo color crudo y sus hijos, que están escritos con tokens
// semánticos, se resuelven solos.

export function PanelModoFantasma({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const estado = useConsultaViva()
  const [pestana, setPestana] = useState<Pestana>("athos")

  // ANTES DEL RETURN TEMPRANO, y no sólo por la regla de los hooks. El panel se contrae todo el
  // tiempo —es el uso que pidió el cliente— y este componente sigue montado cuando `abierto` es
  // false. Si la inteligencia dependiera de tenerlo abierto, al volver estaría en blanco y habría
  // que esperar otro tramo de consulta para ver algo.
  //
  // Se ata a que HAYA GRABACIÓN, no a que se esté mirando: las notas se acumulan mientras el vet
  // atiende y están ahí cuando las busca.
  const vivo = useInteligenciaViva(estado.fase === "grabando")

  if (!abierto || estado.fase === "inactiva") return null

  const fallo = estado.fase === "perdida"

  return (
    <>
      {/* El velo ATENÚA, no tapa: cierra al tocarlo y deja ver el contexto de abajo, que es la
          diferencia entre un panel y un modal. No detiene la grabación — contraer y terminar son
          cosas distintas, y confundirlas acá cortaría una consulta. */}
      <button
        type="button"
        aria-label="Contraer la consulta"
        onClick={alCerrar}
        className="fixed inset-0 z-30 cursor-default bg-black/20"
      />

      <div
        // Cuelga del notch: lo posiciona el dock, y acá sólo se resuelve que los dos leen como una
        // sola pieza — el notch pierde su redondeo de abajo y esto no tiene borde arriba.
        className="consulta pointer-events-auto relative z-40 w-[540px] max-w-[calc(100vw-24px)] overflow-hidden rounded-b-[18px] border border-t-0 border-line bg-ink text-fg shadow-popover"
      >
        <div className="flex items-center gap-1 border-b border-line px-2">
          {PESTANAS.map((p) => {
            const activa = p.id === pestana
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPestana(p.id)}
                aria-current={activa ? "page" : undefined}
                className={`-mb-px shrink-0 border-b-2 px-2.5 py-2 text-[12.5px] font-medium transition-colors ${
                  activa ? "border-brand text-fg" : "border-transparent text-fg-muted hover:text-fg"
                }`}
              >
                {p.rotulo}
              </button>
            )
          })}

          {estado.consultaId && (
            <Link
              href={`/dashboard/consultas/${estado.consultaId}`}
              onClick={alCerrar}
              className="ml-auto shrink-0 px-2 py-2 text-[11.5px] text-fg-muted hover:underline"
            >
              Ir a la consulta
            </Link>
          )}
        </div>

        {/* Alto acotado CON UN MÍNIMO: sin el mínimo, el panel salta de tamaño cada vez que llega una
            nota nueva, y saltar es lo último que puede hacer algo que se mira de reojo. */}
        <div className="max-h-[55svh] min-h-[180px] overflow-y-auto p-3.5">
          {pestana === "athos" && <AthosEnVivo vivo={vivo} />}

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

        {estado.fase === "grabando" && (
          <p className="border-t border-line px-3.5 py-2 text-[11px] leading-snug text-fg-muted">
            {estado.pausada
              ? // Decirlo explícito importa: el micrófono sigue tomado —el navegador lo sigue
                // mostrando— y el vet tiene que saber que eso NO significa que se esté grabando.
                "En pausa: no se está capturando nada. El micrófono sigue tomado para poder reanudar sin volver a pedir permiso."
              : "Grabando con el micrófono del dispositivo. La transcripción se guarda sólo si usted aprueba la nota."}
          </p>
        )}
      </div>
    </>
  )
}
