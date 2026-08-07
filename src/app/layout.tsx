import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Newsreader,
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

// ── Fuentes de la APP (sistema de diseño Tuvetia v2) ──
// Geist para la UI operativa, Newsreader para títulos y estados vacíos, Geist
// Mono para valores clínicos y códigos — nada más. Es la regla del mockup: el
// serif es para el título, no para el cuerpo, y la mono es para lo que se lee
// como dato (40.1 °C, $180.000), no para lo que se lee como texto.
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
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
        geist.variable,
        geistMono.variable,
        newsreader.variable,
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
