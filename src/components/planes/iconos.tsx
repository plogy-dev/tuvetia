"use client"

import {
  Bot,
  Camera,
  Calendar,
  Check,
  Download,
  Ghost,
  LayoutDashboard,
  MessageCircle,
  MessagesSquare,
  PawPrint,
  Receipt,
  Sparkles,
  Sunrise,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react"

// Los iconos de las listas de planes, resueltos por nombre.
//
// POR QUÉ UN MAPA EXPLÍCITO Y NO UN IMPORT DINÁMICO. `lib/planes/index.ts` es un archivo de datos
// puros que no puede importar React —lo consumen las rutas de API y el servidor—, así que ahí los
// iconos son cadenas. Acá se traducen.
//
// El mapa se escribe a mano, con los quince iconos nombrados uno por uno, para que el empaquetador
// meta en el bundle sólo esos y no la librería entera. Un `import(\`lucide-react/\${nombre}\`)`
// funcionaría y arrastraría más de mil iconos al navegador.

const ICONOS: Record<string, LucideIcon> = {
  Bot,
  Camera,
  Calendar,
  Download,
  Ghost,
  LayoutDashboard,
  MessageCircle,
  MessagesSquare,
  PawPrint,
  Receipt,
  Sparkles,
  Sunrise,
  Users,
  Wallet,
}

/**
 * El icono de un bullet.
 *
 * Cae a un tilde cuando el nombre no está en el mapa: un bullet sin icono descuadra la fila y se
 * ve como un error, mientras que un tilde se lee como "incluido" y es lo que la lista quiere decir
 * de todos modos.
 */
export function IconoDeBullet({ nombre, className }: { nombre: string; className?: string }) {
  const Icono = ICONOS[nombre] ?? Check
  return <Icono className={className} aria-hidden />
}
