import type { Metadata, Viewport } from "next";
import {
  Inter_Tight,
  Bricolage_Grotesque,
  JetBrains_Mono,
  Archivo,
  Instrument_Serif,
} from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";
import { getAppBaseUrl } from "@/lib/base-url";
import { cn } from "@/lib/utils";

// ── Fuentes de la APP ──
//
// SE CAMBIA LA REFERENCIA AL MOCKUP DE LUCIANO (19-ago), y el cambio de fondo es el TÍTULO: pasa de
// una serif (Newsreader) a una grotesca (Bricolage Grotesque). No es una variante del mismo tono —
// una serif de titular le da a la pantalla un aire editorial, de revista, y lo que el cliente pide
// es una herramienta de trabajo. Es la mitad de lo que se leía como "muy AI-based".
//
// La regla de reparto no cambia y sigue siendo la misma de siempre: display para títulos, sans para
// el cuerpo, y mono SÓLO para lo que se lee como dato (40.1 °C, $180.000) y no como texto.
//
//   · Inter Tight        — la UI operativa. Más angosta que Geist: entra más en la misma línea, que
//                          es justo lo que hace falta en tablas de facturación y listas de citas.
//   · Bricolage Grotesque — títulos y estados vacíos.
//   · JetBrains Mono     — valores clínicos, montos, cronómetros.
const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-inter-tight",
  display: "swap",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
});

// ── Fuentes de la landing de marketing (grupo (marketing)). Viven acá y no en
// el layout del grupo porque landing.css las referencia en reglas de <body>
// (var(--font-archivo) / --font-mono-landing / --font-serif) y las variables
// deben resolver a ese nivel.
//
// `--font-mono-landing` se llamaba `--font-mono` a secas. Se renombró porque la
// app pasó a Geist Mono y ese nombre lo define también `@theme inline` para la
// utilidad `font-mono`: mientras las dos resolvían a JetBrains la colisión era
// invisible, con dos fuentes distintas el ganador lo decidía el orden de
// inyección del CSS. La landing conserva JetBrains Mono, sin cambio visual.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-archivo",
  display: "swap",
});

const jetbrainsLanding = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-landing",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  // Sin `metadataBase`, toda URL relativa de Open Graph (la imagen incluida) se resuelve mal en
  // producción y la preview del enlace sale vacía. `getAppBaseUrl()` ya resuelve el origen —
  // NEXT_PUBLIC_APP_URL, y si no la URL que Vercel provee sola.
  metadataBase: new URL(getAppBaseUrl()),
  title: "Tuvetia",
  description: "Inteligencia artificial para veterinarias",
  // iOS ignora los `icons` del manifiesto para «Añadir a pantalla de inicio»: sin este PNG el
  // icono instalado es una captura de la página en un marco. Lo genera `scripts/generar-iconos.mjs`.
  icons: { apple: "/icons/apple-icon-180.png" },
};

// ── EL VIEWPORT QUE ENCIENDE CÓDIGO YA ESCRITO ────────────────────────────────────────────────
//
// `viewportFit: "cover"` no es cosmético: sin él, `env(safe-area-inset-*)` vale CERO siempre, y el
// repo ya tiene dos superficies que lo usan y hoy no hacen nada — la barra inferior del móvil
// (`tab-bar-movil.tsx`) y el dock de VetGPT (`athos-dock.tsx`). Esta línea es la que hace que en
// un iPhone instalado la barra no quede debajo del indicador de gestos.
//
// `themeColor` pinta la barra del sistema del color del tile del icono; los valores salen de los
// tokens de `globals.css` (grafito de marca / blanco), no se inventan acá.
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1613" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={cn(
        "h-full",
        "antialiased",
        "font-sans",
        interTight.variable,
        bricolage.variable,
        jetbrains.variable,
        archivo.variable,
        jetbrainsLanding.variable,
        instrumentSerif.variable
      )}
      suppressHydrationWarning
    >
      <head>
        {/* Bootstrap del theme antes de hidratar para evitar FOUC entre light y dark.
            En React 19 + Next 16, los <script> dentro de <body> disparan warning; adentro
            de <head> React lo hoistea al SSR HTML y el browser lo ejecuta antes de hidratar. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('tuvetia-theme')==='dark'){document.documentElement.classList.add('dark')}}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
