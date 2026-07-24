"use client"

// Marcador de ayuda "?" contextual. Un iconito junto a una funcionalidad que, al pasar el mouse o
// enfocar, muestra una explicación corta. Para usuarios no técnicos. Reutiliza el Tooltip del design
// system. Uso: <HelpTip>Explicación corta.</HelpTip>

import { HelpCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export function HelpTip({
  children,
  className,
  side = "top",
}: {
  children: React.ReactNode
  className?: string
  side?: "top" | "bottom" | "left" | "right"
}) {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Ayuda"
              className={cn(
                "inline-flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground",
                className,
              )}
            />
          }
        >
          <HelpCircle className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs text-left leading-relaxed">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
