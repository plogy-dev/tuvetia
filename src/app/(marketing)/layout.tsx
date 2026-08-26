import type { Metadata } from 'next';
import '../landing.css';
import { LandingBodyClass } from '@/components/landing/LandingBodyClass';

/**
 * Layout del grupo (marketing): la landing PÚBLICA que estaba online en el
 * repo landing-tuvetia, integrada 1:1 dentro de la app. Sirve `/`, /demo,
 * /producto y /seguridad. landing.css se importa acá (App Router lo carga
 * solo en estas rutas) y las fuentes de la landing (Archivo, Instrument
 * Serif, JetBrains como --font-mono) viven en el root layout para que las
 * variables resuelvan a nivel <body>, que es donde landing.css las usa.
 */
const TITULO = 'Tuvetia · software clínico para veterinarios';
const DESCRIPCION =
  'VetGPT escucha tu consulta y escribe la historia clínica mientras atiendes. Tú revisas y firmas.';

export const metadata: Metadata = {
  title: TITULO,
  description: DESCRIPCION,
  // El enlace de esta landing se reparte por WhatsApp, que es donde terminan TODOS sus formularios.
  // Sin estas dos secciones se compartía como texto pelado, sin título ni imagen — justo en el
  // único canal que importa. El origen sale de `metadataBase` (root layout).
  //
  // La imagen es la del hero, que es lo que hay: 1448×1086, o sea 4:3. Las medidas declaradas son
  // las REALES, no las canónicas — un OG de 1.91:1 querría 1200×630, así que WhatsApp y X van a
  // recortarla por arriba y por abajo. Se ve bien igual, pero una imagen hecha a medida para
  // compartir es una mejora pendiente, no algo que ya esté resuelto.
  openGraph: {
    type: 'website',
    siteName: 'Tuvetia',
    locale: 'es_CO',
    title: TITULO,
    description: DESCRIPCION,
    images: [{ url: '/media/hero.png', width: 1448, height: 1086, alt: 'Tuvetia' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITULO,
    description: DESCRIPCION,
    images: ['/media/hero.png'],
  },
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* La landing controla su fondo con clases en <body> (bg-hielo, etc.);
          este client component agrega la inicial y la limpia al salir. */}
      <LandingBodyClass />
      {children}
    </>
  );
}
