"use client"

import { useState, useSyncExternalStore } from "react"
import Link from "next/link"

import { preferenciaPlegada } from "@/lib/ui/preferencia-plegada"

/** Si el vet dejó el riel plegado. Ver `lib/ui/preferencia-plegada`. */
const PLEGADO = preferenciaPlegada("tuvetia:riel-clinica-plegado")

// "La clínica hoy" — el riel de 320px que acompaña a la conversación de VetGPT.
//
// Es el tablero, reducido a lo que se puede leer sin dejar de conversar. El mockup lo dibuja así a
// propósito: no son cards con sombra sino FILAS DENSAS separadas por una línea, porque compite por
// atención con el hilo de VetGPT y tiene que perder esa competencia. Quien quiera el tablero de
// verdad tiene el enlace arriba.
//
// Server component: los datos los pasa la página, ya resueltos.

import { ChevronDown, PanelLeftOpen, PanelRightClose } from "lucide-react"
import { Button } from "@/components/ui/button"
import { estadoDelCupo, proporcionUsada, type CupoVisible } from "@/lib/cupo"
import { formatCOP } from "@/lib/facturacion/format"

export type CitaDelRiel = {
  id: string
  hora: string
  etiqueta: string
  sinConfirmar: boolean
}

export type PendienteDelRiel = {
  id: string
  etiqueta: string
  detalle: string
}


/** El rótulo de sección del riel: versalitas 11px, como en todo el sistema. */
function Rotulo({ children, accion }: { children: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
        {children}
      </span>
      {accion}
    </div>
  )
}

function EnlaceSuave({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-[13px] text-brand-text hover:underline">
      {children}
    </Link>
  )
}

/** `etiqueta ········ valor`, con el valor en mono para que la columna derecha se alinee sola. */
function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-fg-muted">{etiqueta}</span>
      <span className="font-mono text-[15px] tabular-nums">{valor}</span>
    </div>
  )
}

/**
 * "Consultas con IA · 120/500" — lo único que le dice al vet cuánto cupo le queda.
 *
 * POR QUÉ ACÁ. El tope por clínica ya corta el gasto, pero cortaba a ciegas: el vet se topaba con
 * un 402 sin haber visto nunca que se estaba acercando. Un plan con límite que no muestra el límite
 * no es un plan, es una sorpresa.
 *
 * NO SE PINTA SI NO HAY TOPE, que es el estado de hoy. Un medidor de un límite que no existe es
 * ruido permanente en la superficie que compite con la conversación — y encima insinuaría un plan
 * que todavía no se vende.
 *
 * La barra aparece SÓLO cuando queda poco. Mientras sobra cupo, la cifra alcanza y la fila se
 * comporta igual que las otras tres del bloque; el gráfico se gana el espacio recién cuando hay
 * algo que mirar.
 */
