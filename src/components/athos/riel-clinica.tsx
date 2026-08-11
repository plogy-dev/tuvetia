import Link from "next/link"

// "La clínica hoy" — el riel de 320px que acompaña a la conversación de Athos.
//
// Es el tablero, reducido a lo que se puede leer sin dejar de conversar. El mockup lo dibuja así a
// propósito: no son cards con sombra sino FILAS DENSAS separadas por una línea, porque compite por
// atención con el hilo de Athos y tiene que perder esa competencia. Quien quiera el tablero de
// verdad tiene el enlace arriba.
//
// Server component: los datos los pasa la página, ya resueltos.

import { Button } from "@/components/ui/button"
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

export function RielClinica({
  consultasHoy,
  ventasMesCents,
  carteraVencidaCents,
  citas,
  pendientes,
  mostrarDinero,
}: {
  consultasHoy: number
  ventasMesCents: number
  carteraVencidaCents: number
  citas: CitaDelRiel[]
  pendientes: PendienteDelRiel[]
  /**
   * Facturación puede estar sin activar. Con el módulo apagado no hay facturas, así que ventas y
   * cartera darían "$ 0" — que no es "cero ventas", es "no lo estás usando". Un cero inventado en
   * un tablero se lee como un dato malo, no como un módulo apagado, así que las filas se omiten.
   */
  mostrarDinero: boolean
}) {
  return (
    <aside className="hidden w-80 shrink-0 flex-col gap-6 overflow-auto border-l border-line p-5 xl:flex">
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
                  <span className="shrink-0 rounded bg-warn/10 px-1.5 py-0.5 text-[11px] font-medium text-warn">
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
                <span className="flex shrink-0 items-center gap-1.5 rounded bg-danger/10 px-1.5 py-0.5 text-[11px] font-medium text-danger">
                  <span aria-hidden className="size-1.5 rounded-full bg-danger" />
                  {p.detalle}
                </span>
              </li>
            ))}
          </ul>
          {/* El botón que cierra el circuito: ver el problema y resolverlo sin cambiar de pantalla.
              Es lo que el mockup pone al pie del riel, y es la diferencia entre un tablero que
              informa y uno desde el que se trabaja. */}
          <Button
            variant="outline"
            size="sm"
            className="mt-1 w-full"
            render={<Link href="/dashboard/asistente?pedir=cobros" />}
          >
            Resolverlo con Athos
          </Button>
        </section>
      )}
    </aside>
  )
}
