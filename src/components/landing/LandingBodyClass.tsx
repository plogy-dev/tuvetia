'use client';

import { useEffect } from 'react';

/**
 * La landing (landing.css) estiliza vía clases del <body> (bg-hielo /
 * bg-houston / bg-foto, scrolled, locked…). El root layout de la app no puede
 * poner esas clases server-side sin afectar a toda la app, así que este
 * componente agrega la clase inicial al montar la sección de marketing y la
 * retira al navegar fuera. El motor de la landing (lib/landing/engine)
 * gestiona el resto de las clases en scroll.
 */
export function LandingBodyClass() {
  useEffect(() => {
    document.body.classList.add('bg-hielo');
    return () => {
      document.body.classList.remove(
        'bg-hielo',
        'bg-houston',
        'bg-foto',
        'bg-papel',
        'scrolled',
        'locked',
      );
    };
  }, []);

  return null;
}
