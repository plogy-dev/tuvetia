'use client';

import { useRouter } from 'next/navigation';

/**
 * Fila de tabla clicable: toda la fila navega a `href`, pero respeta los
 * links/botones internos (no roba sus clics). Para tablas de server
 * components donde queremos "meterse" al detalle desde cualquier celda.
 */
export function TrLink({
  href,
  className = '',
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <tr
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('a,button,input,select,label')) return;
        router.push(href);
      }}
      className={`cursor-pointer ${className}`}
    >
      {children}
    </tr>
  );
}
