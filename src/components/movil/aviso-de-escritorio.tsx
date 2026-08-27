"use client"

// El aviso que hace honesto al alcance lite: cuando la app INSTALADA abre una sección que quedó
// fuera, lo dice — con la razón — en vez de dejar que la pantalla se vea apretada y parezca rota.
//
// ── POR QUÉ NO SE BLOQUEA LA SECCIÓN ────────────────────────────────────────────────────────────
//
// Esconder o bloquear sería mentir en la otra dirección: la sección FUNCIONA, sólo que mal en
// 390 px. Un vet que necesita mirar un número de factura desde el teléfono puede; el aviso le dice
// que el trabajo de verdad se hace en el computador y por qué. Informar sin impedir.
//
// ── POR QUÉ SÓLO EN LA APP INSTALADA ────────────────────────────────────────────────────────────
//
// En el navegador del teléfono la página es la misma de siempre y nadie prometió un alcance: el
// aviso ahí sería ruido. El alcance lite es una promesa DE LA APP INSTALADA, así que el aviso vive
// donde vive la promesa (`display-mode: standalone`).
//
// Se monta UNA vez en el layout del dashboard — la lista de secciones excluidas es de
// `lib/movil/lite.ts` y decide por ruta; agregar una exclusión no toca este archivo.

import { usePathname } from "next/navigation"
import { MonitorSmartphone } from "lucide-react"

import { useEsInstalada } from "@/hooks/use-standalone"
import { exclusionDe } from "@/lib/movil/lite"

export function AvisoDeEscritorio() {
  const pathname = usePathname()
  const instalada = useEsInstalada()

  const exclusion = instalada ? exclusionDe(pathname) : null
  if (!exclusion) return null

  return (
    <div className="flex items-start gap-2.5 border-b border-line bg-surface-2 px-4 py-2.5 text-[13px] text-fg-muted">
      <MonitorSmartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <b className="font-medium text-fg">{exclusion.nombre}</b> — {exclusion.razon}
      </p>
    </div>
  )
}
