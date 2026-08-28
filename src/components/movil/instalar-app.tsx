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
//
// ── LO QUE SE AFINÓ EL 27-AGO («no es claro aún», Felipe) ──────────────────────────────────────
//
// Tres cosas rompían las instrucciones ANTES de que el vet llegara al paso 2, y ninguna se decía:
//
//   1. EMPEZABAN MANDÁNDOLO A ABRIR LA URL EN LA QUE YA ESTABA. «Abrí tuvetia.vercel.app» leído
//      desde el teléfono, dentro de la app, es una instrucción que ya está cumplida — y leerla
//      hace dudar de si uno está en el lugar correcto. Ahora el primer paso sólo existe cuando de
//      verdad hace falta.
//   2. EN iPHONE, FUERA DE SAFARI NO HAY NADA QUE HACER, y eso viajaba entre paréntesis en el
//      primer paso. Un vet en Chrome de iPhone seguía los tres pasos, no encontraba «Añadir a
//      pantalla de inicio» —porque ahí no existe— y concluía que la app no funciona. Ahora se
//      detecta y se dice ARRIBA, antes de los pasos.
//   3. NADIE CONTABA QUÉ PASA DESPUÉS DE INSTALAR. Al abrir el icono la app pide entrar otra vez,
//      con un código de seis dígitos que llega por correo. Sin avisarlo, eso se lee como que la
//      instalación falló.
//
// Y desde el computador —que es donde el vet suele estar leyendo Configuración— la tarjeta ya no
// da pasos que no puede seguir: muestra un QR para saltar al teléfono. El `qrcode` lo genera el
// SERVIDOR y baja como SVG, así que la librería no entra al bundle del cliente.

import { useEffect, useState, useSyncExternalStore } from "react"
import { AlertTriangle, CheckCircle2, Share, Smartphone } from "lucide-react"

import { useEsInstalada } from "@/hooks/use-standalone"
import { ALCANCE_LITE, FUERA_DEL_LITE } from "@/lib/movil/lite"
import { Button } from "@/components/ui/button"

type EventoInstalar = Event & { prompt: () => Promise<void> }

/** Qué teléfono, y en iPhone además QUÉ navegador — porque fuera de Safari no se puede instalar. */
type Plataforma = "ios-safari" | "ios-otro" | "android" | "escritorio"

