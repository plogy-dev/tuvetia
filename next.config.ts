import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // LOS `.md` DE LA DOCUMENTACIÓN TIENEN QUE VIAJAR AL DESPLIEGUE.
  //
  // `/admin/docs` los lee del disco en tiempo de petición (ver `lib/docs/catalogo.ts`: los
  // archivos son la fuente de verdad y se editan donde están). Pero Vercel no sube el repo entero:
  // sube lo que el rastreo de dependencias encuentra siguiendo los imports, y un `readFile` con una
  // ruta armada en tiempo de ejecución es invisible para ese rastreo.
  //
  // Sin esto la documentación saldría VACÍA en producción y sin ningún error — el modo de fallo más
  // caro, porque en desarrollo funciona perfecto.
  //
  // Si algún día se agrega documentación en una carpeta nueva, hay que sumarla acá además de en
  // `RAICES` de `catalogo.ts`.
  outputFileTracingIncludes: {
    "/admin/docs": ["./*.md", "./docs/**/*.md", "./athos-service/**/*.md"],
    "/admin/docs/**": ["./*.md", "./docs/**/*.md", "./athos-service/**/*.md"],
  },
};

export default nextConfig;
