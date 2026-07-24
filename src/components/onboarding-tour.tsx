"use client"

// Tour guiado de bienvenida (una sola vez por usuario) con driver.js. Resalta las secciones
// principales del sidebar con globos explicativos. Se marca `onboarded` al terminar o cerrar, así
// no vuelve a aparecer. Para usuarios no técnicos: complementa los marcadores "?" (HelpTip).

import { useEffect, useRef } from "react"
import { driver } from "driver.js"

import "driver.js/dist/driver.css"

import { createClient } from "@/lib/supabase/client"

export function OnboardingTour({ onboarded }: { onboarded: boolean }) {
  const started = useRef(false)

  useEffect(() => {
    if (onboarded || started.current) return
    // El tour resalta elementos del sidebar (visible en desktop). En pantallas chicas el sidebar está
    // colapsado tras un botón, así que lo diferimos: se mostrará en el próximo ingreso desde desktop.
    if (typeof window !== "undefined" && window.innerWidth < 1024) return
    started.current = true

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
