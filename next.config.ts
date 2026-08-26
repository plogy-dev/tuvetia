import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ── POR QUÉ DAVID VEÍA LA APP DE HACE HORAS (26-ago) ───────────────────────────────────────
  //
  // Pasamos el día desplegando —ocho veces— y él seguía viendo la versión vieja por más que
  // navegara. No era un preview ni la caché del navegador: era **version skew**, y la causa está
  // documentada en `next/dist/docs/.../deploymentId.md`.
  //
  // Sin `deploymentId`, Next no puede DARSE CUENTA de que el servidor cambió. La app es un SPA:
  // una vez cargada, moverse entre pantallas es navegación de cliente contra el bundle que ya
  // está en memoria. Con un id de despliegue, Next manda `x-deployment-id` en cada navegación,
  // el servidor responde con el suyo, y al no coincidir el cliente fuerza una recarga completa.
  // Sin él no hay nada que comparar: la pestaña abierta se queda en la versión con la que entró,
  // para siempre, y sólo un Ctrl+Shift+R la saca de ahí — que es exactamente lo que le sirvió.
  //
  // Se usa el SHA del commit y no un valor inventado: Vercel lo expone en el build, cambia con
  // cada despliegue y es el MISMO en todas las instancias de ese despliegue, que es justo lo que
  // pide la protección de skew. En local queda `undefined` y Next simplemente no la activa.
  //
  // La alternativa era Skew Protection de Vercel, que es de los planes pagos; esto vale igual y
  // funciona en Hobby.
  deploymentId: process.env.VERCEL_GIT_COMMIT_SHA,

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
