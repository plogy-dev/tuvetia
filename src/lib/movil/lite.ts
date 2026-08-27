// Qué ofrece Tuvetia instalada en el teléfono, y qué no — DICHO, no escondido.
//
// ── POR QUÉ EXISTE ESTE ARCHIVO ─────────────────────────────────────────────────────────────────
//
// El alcance lo fijó el cliente (26-ago): la app del teléfono es para CONSULTAR Y RESPONDER —
// agenda, pacientes, VetGPT, comunicaciones — sin grabar consultas y sin facturación.
//
// La tentación es esconder en móvil lo que no entra, y es la trampa: una función que desaparece
// sin explicación hace creer que la app está incompleta o rota. Lo que hace este módulo es darle
// a cada exclusión su RAZÓN en una frase que el vet puede leer, para que la pantalla diga «esto se
// hace desde el computador, y es a propósito» en vez de no decir nada.
//
// ── LAS DOS EXCLUSIONES NO TIENEN LA MISMA FORMA ────────────────────────────────────────────────
//
// · Facturación es una SECCIÓN: se cubre por ruta, y la pantalla entera avisa.
// · El Modo Fantasma es una ACCIÓN dentro de una sección que SÍ entra: ver las consultas y leer
//   sus notas es exactamente «consultar». Lo que queda fuera es GRABAR, así que su aviso no puede
//   ser por ruta — le pertenece al botón de grabar, no a la pantalla. Por eso `ruta: null`.
//
// ── POR QUÉ CADA EXCLUSIÓN ES REAL Y NO PRUDENCIA ───────────────────────────────────────────────
//
// · Grabar: el grabador pide `audio/webm` fijo (`lib/consulta-viva/sesion.ts`) y Safari no lo
//   soporta — en un iPhone falla culpando a los permisos del micrófono. Prometerlo en la app
//   instalada sería prometer lo que está roto. Cuando el grabador negocie el contenedor, esta
//   entrada se borra y listo.
// · Facturación: emitir una factura son pantallas de columnas y tablas que en 390 px de ancho se
//   vuelven ilegibles, y equivocarse ahí cuesta plata. No es «no se puede»: es que hacerlo mal es
//   peor que no ofrecerlo.

export type ExclusionLite = {
  /**
   * Prefijo de ruta que la exclusión cubre (se compara con `startsWith`), o `null` cuando lo
   * excluido es una acción dentro de una sección que sí entra al alcance.
   */
  ruta: string | null
  /** El nombre que el vet conoce. */
  nombre: string
  /** La frase que la pantalla muestra: por qué esto se usa desde el computador. */
  razon: string
}

/** Lo que la app instalada ofrece. Es la lista de la tab bar + el cajón, no un segundo menú. */
export const ALCANCE_LITE = [
  "Agenda del día y de la semana",
  "Pacientes y su ficha completa",
  "VetGPT — preguntar y revisar propuestas",
  "Comunicaciones — WhatsApp y avisos",
] as const

export const FUERA_DEL_LITE: readonly ExclusionLite[] = [
  {
    ruta: null,
    nombre: "Grabar consultas (Modo Fantasma)",
    razon:
      "La grabación se hace desde el computador: el navegador del teléfono no graba en el formato que usa la transcripción. Leer las consultas y sus notas sí funciona acá.",
  },
  {
    ruta: "/dashboard/facturacion",
    nombre: "Ventas y facturación",
    razon:
      "Emitir facturas y mover inventario se hace desde el computador: son pantallas de tablas anchas donde equivocarse cuesta plata.",
  },
] as const

/** La exclusión de sección que cubre esta ruta, o null si la ruta entra en el alcance lite. */
export function exclusionDe(pathname: string): ExclusionLite | null {
  return FUERA_DEL_LITE.find((e) => e.ruta !== null && pathname.startsWith(e.ruta)) ?? null
}
