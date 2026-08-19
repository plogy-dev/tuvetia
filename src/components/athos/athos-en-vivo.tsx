"use client"

// Lo que Athos aporta MIENTRAS la consulta pasa: notas de lo que se dijo y qué mirar.
//
// El pedido, del 17-ago: "que me dé notas, me dé sugerencias de qué decir, me busque la literatura
// en tiempo real". Notas cada ~15 s, sugerencias cada ~45 s — y sólo cuando hay material nuevo, que
// es una decisión de costo documentada en `lib/consulta-viva/disparador.ts`.
//
// SE LEE DE REOJO, y eso manda toda la forma: viñetas cortas, sin encabezados que ocupen línea, sin
// animaciones que roben la mirada. El vet tiene un animal delante; esto es un colega que apunta algo
// en voz baja, no una pantalla que pide atención.
//
// LO QUE ACÁ NO SE PUEDE OLVIDAR: nada de esto es la historia clínica. Se mira y se descarta. La
// nota que se aprueba sigue siendo la del cierre, y por eso el pie lo dice.

import { AlertTriangle, Loader2, Stethoscope } from "lucide-react"

import type { InteligenciaViva } from "@/lib/consulta-viva/usar-inteligencia-viva"

/** Las viñetas que devuelve el modelo, ya limpias. Puede venir con `-`, `•` o nada. */
function vinetas(texto: string): string[] {
  return texto
    .split("\n")
    .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean)
}

function Bloque({
  titulo,
  texto,
  acento,
}: {
  titulo: string
  texto: string
  acento?: boolean
}) {
  const items = vinetas(texto)
  if (!items.length) return null
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
        {titulo}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-snug">
            <span
              aria-hidden
              className={`mt-[6px] size-1.5 shrink-0 rounded-full ${
                acento ? "bg-brand" : "border border-line-strong"
              }`}
            />
            <span className="min-w-0 text-fg">{t}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function AthosEnVivo({
  vivo,
  soloNotas,
  soloSugerencias,
  className,
}: {
  vivo: InteligenciaViva
  /** Sólo "lo que se dijo". Lo usa la pestaña Live notes del notch. */
  soloNotas?: boolean
  /** Sólo "qué mirar". Lo usa la pestaña Sugerencias. */
  soloSugerencias?: boolean
  className?: string
}) {
  // SE PARTIÓ EN DOS PESTAÑAS, siguiendo el prototipo. Antes las notas y las sugerencias vivían en
  // el mismo panel, y son dos cosas distintas: las notas son lo que SE DIJO —barato, cada ~15 s— y
  // las sugerencias son criterio clínico con literatura detrás —caro, cada ~45 s—. Mezcladas, el
  // vet no sabía cuál de las dos estaba leyendo, que es justo lo que no puede pasar con una y no
  // con la otra.
  //
  // Sin ninguno de los dos flags se pintan las dos, que es como se usa fuera del notch.
  const verNotas = !soloSugerencias
  const verSugerencias = !soloNotas
  const hayAlgo =
    (verNotas && vivo.notas.trim()) || (verSugerencias && vivo.sugerencias.trim())

  return (
    <div className={`flex min-w-0 flex-col gap-4 ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        <Stethoscope className="size-3.5 shrink-0 text-fg-faint" aria-hidden />
        <span className="text-sm font-semibold">
          {soloSugerencias ? "Qué mirar" : soloNotas ? "Lo que se dijo" : "Athos en vivo"}
        </span>
        {vivo.pensando && (
          <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin text-fg-faint" />
        )}
        {/* EL GASTO A LA VISTA. Un techo que no se ve no disciplina a nadie, y esta función es la
            que más puede costar del producto. Se muestra desde la primera llamada. */}
        {vivo.llamadas > 0 && (
          <span
            className="ml-auto font-mono text-[11px] tabular-nums text-fg-faint"
            title={`Athos miró la consulta ${vivo.llamadas} veces. El máximo por consulta es ${vivo.techo}.`}
          >
            {vivo.llamadas}/{vivo.techo}
          </span>
        )}
      </div>

      {/* LAS ALERGIAS SEVERAS, ARRIBA DE TODO. Es la regla 3 del producto: el gate va ANTES de
          cualquier plan. Acá el momento correcto es antes de que el vet elija el fármaco — no al
          cerrar la nota, cuando ya lo dijo en voz alta. */}
      {vivo.alergias.length > 0 && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] leading-snug text-fg"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          <span>
            <strong className="font-semibold">Alergias severas:</strong> {vivo.alergias.join(", ")}.
            Tenelas en cuenta antes de cualquier plan.
          </span>
        </p>
      )}

      {verSugerencias && <Bloque titulo="Qué mirar" texto={vivo.sugerencias} acento />}
      {verNotas && <Bloque titulo="Lo que se dijo" texto={vivo.notas} />}

      {!hayAlgo && (
        <p className="text-[13px] leading-snug text-fg-muted">
          {vivo.pensando
            ? "Escuchando la consulta…"
            : "Cuando haya material suficiente, Athos deja acá lo que se dijo y qué conviene revisar."}
        </p>
      )}

      {/* El guard de dosis se declara, no se esconde: si la ficha está incompleta el vet tiene que
          saber que faltan cifras y por qué, para poder completarla. */}
      {vivo.dosisRedactadas && (
        <p className="text-xs leading-snug text-fg-muted">
          Se omitieron cifras de dosis: falta especie, peso o edad en la ficha del paciente.
        </p>
      )}

      {hayAlgo && (
        <p className="text-xs leading-snug text-fg-faint">
          Borrador para mirar mientras atendés. No entra a la historia clínica: la nota se genera y se
          aprueba al cerrar la consulta.
        </p>
      )}
    </div>
  )
}
