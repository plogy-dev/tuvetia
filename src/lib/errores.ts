// El único lugar por donde se reporta un error no atrapado, del cliente Y del servidor.
//
// POR QUÉ EXISTE ESTE ARCHIVO Y NO UN `console.error` SUELTO EN CADA BOUNDARY. Todos los caminos de
// error llaman acá, así que cambiar de proveedor —o apagarlo— es tocar DOS funciones y no buscar
// `console` desperdigados por 70k líneas.
//
// QUÉ CUBRE, DESPUÉS DE LA AUDITORÍA DEL 2026-08-16. Antes sólo lo llamaban los tres boundaries de
// React, o sea errores de RENDER EN EL CLIENTE. Todo lo demás se perdía: los crons del briefing, de
// cartera y de la purga corren sin nadie mirando, y sus fallos parciales terminaban en un
// `console.error` dentro de los logs de Vercel, que en el plan Hobby duran poquísimo. La mitad de
// servidor entra ahora por `instrumentation.ts :: onRequestError`, que Next dispara para route
// handlers, server actions, render de servidor y proxy.
//
// QUÉ ES EL DIGEST. En producción Next NO manda el mensaje real del error al navegador — sería
// filtrar detalle del servidor a cualquiera. Manda un hash corto, el `digest`, que aparece también
// en los logs del servidor. Es lo único que conecta "lo que vio el vet" con "lo que pasó de
// verdad", así que la pantalla de error TIENE que mostrarlo: sin él, un reporte de usuario es
// imposible de rastrear.
//
// SENTRY ESTÁ CABLEADO PERO INERTE SIN DSN. `NEXT_PUBLIC_SENTRY_DSN` ausente = exactamente el
// comportamiento de antes, sólo consola. Es la misma regla que el resto del repo: una integración
// sin credencial degrada, no rompe. El DSN va en `NEXT_PUBLIC_` a propósito y no es un descuido —
// un DSN de Sentry es público por diseño (sólo habilita ENVIAR eventos, no leerlos), y el navegador
// necesita verlo. Una sola variable para las dos mitades.

import * as Sentry from "@sentry/nextjs"

/** Dónde se cayó, del lado del cliente. Distingue un fallo de página de uno del layout raíz. */
export type DondeFallo = "raiz" | "dashboard" | "global"

const ETIQUETA: Record<DondeFallo, string> = {
  raiz: "app",
  dashboard: "dashboard",
  global: "layout-raiz",
}

/** Lo que Next entrega sobre un error de servidor, reducido a lo que sirve para diagnosticar. */
export type ContextoDeServidor = {
  /** Ruta pedida, con query. Ej. `/api/cron/briefing`. */
  ruta: string
  metodo: string
  /** `render` | `route` | `action` | `proxy`, tal como lo nombra Next. */
  tipo: string
  /** El archivo de la ruta. Ej. `/api/cron/briefing/route`. */
  archivo: string
}

// ── Qué merece reportarse ─────────────────────────────────────────────────────────────────────

/**
 * `redirect()` y `notFound()` de Next FUNCIONAN LANZANDO ERRORES.
 *
 * Lo dice su propia documentación: «APIs like `redirect()` and `notFound()` work by throwing special
 * errors under the hood». No son fallos: son control de flujo. Sin este filtro, cada redirección de
 * login y cada 404 legítimo entraría al tracker, y un tracker lleno de ruido se deja de mirar — que
 * es el mismo final que no tener ninguno.
 *
 * Se detecta por el PREFIJO del digest y no por una lista cerrada (`NEXT_REDIRECT`,
 * `NEXT_HTTP_ERROR_FALLBACK;404`, …) porque esos nombres cambiaron entre versiones de Next y volverán
 * a cambiar. Los digest de errores REALES son hashes hexadecimales, así que no hay colisión posible.
 */
export function esControlDeFlujoDeNext(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const digest = (error as { digest?: unknown }).digest
  return typeof digest === "string" && digest.startsWith("NEXT_")
}

/** ¿Vale la pena reportar esto? */
export function vaAlTracker(error: unknown): boolean {
  return !esControlDeFlujoDeNext(error)
}

// ── La forma del reporte ──────────────────────────────────────────────────────────────────────

export type Reporte = {
  mensaje: string
  digest: string | null
  stack: string | null
}

/**
 * Normaliza cualquier cosa que se haya lanzado.
 *
 * `onRequestError` tipa el error como `unknown` y lo dice explícitamente: puede no ser un `Error`.
 * En JavaScript se puede lanzar un string, un objeto o `undefined`, y un reporte que asuma `.message`
 * se cae justo cuando más se lo necesita.
 */
export function formaDelReporte(error: unknown): Reporte {
  if (error instanceof Error) {
    return {
      mensaje: error.message,
      digest: (error as { digest?: string }).digest ?? null,
      stack: error.stack ?? null,
    }
  }
  return { mensaje: String(error), digest: null, stack: null }
}

// ── Los dos puntos de entrada ─────────────────────────────────────────────────────────────────

/**
 * Reporta un error no atrapado DEL CLIENTE.
 *
 * Se llama desde un `useEffect` en el boundary, no durante el render: React puede re-renderizar un
 * boundary más de una vez y reportar en el cuerpo duplicaría el evento.
 */
export function reportarError(error: Error & { digest?: string }, donde: DondeFallo): void {
  if (!vaAlTracker(error)) return
  const r = formaDelReporte(error)
  console.error(`[tuvetia:${ETIQUETA[donde]}]`, r)
  Sentry.captureException(error, { tags: { donde: ETIQUETA[donde], lado: "cliente" } })
}

/**
 * Reporta un error no atrapado DEL SERVIDOR. Lo llama `instrumentation.ts :: onRequestError`.
 *
 * La etiqueta lleva el TIPO además de la ruta porque son fallos de naturaleza distinta y se
 * diagnostican distinto: un `route` es un cron o un webhook que nadie está mirando, un `action` es un
 * vet esperando frente a un formulario, y un `render` es una pantalla que no cargó.
 */
export function reportarErrorDeServidor(error: unknown, c: ContextoDeServidor): void {
  if (!vaAlTracker(error)) return
  const r = formaDelReporte(error)
  console.error(`[tuvetia:servidor:${c.tipo}] ${c.metodo} ${c.ruta}`, r)
  Sentry.captureException(error, {
    tags: { lado: "servidor", tipo: c.tipo, archivo: c.archivo },
    extra: { ruta: c.ruta, metodo: c.metodo, digest: r.digest },
  })
}

/**
 * Texto corto para que el vet pueda reportar el fallo.
 *
 * Devuelve `null` cuando no hay digest —pasa en desarrollo, donde el mensaje real sí viaja— para
 * que la pantalla no muestre un "código: null" que no le sirve a nadie.
 */
export function codigoDeReporte(error: { digest?: string }): string | null {
  return error.digest ?? null
}
