"use client"

// La tarjeta que enseña a instalar Tuvetia en el teléfono, en Configuración → Cuenta.
//
// ── PASOS DISTINTOS POR PLATAFORMA, Y NO ES UN DETALLE ──────────────────────────────────────────
//
// En iPhone la instalación vive en el botón Compartir de Safari; en Android, en el menú ⋮ de
// Chrome. Unos pasos genéricos («busca la opción de instalar en tu navegador») hacen que el vet no
// encuentre el botón y abandone — la detección por userAgent existe para darle LOS pasos de SU
// teléfono, no una aproximación.
//
// En Android además se engancha `beforeinstallprompt`: si el navegador lo ofrece, aparece un botón
// que instala de una, sin pasos. En iOS ese evento no existe y no va a existir — ahí los pasos son
// la única vía, por eso no se esconden nunca detrás del botón.
//
// Si la app YA corre instalada (`display-mode: standalone`), repetir los pasos sería ruido: la
// tarjeta pasa a confirmar y a decir qué alcanza y qué no (el alcance viene de `lib/movil/lite.ts`
// — la lista es UNA, no una copia acá).

import { useEffect, useState, useSyncExternalStore } from "react"
import { CheckCircle2, Smartphone } from "lucide-react"

import { useEsInstalada } from "@/hooks/use-standalone"
import { ALCANCE_LITE, FUERA_DEL_LITE } from "@/lib/movil/lite"
import { Button } from "@/components/ui/button"

type EventoInstalar = Event & { prompt: () => Promise<void> }

type Plataforma = "ios" | "android" | "otra"

function detectarPlataforma(): Plataforma {
  const ua = navigator.userAgent
  // iPadOS se hace pasar por Mac desde hace años; el touch lo delata.
  if (/iPhone|iPod/.test(ua) || (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1))
    return "ios"
  if (/Android/.test(ua)) return "android"
  return "otra"
}

const PASOS: Record<Plataforma, string[]> = {
  ios: [
    "Abrí tuvetia.vercel.app en Safari (en otro navegador la opción no aparece).",
    "Tocá el botón Compartir — el cuadrado con la flecha hacia arriba.",
    "Bajá y elegí «Añadir a pantalla de inicio», y confirmá.",
  ],
  android: [
    "Abrí tuvetia.vercel.app en Chrome.",
    "Tocá el menú ⋮ de arriba a la derecha.",
    "Elegí «Instalar aplicación» (o «Añadir a pantalla de inicio»), y confirmá.",
  ],
  // Desde el computador la tarjeta igual informa: es donde el vet está leyendo Configuración.
  otra: [
    "Abrí tuvetia.vercel.app en el navegador de tu teléfono (Safari en iPhone, Chrome en Android).",
    "Buscá «Añadir a pantalla de inicio» o «Instalar aplicación» en el menú del navegador.",
  ],
}

// La plataforma no cambia durante la vida de la página: `useSyncExternalStore` con suscripción
// vacía es la forma sin-efecto de leerla una vez en cliente y dar "otra" en SSR.
const sinCambios = () => () => {}
function usePlataforma(): Plataforma {
  return useSyncExternalStore(sinCambios, detectarPlataforma, () => "otra" as const)
}

export function InstalarApp() {
  const plataforma = usePlataforma()
  const instalada = useEsInstalada()
  const [prompt, setPrompt] = useState<EventoInstalar | null>(null)

  useEffect(() => {
    const alOfrecer = (e: Event) => {
      // Chrome lo dispara cuando la app es instalable; retenerlo permite ofrecer NUESTRO botón.
      e.preventDefault()
      setPrompt(e as EventoInstalar)
    }
    window.addEventListener("beforeinstallprompt", alOfrecer)
    return () => window.removeEventListener("beforeinstallprompt", alOfrecer)
  }, [])

  if (instalada) {
    return (
      <div className="flex flex-col gap-2.5">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <CheckCircle2 className="size-4 text-ok" aria-hidden />
          Estás usando la app instalada.
        </p>
        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-muted-foreground">
          {ALCANCE_LITE.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        {/* Las exclusiones se DICEN, con su razón — es todo el punto de `lib/movil/lite.ts`:
            lo que desaparece sin explicación se lee como roto. */}
        {FUERA_DEL_LITE.map((e) => (
          <p key={e.nombre} className="text-sm text-muted-foreground">
            <b>{e.nombre}:</b> {e.razon}
          </p>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Llevá Tuvetia en el teléfono como una app: tu agenda, tus pacientes y VetGPT, con tu misma
        cuenta. Grabar consultas y facturar quedan en el computador.
      </p>

      {prompt ? (
        // Android con Chrome: instala de una. Los pasos quedan como respaldo visible igual.
        <Button
          className="w-fit"
          onClick={() => {
            void prompt.prompt()
            setPrompt(null)
          }}
        >
          <Smartphone className="size-4" aria-hidden /> Instalar en este teléfono
        </Button>
      ) : null}

      <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
        {PASOS[plataforma].map((paso) => (
          <li key={paso}>{paso}</li>
        ))}
      </ol>
    </div>
  )
}
