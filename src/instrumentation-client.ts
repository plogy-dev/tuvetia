// Instrumentación del CLIENTE: arranca el SDK antes de que la app sea interactiva.
//
// Sin esto, el `Sentry.captureException` que hacen los tres boundaries de React (`lib/errores.ts`)
// no manda nada: el SDK del navegador no estaría inicializado y la llamada sería un no-op silencioso
// — que es la peor forma de fallar, porque desde el código parece que se está reportando.
//
// A diferencia de `instrumentation.ts`, este archivo NO exporta nada: la documentación de Next 16 es
// explícita en que el código va suelto en el cuerpo y corre tal cual.
//
// SIN DSN NO HACE NADA. Es el estado de hoy y es válido: la app funciona igual, sólo que los errores
// se quedan en la consola del navegador.

import * as Sentry from "@sentry/nextjs"

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()

if (dsn) {
  // La documentación de Next recomienda envolver la instrumentación: un fallo acá no puede impedir
  // que la app arranque. Un tracker roto es un problema; una app que no carga por culpa del tracker
  // es otro mucho peor.
  try {
    Sentry.init({
      dsn,
      // Igual que en el servidor: errores, no trazas de rendimiento. Ver la nota en `instrumentation.ts`.
      tracesSampleRate: 0,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    })
  } catch (e) {
    console.error("[tuvetia] no se pudo iniciar el reporte de errores:", e)
  }
}
