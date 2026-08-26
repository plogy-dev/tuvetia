"use client"

// Tour guiado de bienvenida (una sola vez por usuario) con driver.js. Resalta las secciones
// principales del sidebar con globos explicativos. Se marca `onboarded` al terminar o cerrar, así
// no vuelve a aparecer. Para usuarios no técnicos: complementa los marcadores "?" (HelpTip).

import { useEffect } from "react"

import { createClient } from "@/lib/supabase/client"

// Flag "ya se mostró" por navegador. Es el guard robusto: evita que el tour reaparezca al cambiar de
// página aunque el layout se re-monte o el flag del server (`onboarded`) llegue tarde. El RPC
// mark_onboarded persiste además entre dispositivos.
const SEEN_KEY = "tuvetia_onboarding_seen"

// Guard EN VUELO, a nivel de módulo (no de componente, para que sobreviva a un re-montaje del
// layout). Reemplaza al truco de marcar el localStorage antes de arrancar: aquel evitaba el tour
// duplicado, sí, pero al precio de gastar el único intento aunque el tour nunca llegara a verse.
// Éste cubre lo mismo sin ese costo — mientras uno corre, otro montaje no lanza un segundo.
let tourEnMarcha = false

export function OnboardingTour({ onboarded }: { onboarded: boolean }) {
  useEffect(() => {
    if (onboarded) return
    if (typeof window === "undefined") return
    if (localStorage.getItem(SEEN_KEY)) return
    if (tourEnMarcha) return
    // El tour resalta el sidebar (visible en desktop). En pantallas chicas el sidebar está colapsado,
    // así que lo diferimos al próximo ingreso desde desktop (sin marcar el flag todavía).
    if (window.innerWidth < 1024) return

    // NO se marca todavía. Marcar antes de arrancar gastaba el único intento aunque el tour no
    // llegara a verse: si driver.js fallaba al cargar, si el usuario cerraba la pestaña, o si el
    // montaje se cancelaba, el flag quedaba puesto y el tour no volvía nunca. Medido en producción
    // el 2026-07-31: `onboarded_at` era NULL en 14 de 14 perfiles — o sea, nadie lo completó jamás.
    // Ahora se marca junto con el RPC, cuando el tour de verdad terminó o el usuario lo cerró.

    tourEnMarcha = true

    // driver.js (+CSS) se carga recién acá: el tour corre UNA vez por navegador, pero el import
    // estático metía su bundle en el JS compartido de todo /dashboard para siempre.
    let cancelled = false
    void (async () => {
      const [{ driver }] = await Promise.all([
        import("driver.js"),
        import("driver.js/dist/driver.css"),
      ])
      if (cancelled) {
        tourEnMarcha = false // se desmontó mientras cargaba driver.js: liberar el guard
        return
      }

      const supabase = createClient()
      // Se dispara al terminar el tour O al cerrarlo (`onDestroyed`), que es cuando de verdad ya se
      // vio. El localStorage es el guard inmediato (no depende de la red); el RPC lo persiste entre
      // dispositivos. Si el RPC falla, el flag local igual evita repetirlo en este navegador, pero
      // el error se registra en vez de descartarse: antes era `void supabase.rpc(...)` y un fallo
      // de permisos o de red se perdía en silencio.
      let yaMarcado = false
      const markOnboarded = () => {
        if (yaMarcado) return // `onDestroyed` puede dispararse más de una vez
        yaMarcado = true
        tourEnMarcha = false
        localStorage.setItem(SEEN_KEY, "1")
        void supabase
          .rpc("mark_onboarded")
          .then(({ error }) => {
            if (error) console.warn("mark_onboarded falló:", error.message)
          })
      }

      const tour = driver({
      showProgress: true,
      allowClose: true,
      overlayColor: "rgba(0,0,0,0.6)",
      nextBtnText: "Siguiente",
      prevBtnText: "Anterior",
      doneBtnText: "Listo",
      progressText: "{{current}} de {{total}}",
      steps: [
        {
          popover: {
            title: "Bienvenido a Tuvetia 🐾",
            description:
              "Un recorrido de 30 segundos por lo principal. Podés cerrarlo cuando quieras y retomar con el ‘?’ de cada sección.",
          },
        },
        {
          element: 'a[href="/dashboard/patients"]',
          popover: {
            title: "Pacientes",
            description:
              "Las fichas de tus pacientes: historia clínica, alergias, vacunas, y las consultas con su transcripción y audio.",
          },
        },
        {
          element: 'a[href="/dashboard/consultas"]',
          popover: {
            title: "Modo Fantasma",
            description:
              "Grabás la consulta (con consentimiento del titular) y VetGPT redacta la nota SOAP con literatura veterinaria citada. Vos revisás y aprobás.",
          },
        },
        {
          element: 'a[href="/dashboard/asistente"]',
          popover: {
            title: "Copiloto",
            description:
              "Preguntale a VetGPT lo que quieras: responde con literatura citada y verificable, nunca inventa fuentes.",
          },
        },
        {
          element: 'a[href="/dashboard/calendario"]',
          popover: {
            title: "Agenda",
            description:
              "Tu agenda de citas: crear, mover y editar. Se puede sincronizar con Google Calendar o compartir por un enlace.",
          },
        },
        {
          popover: {
            title: "¿Dudas? Buscá el ‘?’",
            description:
              "En cada sección hay un ‘?’ con una explicación corta. ¡Listo para empezar!",
          },
        },
      ],
        onDestroyed: markOnboarded,
      })

      tour.drive()
    })()
    return () => {
      cancelled = true
    }
    // `onboarded` viene del server y puede llegar tarde; el resto de los guards (localStorage y
    // `tourEnMarcha`) cubren el re-disparo.
  }, [onboarded])

  return null
}
