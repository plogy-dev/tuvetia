"use client"

// Tour guiado de bienvenida (una sola vez por usuario) con driver.js. Resalta las secciones
// principales del sidebar con globos explicativos. Se marca `onboarded` al terminar o cerrar, así
// no vuelve a aparecer. Para usuarios no técnicos: complementa los marcadores "?" (HelpTip).

import { useEffect } from "react"
import { driver } from "driver.js"

import "driver.js/dist/driver.css"

import { createClient } from "@/lib/supabase/client"

// Flag "ya se mostró" por navegador. Es el guard robusto: evita que el tour reaparezca al cambiar de
// página aunque el layout se re-monte o el flag del server (`onboarded`) llegue tarde. El RPC
// mark_onboarded persiste además entre dispositivos.
const SEEN_KEY = "tuvetia_onboarding_seen"

export function OnboardingTour({ onboarded }: { onboarded: boolean }) {
  useEffect(() => {
    if (onboarded) return
    if (typeof window === "undefined") return
    if (localStorage.getItem(SEEN_KEY)) return
    // El tour resalta el sidebar (visible en desktop). En pantallas chicas el sidebar está colapsado,
    // así que lo diferimos al próximo ingreso desde desktop (sin marcar el flag todavía).
    if (window.innerWidth < 1024) return

    // Marca ANTES de arrancar -> a lo sumo un tour por navegador, pase lo que pase con el montaje.
    localStorage.setItem(SEEN_KEY, "1")

    const supabase = createClient()
    const markOnboarded = () => {
      void supabase.rpc("mark_onboarded")
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
            title: "Bienvenido a TuvetIA 🐾",
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
              "Grabás la consulta (con consentimiento del titular) y Athos redacta la nota SOAP con literatura veterinaria citada. Vos revisás y aprobás.",
          },
        },
        {
          element: 'a[href="/dashboard/asistente"]',
          popover: {
            title: "Copiloto",
            description:
              "Preguntale a Athos lo que quieras: responde con literatura citada y verificable, nunca inventa fuentes.",
          },
        },
        {
          element: 'a[href="/dashboard/calendario"]',
          popover: {
            title: "Calendario",
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
  }, [onboarded])

  return null
}
