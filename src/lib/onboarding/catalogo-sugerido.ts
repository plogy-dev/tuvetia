// Los servicios que el onboarding propone, para que el catálogo no arranque en una página en blanco.
//
// POR QUÉ EXISTE. La auditoría del 2026-08-16 midió las 15 clínicas del principal: **0 de 15 tenían
// un solo servicio activo**. Ninguna podía emitir una factura, porque `progreso.ts` lo dice sin
// rodeos — "sin servicios no se puede facturar una consulta". La causa no era un fallo sino un muro:
// no hay siembra por defecto en ninguna migración, así que se le pedía a un veterinario que tecleara
// su catálogo entero antes de cobrar la primera consulta. En un mes no lo hizo nadie.
//
// LO QUE ESTE MÓDULO PROPONE Y LO QUE NO:
//
//   · Propone NOMBRES y DURACIONES. Son conocimiento del oficio, iguales en cualquier veterinaria, y
//     equivocarse es inofensivo: se editan de un clic.
//   · NO propone PRECIOS. Un precio sale impreso en una factura, que es un documento fiscal, y una
//     cifra inventada ahí no es un placeholder: es un error. El vet los escribe. Es la misma regla
//     que ya sigue el resto del producto — `demo-data/route.ts` no fabrica citas bibliográficas y el
//     riel oculta el dinero en vez de mostrar un "$ 0" que se leería como cero ventas.
//   · NO fija IVA. `catalog_items` ya trae `tax_rate default 19` y `tax_status default 'GRAVADO'`, y
//     el formulario usa los mismos. Repetir el 19 acá crearía un TERCER sitio que interpreta lo
//     mismo — que es exactamente cómo nació el `whatsapp_provider_coherente` de la auditoría
//     anterior. Se omiten los campos y manda la columna.
//
// La DURACIÓN no es decorativa: es lo que le permite a Athos saber cuánto bloque reservar cuando
// agenda. Junto con los horarios, es la otra mitad de "que el agente pueda agendar".
//
// MÓDULO PURO A PROPÓSITO: `vitest.config.mts` corre en `environment: "node"`. Lo que quiera
// cobertura tiene que ser un `.ts` sin React adentro.

import { pesosToCents } from "@/lib/facturacion/domain/money"

export type ServicioSugerido = {
  /** Clave estable para el estado del formulario. No se guarda. */
  id: string
  nombre: string
  /** Minutos que ocupa en la agenda. `null` = no es algo que se agende (p. ej. hospitalización). */
  duracionMin: number | null
}

/**
 * Ocho servicios que cubren el día a día de una veterinaria general.
 *
 * OCHO Y NO VEINTE. Esto es un paso de onboarding, no el catálogo definitivo: tiene que caber en una
 * pantalla y leerse de un vistazo. Lo que falte se agrega después en Catálogo, que ya existe y está
 * hecho para eso. Una lista larga acá no da más cobertura — da más gente que la salta.
 */
export const SERVICIOS_SUGERIDOS: readonly ServicioSugerido[] = [
  { id: "consulta-general", nombre: "Consulta general", duracionMin: 30 },
  { id: "consulta-especializada", nombre: "Consulta especializada", duracionMin: 45 },
  { id: "vacunacion", nombre: "Vacunación", duracionMin: 15 },
  { id: "desparasitacion", nombre: "Desparasitación", duracionMin: 15 },
  { id: "esterilizacion", nombre: "Esterilización", duracionMin: 90 },
  { id: "bano-peluqueria", nombre: "Baño y peluquería", duracionMin: 60 },
  { id: "cirugia-menor", nombre: "Cirugía menor", duracionMin: 60 },
  { id: "hospitalizacion-dia", nombre: "Hospitalización (día)", duracionMin: null },
]

/** Fila lista para `catalog_items`. Sin campos fiscales: los pone la columna (ver cabecera). */
export type FilaDeCatalogo = {
  clinic_id: string
  item_type: "SERVICIO"
  name: string
  price_cents: number
  duration_minutes: number | null
}

/**
 * ¿Este precio en pesos sirve para crear un servicio?
 *
 * El cero NO sirve, y es la comprobación que más importa: `price_cents` admite 0 en la base
 * (`check (price_cents >= 0)`), así que un campo vacío se guardaría sin protestar y produciría una
 * línea de factura en $0. Un servicio que no se puede cobrar es peor que un servicio que no existe:
 * el catálogo diría que está listo.
 */
export function precioUtilizable(pesos: unknown): pesos is number {
  return typeof pesos === "number" && Number.isFinite(pesos) && pesos > 0
}

/**
 * Las filas a insertar, a partir de lo que el vet escribió.
 *
 * `precios` va por `id` del sugerido. Lo que no tenga precio válido simplemente NO ENTRA — saltarse
 * un servicio es una decisión legítima, no un error que haya que reportar. Con que llene uno solo,
 * la clínica ya puede facturar.
 */
export function filasDeCatalogo(
  clinicId: string,
  precios: Record<string, number | null | undefined>,
  sugeridos: readonly ServicioSugerido[] = SERVICIOS_SUGERIDOS,
): FilaDeCatalogo[] {
  const filas: FilaDeCatalogo[] = []
  for (const s of sugeridos) {
    const pesos = precios[s.id]
    if (!precioUtilizable(pesos)) continue
    filas.push({
      clinic_id: clinicId,
      item_type: "SERVICIO",
      name: s.nombre,
      price_cents: pesosToCents(pesos),
      duration_minutes: s.duracionMin,
    })
  }
  return filas
}

/** Cuántos servicios quedarían creados. Para el rótulo del botón: "Crear 3 servicios". */
export function cuantosServicios(precios: Record<string, number | null | undefined>): number {
  return Object.values(precios).filter(precioUtilizable).length
}
