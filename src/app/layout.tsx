import type { Metadata } from "next";
import {
  Inter_Tight,
  JetBrains_Mono,
  Bricolage_Grotesque,
  Archivo,
  Instrument_Serif,
} from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";
import { cn } from "@/lib/utils";

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-inter-tight",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
});

// ── Fuentes de la landing de marketing (grupo (marketing)). Viven acá y no en
// el layout del grupo porque landing.css las referencia en reglas de <body>
// (var(--font-archivo) / --font-mono / --font-serif) y las variables deben
// resolver a ese nivel.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-archivo",
  display: "swap",
});

const jetbrainsLanding = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
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
        interTight.variable,
        jetbrains.variable,
        bricolage.variable,
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
