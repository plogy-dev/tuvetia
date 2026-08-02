import { CanalTabs } from "@/components/comunicaciones/canal-tabs"

// Comunicaciones pasa a tener dos canales: WhatsApp y Correo. Cada uno con su propia URL —la regla
// de `ui/tab-nav` para pestañas que se comparten o se vuelven con el botón atrás— así que el layout
// solo pinta la navegación y deja que cada página cargue lo suyo en el servidor.

export const metadata = { title: "Comunicaciones · Tuvetia" }

export default function ComunicacionesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="px-4 pt-4 lg:px-6">
        <CanalTabs />
      </div>
      {children}
    </div>
  )
}