function detectarPlataforma(): Plataforma {
  const ua = navigator.userAgent
  // iPadOS se hace pasar por Mac desde hace años; el touch lo delata.
  const esIOS =
    /iPhone|iPod/.test(ua) || (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  if (esIOS) {
    // En iOS TODOS los navegadores usan WebKit, así que Chrome y Firefox también dicen "Safari" en
    // su UA. Lo que los distingue es su propia marca: CriOS (Chrome), FxiOS (Firefox), EdgiOS, OPT.
    // Sin esta comprobación, un vet en Chrome de iPhone recibe pasos que no puede seguir.
    return /CriOS|FxiOS|EdgiOS|OPT\//.test(ua) ? "ios-otro" : "ios-safari"
  }
  if (/Android/.test(ua)) return "android"
  return "escritorio"
}

// La plataforma no cambia durante la vida de la página: `useSyncExternalStore` con suscripción
// vacía es la forma sin-efecto de leerla una vez en cliente y dar el caso neutro en SSR.
const sinCambios = () => () => {}
function usePlataforma(): Plataforma {
  return useSyncExternalStore(sinCambios, detectarPlataforma, () => "escritorio" as const)
}

/** Un paso con su detalle: el detalle es lo que evita el «¿y dónde está ese botón?». */
type Paso = { hacer: string; donde?: string }

const PASOS: Record<Exclude<Plataforma, "escritorio" | "ios-otro">, Paso[]> = {
  "ios-safari": [
    {
      hacer: "Tocá el botón Compartir.",
      donde: "Es el cuadrado con una flecha hacia arriba, en la barra de ABAJO de Safari. Si no la ves, tocá una vez el borde inferior para que aparezca.",
    },
    {
      hacer: "Deslizá hacia arriba en la lista y elegí «Añadir a pantalla de inicio».",
      donde: "Está bastante abajo, después de las opciones de compartir. El icono es un cuadrado con un +.",
    },
    {
      hacer: "Tocá «Añadir», arriba a la derecha.",
      donde: "El icono de Tuvetia queda entre tus apps, como cualquier otra.",
    },
  ],
  android: [
    {
      hacer: "Tocá el menú ⋮ de Chrome.",
      donde: "Tres puntos verticales. Según la versión está arriba a la derecha o abajo a la derecha.",
    },
    {
      hacer: "Elegí «Instalar aplicación» o «Añadir a pantalla de inicio».",
      donde: "Aparece una u otra según la versión de Chrome; las dos hacen lo mismo.",
    },
    { hacer: "Confirmá con «Instalar»." },
  ],
}

export function InstalarApp({ qrSvg }: { qrSvg?: string | null }) {
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

  const intro = (
    <p className="text-sm text-muted-foreground">
      Llevá Tuvetia en el teléfono como una app: tu agenda, tus pacientes y VetGPT, con tu misma
      cuenta. Grabar consultas y facturar quedan en el computador.
    </p>
  )

  // ── DESDE EL COMPUTADOR: no se puede instalar acá, así que no se dan pasos ────────────────────
  // Es el caso MÁS común, porque Configuración se lee sentado. Antes recibía unos pasos genéricos
  // que no podía seguir en esa pantalla; ahora recibe la única acción que sirve: pasar al teléfono.
  if (plataforma === "escritorio") {
    return (
      <div className="flex flex-col gap-3">
        {intro}
        <div className="flex flex-wrap items-start gap-4 rounded-lg border border-line bg-surface-2 p-3">
          {qrSvg && (
            <div
              className="size-28 shrink-0 rounded-md bg-white p-1.5 [&>svg]:size-full"
              aria-hidden
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          )}
          <div className="min-w-0 flex-1 text-sm text-muted-foreground">
            <p className="font-medium text-fg">Esto se instala desde el teléfono.</p>
            <p className="mt-1">
              {qrSvg
                ? "Escaneá el código con la cámara, entrá con tu cuenta y volvé a esta misma pantalla desde el teléfono: ahí van a aparecer los pasos de tu modelo."
                : "Abrí Tuvetia en el navegador del teléfono, entrá con tu cuenta y volvé a esta pantalla: ahí van a aparecer los pasos de tu modelo."}
            </p>
            <p className="mt-2">
              En <b>iPhone tiene que ser Safari</b>; en Android, Chrome. En otros navegadores la
              opción de instalar no existe.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── iPHONE FUERA DE SAFARI: no hay pasos que dar, y decirlo es el arreglo ─────────────────────
  // En iOS la instalación es una función de Safari, no del sistema. Chrome y Firefox de iPhone
  // usan WebKit por dentro pero NO exponen «Añadir a pantalla de inicio». Antes esto viajaba entre
  // paréntesis en el paso 1 y el vet lo descubría fallando.
  if (plataforma === "ios-otro") {
    return (
      <div className="flex flex-col gap-3">
        {intro}
        <div className="flex items-start gap-2 rounded-lg border border-warn bg-warn-soft px-3 py-2.5 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <b className="font-semibold">Estás en un navegador que no puede instalar apps.</b> En
            iPhone sólo Safari tiene «Añadir a pantalla de inicio» — no es una limitación de
            Tuvetia, es de iOS. Abrí esta misma página en <b>Safari</b> y los pasos aparecen acá.
          </span>
        </div>
      </div>
    )
  }

  const pasos = PASOS[plataforma]

  return (
    <div className="flex flex-col gap-3">
      {intro}

      {prompt ? (
        // Android con Chrome: instala de una. Los pasos quedan como respaldo visible igual — si el
        // diálogo del sistema se cierra sin querer, no hay que volver a buscar cómo se hacía.
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

      {plataforma === "ios-safari" && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Share className="size-3.5 shrink-0" aria-hidden />
          Estás en Safari, que es el que puede hacerlo.
        </p>
      )}

      {/* Cada paso con su «dónde». El paso solo dice QUÉ tocar; el detalle dice DÓNDE está, que es
          lo que faltaba: «el botón Compartir» no ayuda a quien no sabe cuál es. */}
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
        {pasos.map((p) => (
          <li key={p.hacer}>
            <span className="text-fg">{p.hacer}</span>
            {p.donde && <span className="mt-0.5 block text-muted-foreground">{p.donde}</span>}
          </li>
        ))}
      </ol>

      {/* ── QUÉ PASA DESPUÉS, que era el hueco más grande ──────────────────────────────────────
          La app instalada abre en su propia sesión: no hereda la del navegador. Sin avisarlo, el
          vet abre el icono, se encuentra con la pantalla de entrar, y lo lee como que la
          instalación no sirvió. */}
      <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
        <b className="text-fg">Al abrir el icono la primera vez</b> te va a pedir entrar de nuevo:
        escribí tu correo y te llega un código de seis dígitos. Es una sola vez — después queda
        abierta.
      </p>
    </div>
  )
}
