"use client"

// La ventana que le pide el calendario a quien todavía no lo conectó, al entrar a la agenda.
//
// POR QUÉ ACÁ Y NO EN INTEGRACIONES. Porque nadie va a Integraciones a resolver un problema que no
// sabe que tiene. El síntoma —"agendé la cita y no me apareció en el teléfono"— se siente en la
// agenda, y hasta ahora la única señal era un toast que salía DESPUÉS de guardar una cita, cuando
// ya era tarde y con una explicación que había que ir a aplicar a otra pantalla.
//
// ── LAS TRES COSAS QUE NO HACE, Y SON LAS QUE LA HACEN TOLERABLE ────────────────────────────────
//
//   1. NO BLOQUEA. Se cierra con la X, con Escape y con "Ahora no". Una agenda que no se puede leer
//      hasta conectar una cuenta de Google es peor que una agenda sin sincronizar.
//   2. NO INSISTE EN CADA NAVEGACIÓN. "Ahora no" la calla por el resto del día. Vuelve mañana
//      porque el problema sigue existiendo, pero preguntar una vez por día es un recordatorio y
//      preguntar en cada clic es una pared.
//   3. NO APARECE SI NO SE PUEDE CONECTAR. Si este despliegue no tiene Composio configurado, pedir
//      que conecten algo que el servidor no ofrece sería mandar a alguien a buscar un botón que no
//      existe.
//
// EL BOTÓN CONECTA DE UNA VEZ: va directo al consentimiento del proveedor y vuelve ACÁ, no a
// Integraciones. Mandarlo a otra pantalla a buscar el mismo botón era el viaje que esta ventana
// viene a eliminar.

import { useState, useSyncExternalStore } from "react"
import { CalendarPlus, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  NOMBRE_DEL_CALENDARIO,
  useConexionDeCalendario,
  useVueltaDeLaConexion,
} from "@/components/settings/conectar-calendario"

/** Un día, en la clave: el valor guardado es la fecha, así que mañana ya no coincide. */
const CLAVE_POSPUESTO = "tuvetia:aviso-calendario-pospuesto"

function hoy(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── Leer `localStorage` sin romper la hidratación ───────────────────────────────────────────────
//
// `localStorage` no existe en el servidor, así que esto no puede calcularse al renderizar: el HTML
// del servidor diría una cosa y el del cliente otra. Y tampoco puede resolverse con un `useEffect`
// que llame a `setState` — React 19 lo marca como error (renders en cascada), y con razón.
//
// `useSyncExternalStore` es exactamente para esto: se le da un valor para el servidor y otro para el
// cliente, y React re-renderiza después de hidratar. El del servidor es `true` —"dalo por
// pospuesto"— porque así el diálogo sale cerrado del servidor y aparece recién cuando el navegador
// pudo mirar de verdad. Al revés parpadearía abierto y se cerraría solo.
//
// No hay suscripción real: nadie escribe esta clave desde otra pestaña mientras esta ventana decide
// si abrirse, así que la función de baja no tiene nada que dar de baja.
const SIN_SUSCRIPCION = () => () => {}

function seRechazoHoy(): boolean {
  try {
    return window.localStorage.getItem(CLAVE_POSPUESTO) === hoy()
  } catch {
    // Modo incógnito o almacenamiento bloqueado. Se pregunta igual: perder el "ahora no" es
    // molesto, no mostrar nunca el aviso es el defecto que esto vino a arreglar.
    return false
  }
}

export function AvisoConectarCalendario({
  conectado,
  esAdmin,
}: {
  conectado: boolean
  /** Cambia el texto, no el comportamiento: al admin le llegan además las citas de todo el equipo. */
  esAdmin: boolean
}) {
  const [cerrado, setCerrado] = useState(false)
  const rechazadoHoy = useSyncExternalStore(SIN_SUSCRIPCION, seRechazoHoy, () => true)
  const { disponibles, conectando, conectar } = useConexionDeCalendario("/dashboard/calendario")
  useVueltaDeLaConexion()

  function posponer() {
    setCerrado(true)
    try {
      window.localStorage.setItem(CLAVE_POSPUESTO, hoy())
    } catch {
      // Sin almacenamiento vuelve a preguntar en la próxima visita. Es el peor caso y es aceptable.
    }
  }

  // `disponibles === null` es "todavía no sé": se espera antes de abrir nada. `[]` es "este servidor
  // no tiene calendario configurado", y ahí no hay nada que pedir.
  if (conectado || !disponibles?.length) return null
  const abierto = !rechazadoHoy && !cerrado

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && posponer()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-brand-soft">
            <CalendarPlus className="size-5 text-brand-text" aria-hidden />
          </div>
          <DialogTitle>Conectá tu calendario</DialogTitle>
          <DialogDescription>
            {esAdmin ? (
              <>
                Como administrador te llegan <b>todas las citas de la clínica</b> al calendario, con
                el titular invitado. Mientras no conectes uno, la agenda vive sólo en Tuvetia: nadie
                recibe invitación y no la vas a ver en el teléfono.
              </>
            ) : (
              <>
                Las citas que te asignen se crean en <b>tu</b> calendario, con el titular y los
                administradores invitados. Mientras no conectes uno, tu agenda vive sólo en Tuvetia:
                no la vas a ver en el teléfono ni te va a avisar antes de cada cita.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* La letra chica CON MARCO. Suelta entre la descripción y los botones parecía un
            segundo párrafo del mismo texto y competía con él; encerrada se lee por lo que es: la
            aclaración de privacidad que responde «¿y qué va a ver de mi calendario?». */}
        <p className="mt-4 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] leading-relaxed text-fg-muted">
          Tuvetia sólo <b>escribe</b> sus citas: nunca lee tus eventos ni los trae a la clínica.
        </p>

        {/* APILADOS Y NO EN FILA, y es lo que estaba roto. `DialogFooter` alinea a la derecha en
            una fila, y acá van «Conectar Google Calendar» + «Conectar Outlook Calendar» + «Ahora
            no» dentro de un diálogo de 448px: no entran, la fila se desbordaba y el «Ahora no»
            quedaba cortado afuera. O sea que la única salida visible del modal era la X.

            Apilados entran enteros, y además es la forma correcta para lo que esto es: una ELECCIÓN
            entre dos opciones equivalentes. Uno al lado del otro, dos botones del mismo verde se
            leen como «acción principal y acción secundaria», y acá ninguno lo es. */}
        <DialogFooter className="mt-5 flex-col gap-2 sm:flex-col">
          {disponibles.map((p) => (
            <Button
              key={p}
              variant="outline"
              className="w-full justify-start"
              onClick={() => conectar(p)}
              disabled={conectando !== null}
            >
              {conectando === p ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <CalendarPlus className="size-4 text-brand-text" aria-hidden />
              )}
              Conectar {NOMBRE_DEL_CALENDARIO[p]}
            </Button>
          ))}
          {/* Debajo y en ghost: es la salida, no una tercera opción a la par de las otras dos. */}
          <Button
            variant="ghost"
            className="w-full text-fg-muted"
            onClick={posponer}
            disabled={conectando !== null}
          >
            Ahora no
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
