import { CanalTabs } from "@/components/comunicaciones/canal-tabs"

// Comunicaciones pasa a tener dos canales: WhatsApp y Correo. Cada uno con su propia URL —la regla
// de `ui/tab-nav` para pestañas que se comparten o se vuelven con el botón atrás— así que el layout
// solo pinta la navegación y deja que cada página cargue lo suyo en el servidor.

export const metadata = { title: "Comunicaciones · Tuvetia" }

export default function ComunicacionesLayout({ children }: { children: React.ReactNode }) {
  return (
    // ── ESTE LAYOUT TIENE QUE PASAR EL ALTO, Y NO LO HACÍA ───────────────────────────────────────
    //
    // Las dos bandejas y el skeleton abren con `grid min-h-0 flex-1`, o sea que su alto lo tiene que
    // dar el padre. Acá había un `flex flex-col` pelado: alto `auto`, decidido por el contenido. Con
    // eso el `flex-1` de las bandejas no acotaba nada y los cuatro `overflow-y-auto` de adentro
    // —lista de conversaciones e hilo, en WhatsApp y en Correo— nunca se activaban: con treinta
    // conversaciones el panel maestro crecía sin techo y el compositor quedaba hundido cientos de
    // píxeles abajo. La bandeja de dos paneles dejaba de ser de dos paneles.
    //
    // Lo introduje yo el 27-ago al quitarles el `h-[calc(100svh-…)]` que traían. El `calc` funcionaba
    // PESE al padre; `flex-1` DEPENDE del padre. La corrección va acá y no devolviendo los `calc`,
    // porque el alto es responsabilidad del layout y así sirve para las dos pantallas y el skeleton.
    //
    // `min-h-0` es la otra mitad: en una columna flex un hijo con `flex-1` no baja de su contenido
    // salvo que se le diga. Es el mismo par que usa `dashboard/layout.tsx` en su contenedor de scroll.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pt-4 lg:px-6">
        <CanalTabs />
      </div>
      {children}
    </div>
  )
}
