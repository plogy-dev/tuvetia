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
export const metadata: Metadata = {
  title: 'Tuvetia · software clínico para veterinarios',
  description:
    'Athos escucha tu consulta y escribe la historia clínica mientras atiendes. Tú revisas y firmas.',
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
