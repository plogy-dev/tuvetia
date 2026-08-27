import type { MetadataRoute } from "next"

// El manifiesto que hace instalable a Tuvetia en el teléfono del vet.
//
// ── QUÉ ES «TUVETIA LITE» ───────────────────────────────────────────────────────────────────────
//
// No es otra app: es ESTA app, instalada, abriendo en lo que en un teléfono funciona de verdad.
// El alcance está declarado en `lib/movil/lite.ts` — consultar y responder — y las instrucciones
// de instalación viven en Configuración (`components/movil/instalar-app.tsx`).
//
// ── DECISIONES QUE NO SON DEFAULTS ──────────────────────────────────────────────────────────────
//
// · `start_url: /dashboard/calendario` — la agenda del día es lo primero que un vet mira en el
//   teléfono, no el tablero. OJO: esta URL queda CLAVADA en cada teléfono que instale; cambiarla
//   después no actualiza los accesos ya creados.
// · `display: standalone` — sin barra del navegador, que es todo el punto de instalar.
// · Colores de los TOKENS de `globals.css`, no inventados: `--background` claro (#ffffff) para el
//   lienzo del arranque y el grafito de marca (#0c1613) para la barra del sistema, que es el fondo
//   del icono.
// · SIN service worker, y es deliberado. Hoy mismo (26-ago) se pasó el día persiguiendo que el
//   cliente viera versiones viejas y se cerró con `deploymentId`; un service worker con caché
//   reintroduce ese problema con más fuerza y es mucho más difícil de purgar. iOS y Android
//   instalan igual sólo con el manifiesto. Si un día se quiere modo sin conexión, es una decisión
//   propia con una estrategia que NUNCA cachee navegación ni RSC.
//
// Los PNG los genera `scripts/generar-iconos.mjs` desde `public/marca/monogram.svg`; iOS no usa
// el SVG para la pantalla de inicio, sin los PNG el icono sale genérico.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tuvetia",
    short_name: "Tuvetia",
    description: "La clínica en tu bolsillo: agenda, pacientes y VetGPT.",
    start_url: "/dashboard/calendario",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0c1613",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
