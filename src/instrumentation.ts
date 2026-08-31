// Instrumentación del SERVIDOR. Es la mitad que faltaba del reporte de errores.
//
// POR QUÉ EXISTE. Hasta el 2026-08-16 lo único que reportaba algo eran los tres boundaries de React,
// o sea errores de render EN EL CLIENTE. Todo lo del servidor se perdía en un `console.error` dentro
// de los logs de Vercel —plan Hobby, retención mínima— y nadie los miraba. Justo la parte que corre
// SOLA es la que quedaba muda: el briefing diario, el barrido de cartera, la purga de audio y los
// webhooks de WhatsApp.
//
// Un cron que devuelve 5xx sí avisa hoy, porque el workflow de GitHub usa `curl --fail-with-body` y
// el job sale rojo. Lo que no avisaba es todo lo demás: el fallo PARCIAL —una clínica que revienta
// mientras el barrido devuelve 200— y cualquier server action o ruta que no sea un cron.
//
// `onRequestError` cubre las cuatro superficies de una sola vez: `route` (crons, webhooks, API),
// `action` (server actions), `render` (server components) y `proxy` (middleware).

import type { Instrumentation } from "next"

import { reportarErrorDeServidor } from "@/lib/errores"

/**
 * Arranca el SDK una vez por instancia de servidor.
 *
 * SIN DSN NO HACE NADA, y eso es un estado válido y esperado: es exactamente el comportamiento que
 * el proyecto tuvo hasta ahora. `Sentry.init` con `dsn` vacío deja el SDK inerte, pero se comprueba
 * antes igual para no cargar el módulo cuando no hace falta.
 *
 * `tracesSampleRate: 0` A PROPÓSITO: queremos ERRORES, no trazas de rendimiento. Las trazas consumen
 * la cuota gratuita a un ritmo completamente distinto y no responden la pregunta que originó todo
 * esto, que es "¿se rompió algo y nadie me avisó?".
 */
export async function register() {
  // EL ID DE DESPLIEGUE, PARA EL RUNTIME DE VERCEL (31-ago). Parte del flight payload se arma
  // leyendo `process.env.NEXT_DEPLOYMENT_ID` directo — y en las funciones de Vercel nadie lo
  // setea (el `next start` local sí lo hace, por eso local siempre dio limpio). Sin esto, 120 de
  // 168 refs de assets salían con el TEXTO `dpl=undefined` y la protección de version skew —la
  // del «David veía la app de hace horas»— quedaba ciega. `register()` corre al boot del server,
  // antes de la primera petición, que es exactamente cuándo tiene que existir.
  if (!process.env.NEXT_DEPLOYMENT_ID && process.env.VERCEL_DEPLOYMENT_ID) {
    process.env.NEXT_DEPLOYMENT_ID = process.env.VERCEL_DEPLOYMENT_ID.slice(0, 32)
  }

  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()
  if (!dsn) return

  // Import dinámico y no estático: sin DSN el módulo no se carga siquiera.
  const Sentry = await import("@sentry/nextjs")
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    // El entorno separa producción de los preview de Vercel, que fallan por motivos distintos
    // (configuración a medias) y ensuciarían la señal si cayeran en la misma bolsa.
    environment: process.env.VERCEL_ENV ?? "development",
  })
}

/**
 * Todo error de servidor pasa por acá.
 *
 * `error` viene tipado como `unknown` y la documentación de Next avisa por qué: puede no ser el error
 * original, porque React lo procesa cuando ocurre durante el render de un Server Component. Por eso
 * `formaDelReporte` no asume `.message` y por eso el `digest` importa tanto — es lo que permite
 * cruzar lo que vio el vet con lo que pasó de verdad.
 *
 * NO SE FILTRA NADA ACÁ: la decisión de qué merece reportarse vive en `lib/errores.ts`, que es la
 * costura única y la que tiene los tests. Este archivo sólo traduce la forma que da Next.
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  reportarErrorDeServidor(err, {
    ruta: request.path,
    metodo: request.method,
    tipo: context.routeType,
    archivo: context.routePath,
  })
}
