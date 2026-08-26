"use client"

// El panel lateral de la agenda: mini calendario, avisos y la lista de veterinarios.
//
// ── QUÉ RESUELVE ───────────────────────────────────────────────────────────────────────────────
//
// Saltar a una fecha. Antes la única forma era apretar «siguiente» semana por semana: para ver la
// agenda de dentro de un mes había que hacer cuatro clics y contar. Es la pieza que toda agenda
// tiene a la izquierda y ésta no.
//
// Y de paso ordena la pantalla: los controles que se tocan una vez (avisos, qué vets se ven) dejan
// de competir por la fila del encabezado con los que se tocan todo el tiempo.
//
// ── LO QUE NO HACE ─────────────────────────────────────────────────────────────────────────────
//
// No filtra citas por su cuenta ni guarda nada: le avisa al calendario qué fecha mirar y qué vets
// mostrar, y el calendario decide. El estado vive arriba, en `appointment-calendar.tsx`, porque es
// el mismo que usan la grilla y el buscador.
//
// La ARITMÉTICA de la grilla vive en `lib/agenda/mes.ts`, pura y con 13 tests: un mini calendario
// que se equivoca en un día manda al vet a mirar la agenda de otro día creyendo que es la de hoy.

import { useMemo, useState } from "react"
import Link from "next/link"
import { BellIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DIAS_DE_LA_SEMANA,
  fechaDesdeISO,
  grillaDelMes,
  isoEnBogota,
  mesVecino,
  nombreDelMes,
} from "@/lib/agenda/mes"
import type { SelectOption } from "@/lib/appointments"

export function PanelDeAgenda({
  fecha,
  onElegirFecha,
  vets,
  vetsVisibles,
  onAlternarVet,
  avisosActivos,
}: {
  /** La fecha que la grilla está mirando. El mini calendario la resalta. */
  fecha: Date
  onElegirFecha: (d: Date) => void
  vets: SelectOption[]
  /** `null` = se ven todos. Un conjunto = sólo esos. */
  vetsVisibles: Set<string> | null
  onAlternarVet: (id: string) => void
  /** Si la clínica tiene encendidos los avisos de cita por WhatsApp. */
  avisosActivos: boolean
}) {
  const seleccionada = isoEnBogota(fecha)
  // EL MES QUE SE MIRA ES INDEPENDIENTE DEL DÍA SELECCIONADO: hojear noviembre no debería cambiar
  // la agenda que se está viendo. Sólo al hacer clic en un día se mueve la grilla.
  const [mes, setMes] = useState(() => `${seleccionada.slice(0, 7)}-01`)
  const dias = useMemo(() => grillaDelMes(mes), [mes])
  const hoy = isoEnBogota(new Date())

  return (
    <aside className="flex w-full shrink-0 flex-col gap-5 lg:w-64">
      {/* ── AVISOS ─────────────────────────────────────────────────────────────────────────────
          Se DICE el estado y se enlaza a donde se cambia; no se cambia acá. El interruptor real
          vive en Administración porque encenderlo decide que la clínica le escribe sola a sus
          clientes —y eso es de administrador—, mientras que esta pantalla la usa todo el equipo.
          Un interruptor que la mitad del equipo no puede mover es peor que un enlace. */}
      <section className="rounded-xl border border-line bg-card p-3">
        <div className="flex items-start gap-2.5">
          <BellIcon className="mt-0.5 size-4 shrink-0 text-fg-faint" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-fg">Avisos por WhatsApp</p>
            <p className="mt-0.5 text-[12px] leading-snug text-fg-muted">
              {avisosActivos
                ? "Al titular se le avisa al agendar y antes de la cita."
                : "Apagados: el titular no recibe aviso de sus citas."}
            </p>
            <Link
              href="/dashboard/administracion/clinica"
              className="mt-1.5 inline-block text-[12px] font-medium text-brand-text hover:underline"
            >
              {avisosActivos ? "Cambiar" : "Encender"}
            </Link>
          </div>
        </div>
      </section>

      {/* ── MINI CALENDARIO ────────────────────────────────────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Mes anterior"
            onClick={() => setMes((m) => mesVecino(m, -1))}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <span className="text-[13px] font-medium text-fg">{nombreDelMes(mes)}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Mes siguiente"
            onClick={() => setMes((m) => mesVecino(m, 1))}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-y-1">
          {DIAS_DE_LA_SEMANA.map((d) => (
            <span
              key={d}
              className="pb-1 text-center text-[11px] font-medium text-fg-faint"
              aria-hidden
            >
              {d}
            </span>
          ))}
          {dias.map((d) => {
            const esHoy = d.iso === hoy
            const esta = d.iso === seleccionada
            return (
              <button
                key={d.iso}
                type="button"
                onClick={() => onElegirFecha(fechaDesdeISO(d.iso))}
                aria-current={esta ? "date" : undefined}
                // `aria-label` con la fecha entera: el número suelto no le dice nada a un lector de
                // pantalla, y en la grilla hay dos «1» (el del mes y el del relleno).
                aria-label={d.iso}
                className={cn(
                  "mx-auto flex size-7 items-center justify-center rounded-md text-[12.5px] tabular-nums transition-colors",
                  esta
                    ? "bg-brand font-semibold text-on-brand"
                    : esHoy
                      ? "font-semibold text-brand-text ring-1 ring-brand/40"
                      : d.delMes
                        ? "text-fg hover:bg-accent"
                        : "text-fg-faint hover:bg-accent",
                )}
              >
                {d.dia}
              </button>
            )
          })}
        </div>
      </section>

      {/* ── QUÉ CALENDARIOS SE VEN ──────────────────────────────────────────────────────────────
          Una casilla por veterinario. Es el equivalente de la «lista de calendarios» de cualquier
          agenda: con cuatro vets, la semana completa es ilegible y esto es lo que deja mirar de a
          uno sin perder el resto.

          NO SE MUESTRA CON UN SOLO VETERINARIO: una lista de una casilla que no puede desmarcarse
          sin vaciar la pantalla es un control que sólo ocupa lugar. */}
      {vets.length > 1 && (
        <section>
          <p className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-fg-faint uppercase">
            Calendarios
          </p>
          <ul className="flex flex-col gap-0.5">
            {vets.map((v) => {
              const visible = vetsVisibles === null || vetsVisibles.has(v.id)
              return (
                <li key={v.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-[13px] hover:bg-accent/50">
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={() => onAlternarVet(v.id)}
                      className="size-3.5 shrink-0 accent-[var(--color-brand)]"
                    />
                    <span className={cn("truncate", visible ? "text-fg" : "text-fg-faint")}>
                      {v.label}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </aside>
  )
}
