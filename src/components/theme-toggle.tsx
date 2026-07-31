"use client"

import { useTheme } from "next-themes"
import { MoonIcon, SunIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

// Sin bandera `mounted`: los dos iconos se renderizan siempre y CSS decide cuál se ve, con la
// variante `dark:` de `globals.css`. El servidor y el cliente emiten el mismo HTML, así que no hay
// desajuste de hidratación — y como el script anti-FOUC de `layout.tsx` ya puso la clase `.dark`
// en <html> antes de pintar, el icono correcto aparece de una, sin parpadeo.
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      title="Cambiar entre modo claro y oscuro"
    >
      <SunIcon className="dark:hidden" />
      <MoonIcon className="hidden dark:block" />
      <span className="sr-only">Cambiar entre modo claro y oscuro</span>
    </Button>
  )
}