function CupoDeIA({ presupuesto }: { presupuesto: CupoVisible | null }) {
  const estado = estadoDelCupo(presupuesto)
  // `tope === null` ya está cubierto por "sin-tope", pero se comprueba de nuevo para que TypeScript
  // lo sepa: `aria-valuemax` no acepta null, y esa es una barra de progreso sin máximo declarado
  // para un lector de pantalla — no un detalle de tipos.
  if (!presupuesto || estado === "sin-tope" || presupuesto.tope === null) return null

  const { usadas, tope, restantes, reinicia } = presupuesto
  const proporcion = proporcionUsada(presupuesto)
  const agotado = estado === "agotado"
  const escaso = estado === "escaso"

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-sm ${agotado ? "text-danger" : escaso ? "text-warn" : "text-fg-muted"}`}>
          Consultas con IA
        </span>
        <span className="font-mono text-[15px] tabular-nums">
          {usadas}
          <span className="text-fg-faint">/{tope}</span>
        </span>
      </div>
      {(escaso || agotado) && (
        <>
          <div
            role="progressbar"
            aria-valuenow={usadas}
            aria-valuemin={0}
            aria-valuemax={tope}
            aria-label="Consultas con IA usadas este mes"
            className="h-1 overflow-hidden rounded-full bg-line-soft"
          >
            <div
              className={`h-full rounded-full ${agotado ? "bg-danger" : "bg-warn"}`}
              style={{ width: `${Math.round(proporcion * 100)}%` }}
            />
          </div>
          <span className="text-[11px] text-fg-muted">
            {agotado
              ? `Sin cupo hasta el ${reinicia}. El resto de Tuvetia sigue igual.`
              : `Quedan ${restantes}. Se renueva el ${reinicia}.`}
          </span>
        </>
      )}
    </div>
  )
}

/**
 * El mismo riel, aplastado a una línea, para cuando no hay 320px que darle.
 *
 * POR QUÉ HACE FALTA. `RielClinica` es `xl:flex`: por debajo de 1280px desaparece ENTERO. O sea que
 * en un teléfono —y en cualquier portátil de 13"— el vet abría la app y no veía ni cuántas citas
 * tiene hoy ni que hay cobros vencidos. El dato no estaba escondido detrás de un toque: no estaba.
 *
 * Es la tira que el mockup dibuja arriba en la vista móvil, y se queda en el mismo dato: cuántas
 * citas y qué requiere atención. Todo lo demás (ventas del mes, la lista de citas hora por hora)
 * necesita alto que en un teléfono le pertenece a la conversación.
 *
 * No consulta nada: recibe lo que la página ya resolvió para el riel grande.
 */
const CLAVE_TIRA = "tuvetia_tira_clinica_abierta"

export function TiraClinica({
  citas,
  pendientes,
  presupuesto,
}: {
  citas: CitaDelRiel[]
  pendientes: PendienteDelRiel[]
  presupuesto?: CupoVisible | null
}) {
  // La preferencia se recuerda: quien la abre la quiere abierta, y quien la cierra no quiere que
  // vuelva sola en cada navegación. `useSyncExternalStore` porque `localStorage` no existe en el
  // servidor y leerlo en el primer render rompería la hidratación — mismo patrón que el riel de
  // configuración.
  const guardada = useSyncExternalStore(
    () => () => {},
    () => (typeof window !== "undefined" ? localStorage.getItem(CLAVE_TIRA) === "1" : false),
    () => false,
  )
  const [local, setLocal] = useState<boolean | null>(null)
  const abierta = local ?? guardada

  function alternar() {
    const siguiente = !abierta
    setLocal(siguiente)
    try {
      localStorage.setItem(CLAVE_TIRA, siguiente ? "1" : "0")
    } catch {
      // Modo incógnito o storage lleno: se pierde la preferencia, no la tira.
    }
  }

  const partes = [citas.length === 1 ? "1 cita" : `${citas.length} citas`]
  // Sólo el primero: en una línea no entran tres, y hoy `pendientes` trae como mucho cartera.
  if (pendientes.length > 0) partes.push(pendientes[0].etiqueta)
  // El cupo entra en la tira SÓLO cuando aprieta. En 320px de riel una fila más es barata; en una
  // línea de teléfono es la mitad del espacio, y "quedan 380 de 500" no es algo sobre lo que haya
  // que hacer nada hoy. El umbral es el MISMO que usa el riel: sale de `estadoDelCupo`.
  const estado = estadoDelCupo(presupuesto)
  if (estado === "agotado") partes.push("sin cupo de IA")
  else if (estado === "escaso") partes.push(`quedan ${presupuesto?.restantes} consultas con IA`)

  return (
    // Misma columna que el hilo y el compositor de VetGPT. Es la pieza que se pinta por debajo de
    // `xl`, o sea justo donde el ancho ya escasea.
    //
    // SE PLIEGA, Y ARRANCA PLEGADA. Lo pidieron los dos el 19-ago:
    //
    //   David:   "que predeterminado esté cerrada, porque cuando tú entras y ves las tres es
    //             demasiado ruido"
    //   Luciano: "demasiada información, exacto"
    //
    // Plegada queda el rótulo y el número —"3 pendientes"—, que es lo que responde "¿tengo algo?"
    // sin obligar a leer nada. Desplegada, el detalle. Y la preferencia se recuerda: quien la abre
    // una vez la quiere abierta, y quien la cierra no quiere que vuelva sola en cada navegación.
    <div className="mx-auto flex w-full max-w-[780px] flex-col rounded-lg border border-line-soft text-xs xl:hidden">
      <button
        type="button"
        onClick={alternar}
        aria-expanded={abierta}
        className="flex items-center gap-2 px-3 py-2 text-left"
      >
        <span className="shrink-0 font-semibold uppercase tracking-[0.08em] text-fg-faint">
          La clínica hoy
        </span>
        {/* PLEGADA NO SE CALLA: dice cuántas cosas hay. Un plegable que sólo dice su nombre obliga
            a abrirlo para saber si valía la pena, que es la mitad del ruido que se vino a quitar. */}
        {!abierta && (
          <span className="min-w-0 flex-1 truncate text-fg-muted">{partes.length} en el día</span>
        )}
        <ChevronDown
          aria-hidden
          className={`ml-auto size-3.5 shrink-0 text-fg-faint transition-transform ${
            abierta ? "rotate-180" : ""
          }`}
        />
        <span className="sr-only">{abierta ? "Ocultar el detalle" : "Ver el detalle"}</span>
      </button>

      {abierta && (
      <div className="flex items-center gap-2 border-t border-line-soft px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-fg-muted">{partes.join(" · ")}</span>
      {/* Al tablero y no a la agenda: es la pantalla que tiene TODO lo que la tira resume, incluido
          lo que aquí no cupo. */}
      <Link
        href="/dashboard/tablero"
        className="shrink-0 font-medium text-brand-text hover:underline"
      >
        Ver
      </Link>
      </div>
      )}
    </div>
  )
}

export function RielClinica({
  consultasHoy,
  ventasMesCents,
  carteraVencidaCents,
  citas,
  pendientes,
  mostrarDinero,
  presupuesto,
  briefing,
}: {
  consultasHoy: number
  ventasMesCents: number
  carteraVencidaCents: number
  citas: CitaDelRiel[]
  pendientes: PendienteDelRiel[]
  /**
   * El resumen del día redactado por VetGPT. `null` cuando el cron todavía no corrió, cuando la
   * clínica lo tiene apagado, o cuando no había nada que contar.
   *
   * Es lo ÚNICO del riel que gasta IA, y por eso es lo único que puede faltar sin que falte nada:
   * los pendientes de abajo salen de las mismas señales y se ven igual sin él.
   */
  briefing?: string | null
  /** Cupo de IA del mes. `null` o sin tope = no se pinta nada. */
  presupuesto?: CupoVisible | null
  /**
   * Facturación puede estar sin activar. Con el módulo apagado no hay facturas, así que ventas y
   * cartera darían "$ 0" — que no es "cero ventas", es "no lo estás usando". Un cero inventado en
   * un tablero se lee como un dato malo, no como un módulo apagado, así que las filas se omiten.
   */
  mostrarDinero: boolean
}) {
  // SE PLIEGA A LA DERECHA, y se acuerda. Es la misma molestia que el historial de la barra y las
  // métricas del tablero: una columna de 320px que está siempre y que a veces estorba. Quien la
  // cierra no quiere que vuelva sola en cada navegación.
  const plegado = useSyncExternalStore(
    PLEGADO.suscribir,
    PLEGADO.leer,
    PLEGADO.enElServidor,
  )

  // PLEGADO NO ES DESMONTADO. La columna se queda con el ancho de la solapa en vez de desaparecer:
  // si el riel se fuera del todo, el hilo de VetGPT se ensancharía de golpe y volver a abrirlo
  // reflowearía la conversación entera. Además el botón tiene que seguir en algún lado.
  if (plegado) {
    return (
      <aside className="hidden shrink-0 flex-col items-center border-l border-line py-4 xl:flex">
        <button
          type="button"
          onClick={() => PLEGADO.escribir(false)}
          aria-label="Mostrar el resumen de la clínica"
          aria-expanded={false}
          title="Mostrar el resumen de la clínica"
          className="grid size-8 place-items-center rounded-[7px] text-fg-faint transition-colors hover:bg-fg/5 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <PanelLeftOpen className="size-4" aria-hidden />
        </button>
      </aside>
    )
  }

  return (
    // `min-h-0` NO es decorativo, y su ausencia arrastraba la PANTALLA ENTERA. Este aside tiene
    // `overflow-auto`, pero sin `min-h-0` su alto mínimo sigue siendo el de su contenido: con la
    // agenda del día, los pendientes y las señales adentro, empujaba la fila, la fila empujaba al
    // shell y el chat entero pasaba a scrollear con la página — la cabecera se iba de vista y había
    // que bajar a buscar el compositor (reporte del 27-ago, con capturas). `overflow-auto` sin
    // `min-h-0` es scroll que no llega a activarse nunca.
    <aside className="hidden min-h-0 w-80 shrink-0 flex-col gap-6 overflow-auto border-l border-line p-5 xl:flex">
      {/* La solapa va ARRIBA DEL TODO y alineada a la derecha: es el borde por el que se pliega, y
          ponerla al pie obligaría a bajar hasta el final para cerrar algo que estorba arriba. */}
      <button
        type="button"
        onClick={() => PLEGADO.escribir(true)}
        aria-label="Ocultar el resumen de la clínica"
        aria-expanded
        title="Ocultar el resumen de la clínica"
        className="-mb-2 -mr-1 -mt-1 ml-auto grid size-8 shrink-0 place-items-center rounded-[7px] text-fg-faint transition-colors hover:bg-fg/5 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <PanelRightClose className="size-4" aria-hidden />
      </button>

      {/* EL RESUMEN DEL DÍA, arriba de todo: es lo primero que se lee al abrir la app.
          Va SIN encabezado propio — un rótulo "Resumen del día" encima de dos frases es más
          cromo que contenido, y el texto ya empieza diciendo de qué habla. */}
      {briefing && (
        <p className="text-[13px] leading-relaxed text-fg-muted">{briefing}</p>
      )}

      <section className="flex flex-col gap-3">
        <Rotulo accion={<EnlaceSuave href="/dashboard/tablero">Dashboard</EnlaceSuave>}>
          La clínica hoy
        </Rotulo>
        <div className="flex flex-col gap-2.5">
          <Fila etiqueta="Consultas hoy" valor={String(consultasHoy)} />
          {mostrarDinero && (
            <>
              <Fila etiqueta="Ventas del mes" valor={formatCOP(ventasMesCents)} />
              <Fila etiqueta="Cartera vencida" valor={formatCOP(carteraVencidaCents)} />
            </>
          )}
          <CupoDeIA presupuesto={presupuesto ?? null} />
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-line pt-5">
        <Rotulo accion={<EnlaceSuave href="/dashboard/calendario">Ver agenda</EnlaceSuave>}>
          Agenda
        </Rotulo>
        {citas.length === 0 ? (
          <p className="text-sm text-fg-muted">Sin citas para hoy.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {citas.map((c) => (
              // La hora va en mono y con ancho FIJO: es lo que hace que las horas formen una
              // columna en vez de bailar según cuántos dígitos tenga cada una.
              <li key={c.id} className="flex items-baseline gap-2.5 text-sm">
                <span className="w-11 shrink-0 font-mono text-xs tabular-nums text-fg-muted">
                  {c.hora}
                </span>
                <span className="min-w-0 flex-1 truncate">{c.etiqueta}</span>
                {c.sinConfirmar && (
                  <span className="shrink-0 rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-medium text-warn">
                    Sin confirmar
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {pendientes.length > 0 && (
        <section className="flex flex-col gap-3 border-t border-line pt-5">
          <Rotulo>Requiere atención</Rotulo>
          <ul className="flex flex-col gap-2.5">
            {pendientes.map((p) => (
              <li key={p.id} className="flex items-baseline gap-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{p.etiqueta}</span>
                <span className="flex shrink-0 items-center gap-1.5 rounded-md bg-danger-soft px-1.5 py-0.5 text-[11px] font-medium text-danger">
                  <span aria-hidden className="size-1.5 rounded-full bg-danger" />
                  {p.detalle}
                </span>
              </li>
            ))}
          </ul>
          {/* El botón que cierra el circuito: ver el problema y resolverlo sin cambiar de pantalla.
              Es lo que el mockup pone al pie del riel, y es la diferencia entre un tablero que
              informa y uno desde el que se trabaja.

              ADÓNDE LLEVA DEPENDE DEL PRIMER PENDIENTE. Con el canal caído arriba, "Resolverlo con
              VetGPT" sería una promesa falsa: VetGPT no puede reconectar WhatsApp — de hecho es lo
              que MENOS puede hacer, porque sin canal su propia herramienta de mensajes falla. Un
              botón que ofrece un arreglo que no existe es peor que no tener botón. */}
          {(() => {
            const canalCaido = pendientes[0]?.id === "canal-caido"
            return (
              <Button
                variant="outline"
                size="sm"
                className="mt-1 w-full"
                render={
                  <Link href={canalCaido ? "/dashboard/conexiones" : "/dashboard/asistente?pedir=cobros"} />
                }
              >
                {canalCaido ? "Reconectar WhatsApp" : "Resolverlo con VetGPT"}
              </Button>
            )
          })()}
        </section>
      )}
    </aside>
  )
}
