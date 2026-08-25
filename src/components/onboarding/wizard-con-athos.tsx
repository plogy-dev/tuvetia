"use client"

// Sostiene el ÚNICO estado que la página no puede sostener: en qué paso va el wizard.
//
// Existe por el pedido de la reunión del 24-ago ("que ese Athos que acompaña acompañe de verdad"):
// el panel de Athos muestra una tarjeta fija según el paso ACTUAL, y para eso el paso tiene que
// vivir en un componente cliente que sea padre de ambos — `bienvenida/page.tsx` es Server
// Component y no puede tener estado. Este wrapper es mínimo a propósito: un número y dos hijos;
// el layout (la grilla) sigue siendo de la página.

import { useState } from "react"

import { OnboardingAthos } from "@/components/onboarding/onboarding-athos"
import { WelcomeWizard, type YaHecho } from "@/components/onboarding/welcome-wizard"
import type { Plan } from "@/lib/planes"

export function WizardConAthos({
  clinicId,
  clinicName,
  logoUrl,
  plan,
  yaHecho,
}: {
  clinicId: string
  clinicName: string
  logoUrl: string | null
  plan: Plan
  yaHecho: YaHecho
}) {
  const [paso, setPaso] = useState(0)

  // Fragment a propósito: los dos divs quedan como hijos DIRECTOS del <main> con la grilla,
  // exactamente igual que cuando los renderizaba la página. Meterlos en un div rompería las
  // columnas.
  return (
    <>
      <div className="flex w-full max-w-md flex-col justify-center justify-self-center">
        <WelcomeWizard
          clinicId={clinicId}
          initialClinicName={clinicName}
          initialLogoUrl={logoUrl}
          yaHecho={yaHecho}
          onPasoChange={setPaso}
        />
      </div>
      {/* El panel de Athos es acompañamiento, no camino crítico: en pantallas chicas se oculta y el
          wizard funciona igual. Si Athos falla o tarda, el onboarding no se bloquea. */}
      <div className="hidden min-h-0 lg:block">
        <OnboardingAthos clinicName={clinicName} plan={plan} paso={paso} />
      </div>
    </>
  )
}
