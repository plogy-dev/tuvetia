"use client"

// "Casos parecidos": lo que la clínica ya vio y se parece a lo que está pasando.
//
// ES LA MEMORIA DEL CONSULTORIO, no literatura. La pestaña de sugerencias trae papers; ésta trae
// "esto ya lo viste en marzo, con Nala". Para un veterinario que lleva años en la misma clínica, su
// propio historial suele valer más que un estudio — y hasta ahora era la única fuente que Athos no
// miraba durante la consulta.
//
// NO GASTA CUPO DE IA: la búsqueda es determinística (ver `api/athos/casos-parecidos`). Por eso se
// puede consultar cada vez que el vet abre la pestaña, sin pensar en el techo mensual.
//
// SE PIDE AL ABRIR, NO EN BUCLE. Es una pestaña que se mira cuando surge la duda, no un panel que
// tiene que estar siempre fresco: recargar solo cada pocos segundos sería una consulta a la base por
// una pregunta que nadie hizo.

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { RotateCw, Search } from "lucide-react"

import { RotuloDeSeccion } from "@/components/athos/rotulo-de-seccion"

import { bogotaDateOnly } from "@/lib/date-utils"

type Caso = {
  id: string
  fecha: string
  paciente: string
  especie: string | null
  resumen: string
}

export function CasosParecidos({
  consultaId,
  transcripcion,
}: {
  consultaId: string | null
  transcripcion: string
}) {
  // Arranca EN "buscando" y no en vacío: la primera búsqueda sale con el montaje, así que un
  // estado inicial de "no encontré nada" sería una respuesta antes de la pregunta. Y así el efecto
  // no tiene que tocar el estado de forma síncrona, que es lo que dispara renders en cascada.
  const [casos, setCasos] = useState<Caso[] | null>(null)
  const [terminos, setTerminos] = useState<string[]>([])
  // Arranca EN "buscando": la primera búsqueda sale con el montaje, así que un estado inicial de
  // "no encontré nada" sería una respuesta antes de la pregunta.
  const [cargando, setCargando] = useState(true)

  /**
   * Busca y guarda el resultado.
   *
   * TODO EL `setState` VA EN UN `.then`, no después de un `await`. Es el patrón que React documenta
   * para efectos —"suscribirse a un sistema externo y llamar a setState en un callback"— y además
   * es lo único que deja al linter ver que el cuerpo síncrono no toca el estado. Con `async/await`
   * la primera parte de la función corre dentro del render que la llamó, que es como se disparan
   * los renders en cascada.
   */
  const buscar = useCallback((texto: string) => {
    if (!texto.trim()) {
      return Promise.resolve().then(() => {
        setCargando(false)
        setCasos([])
        setTerminos([])
      })
    }
    return fetch("/api/athos/casos-parecidos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: texto, consultation_id: consultaId }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.json() as Promise<{ terminos: string[]; casos: Caso[] }>
      })
      .then((r) => {
        setCasos(r.casos)
        setTerminos(r.terminos)
      })
      // En silencio, como el resto del vivo: el vet está atendiendo y un error acá no le sirve de
      // nada. Se queda sin casos, que es lo mismo que no haber encontrado.
      .catch(() => setCasos([]))
      .finally(() => setCargando(false))
  }, [consultaId])

  // UNA VEZ AL ABRIR. El botón de recargar es para cuando la consulta ya avanzó y el vet quiere
  // volver a preguntar con lo nuevo — que es una decisión suya, no del reloj. Depender de la
  // transcripción acá sería una consulta a la base por cada palabra que se dice.
  const alAbrir = useRef(true)
  useEffect(() => {
    if (!alAbrir.current) return
    alAbrir.current = false
    void buscar(transcripcion)
  }, [buscar, transcripcion])

  function volverABuscar() {
    setCargando(true)
    void buscar(transcripcion)
  }

  return (
    <div className="flex flex-col gap-3">
      <RotuloDeSeccion
        icono={<Search className="size-3 shrink-0 text-fg-faint" aria-hidden />}
        cargando={cargando}
        acciones={
          <button
          type="button"
          onClick={volverABuscar}
          disabled={cargando}
          className="ml-auto flex shrink-0 items-center gap-1 rounded-[7px] px-2 py-1 text-[11.5px] text-fg-muted transition-colors hover:bg-fg/10 hover:text-fg disabled:opacity-40"
        >
            <RotateCw className="size-3" aria-hidden />
            Volver a buscar
          </button>
        }
      >
        Casos parecidos
      </RotuloDeSeccion>

      {/* QUÉ SE BUSCÓ, a la vista. Sin esto, "no encontré nada" es indistinguible de "busqué mal":
          con los términos delante el vet ve por qué y puede seguir hablando del cuadro. */}
      {terminos.length > 0 && (
        <p className="text-[11.5px] text-fg-faint">
          Buscando por: {terminos.join(" · ")}
        </p>
      )}

      {casos?.length ? (
        <ul className="flex flex-col gap-2">
          {casos.map((c) => (
            <li key={c.id}>
              <Link
                href={`/dashboard/consultas/${c.id}`}
                className="flex flex-col gap-1 rounded-xl border border-line-soft p-3 transition-colors hover:border-brand focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="flex items-baseline gap-2 text-[13px]">
                  <span className="font-medium text-fg">{c.paciente}</span>
                  {c.especie && <span className="text-fg-muted">{c.especie}</span>}
                  <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-fg-faint">
                    {bogotaDateOnly(c.fecha)}
                  </span>
                </span>
                {c.resumen && (
                  <span className="line-clamp-2 text-[12.5px] leading-snug text-fg-muted">
                    {c.resumen}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] leading-snug text-fg-muted">
          {cargando
            ? "Buscando en las consultas de la clínica…"
            : casos === null
              ? "Buscando en las consultas de la clínica…"
              : transcripcion.trim()
                ? "Todavía no encontré una consulta parecida en la clínica. Seguí hablando del cuadro y volvé a buscar."
                : "Cuando Athos escuche lo suficiente, acá aparecen consultas anteriores parecidas a ésta."}
        </p>
      )}
    </div>
  )
}
