// Quién responde legalmente por los datos.
//
// POR QUÉ ESTE ARCHIVO EXISTE, Y POR QUÉ ES EL ÚNICO QUE HAY QUE TOCAR. La Ley 1581 de 2012 exige
// que la política de tratamiento nombre al **responsable**: una persona jurídica concreta, con NIT y
// dirección donde el titular pueda ejercer sus derechos. Una política sin eso no es una política —
// es un texto que describe prácticas sin decir quién responde por ellas.
//
// A la fecha de escribir esto (2026-08-17) **está sin definir**: es una decisión comercial entre
// Plogy y el cliente, no técnica.
//
// LA CONSECUENCIA DE DISEÑO. Las páginas legales NO publican la política mientras esto esté vacío:
// muestran el aviso de "en preparación" que ya estaba. Es deliberado y es lo prudente — publicar un
// documento legal con los datos del responsable en blanco sería peor que no publicarlo, porque
// aparenta cumplimiento sin darlo.
//
// **Para publicar: llenar los cinco campos de abajo.** Nada más. Ni tocar las páginas, ni el
// contenido, ni desplegar código nuevo — sólo esta constante y un despliegue.

/** Los datos que la Ley 1581 exige publicar del responsable del tratamiento. */
export type Responsable = {
  razonSocial: string
  nit: string
  domicilio: string
  /** A dónde escribe un titular para ejercer sus derechos. Es el único obligatorio de verdad. */
  correo: string
  telefono: string
}

/**
 * Vacío = sin definir. **Llenar los cinco campos publica la política.**
 *
 * Se dejan como cadenas vacías y no como `null` para que el tipo no obligue a comprobaciones en cada
 * uso: el guard de abajo es el único punto donde se decide.
 */
export const RESPONSABLE: Responsable = {
  razonSocial: "",
  nit: "",
  domicilio: "",
  correo: "",
  telefono: "",
}

/**
 * ¿Se puede publicar la política?
 *
 * Exige los CINCO campos, no sólo el correo. Un documento legal a medias —con razón social pero sin
 * NIT, por ejemplo— es exactamente lo que un requerimiento de la SIC encuentra primero. O está
 * completo o no se publica.
 *
 * `trim()` porque un espacio en blanco es tan inútil como el vacío y mucho más difícil de ver.
 */
export function responsableDefinido(r: Responsable = RESPONSABLE): boolean {
  return [r.razonSocial, r.nit, r.domicilio, r.correo, r.telefono].every((v) => v.trim() !== "")
}

/**
 * Qué falta, para que el aviso lo pueda decir en vez de sólo callar.
 *
 * No se muestra al público: lo usa el aviso interno y los tests. Un mensaje que dice "faltan NIT y
 * teléfono" ahorra la mitad del trabajo de averiguarlo.
 */
export function camposFaltantes(r: Responsable = RESPONSABLE): string[] {
  const etiquetas: Array<[keyof Responsable, string]> = [
    ["razonSocial", "razón social"],
    ["nit", "NIT"],
    ["domicilio", "domicilio"],
    ["correo", "correo de contacto"],
    ["telefono", "teléfono"],
  ]
  return etiquetas.filter(([k]) => r[k].trim() === "").map(([, etiqueta]) => etiqueta)
}
