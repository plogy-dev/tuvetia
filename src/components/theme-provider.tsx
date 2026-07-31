"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"

// El modo oscuro existía a medias: `globals.css` tiene la paleta `.dark` completa y `layout.tsx`
// trae un script anti-FOUC que lee `localStorage['tuvetia-theme']`… pero NADIE escribía esa clave,
// así que no había forma de llegar al modo oscuro desde la interfaz. `ui/sonner.tsx` ya llamaba a
// `useTheme()` sin que hubiera un provider montado.
//
// `storageKey` tiene que coincidir con el del script de `layout.tsx`, y `enableSystem={false}` es
// deliberado: con "system" el valor guardado sería la cadena "system", el script no la reconoce y
// un usuario con el sistema en oscuro vería un destello claro antes de hidratar. Con dos estados
// explícitos el script acierta siempre y no hay parpadeo.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      storageKey="tuvetia-theme"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
