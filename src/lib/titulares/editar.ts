// Validación y normalización de la edición de un titular.
//
// POR QUÉ EXISTE. `owners` tenía alta (RPC `create_owner`) y ficha de lectura, pero NINGUNA ruta de
// UPDATE en el producto: un teléfono mal tecleado al registrar quedaba mal para siempre, y el
// teléfono del titular es a donde escriben WhatsApp y los recordatorios de cita. Reunión con el
// cliente del 24-ago: pidió poder corregir al titular desde la ficha del paciente.
//
// La RLS ya lo permitía sin migración: `owners_update` es `using (clinic_id =
// private.my_clinic_id())` — el mismo macro que `patients_update`, que es la razón de que el drawer
// de pacientes pueda hacer `.update()` directo con el cliente del vet. Se sigue ese mismo patrón.
//
// NOTES NO SE EDITA ACÁ, y no es un descuido: en `notes` viven anotaciones libres de la clínica y
// los marcadores de datos sembrados (p. ej. `[demo TuvetIA]`). Un formulario de contacto que
// mandara `notes` las pisaría a ciegas. Como el diff de abajo sólo recorre las claves de
// `PayloadDeTitular` —y `notes` no es una—, el UPDATE nunca puede tocarlas.
//
// Vive en un `.ts` sin React para poder probarlo en vitest, que corre en `environment: "node"`.

/** Lo que el formulario tiene en la mano: todo texto, como sale de un `<input>`. */
export type CamposDeTitular = {
  fullName: string
  phone: string
  email: string
  documentId: string
  address: string
}

/** Lo que se manda a `owners`, con los nombres de columna reales. `notes` queda fuera adrede. */
export type PayloadDeTitular = {
  full_name: string
  phone: string | null
  email: string | null
  document_id: string | null
  address: string | null
}

export type ResultadoDeTitular =
  | { ok: true; cambios: Partial<PayloadDeTitular> }
  | { ok: false; errores: Partial<Record<keyof CamposDeTitular, string>> }

function aPayload(c: CamposDeTitular): PayloadDeTitular {
  return {
    full_name: c.fullName.trim(),
    phone: c.phone.trim() || null,
    email: c.email.trim() || null,
    document_id: c.documentId.trim() || null,
    address: c.address.trim() || null,
  }
}

/**
 * Valida y devuelve **sólo lo que cambió**.
 *
 * El diff (y no el objeto entero) es lo que garantiza dos cosas: un guardado sin cambios no
 * escribe nada, y el UPDATE jamás pisa columnas que este formulario no muestra — `notes` incluida.
 *
 * EL CORREO SÓLO SE VALIDA SI CAMBIÓ, por la misma lección que la fecha de nacimiento en
 * `lib/pacientes/editar.ts`: si un titular viejo quedó guardado con un correo malformado,
 * validarlo siempre le impediría al vet corregirle el TELÉFONO hasta arreglar también un dato que
 * no está tocando.
 */
export function validarTitular(
  campos: CamposDeTitular,
  original: CamposDeTitular,
): ResultadoDeTitular {
  const errores: Partial<Record<keyof CamposDeTitular, string>> = {}

  if (!campos.fullName.trim()) errores.fullName = "El nombre no puede quedar vacío."

  const email = campos.email.trim()
  if (email && campos.email !== original.email && !/^\S+@\S+\.\S+$/.test(email)) {
    // Chequeo laxo a propósito: sólo caza lo que seguro no es un correo. La verdad la decide el
    // envío real; acá se ataja el typo, no se legisla el RFC.
    errores.email = "Ese correo no parece válido."
  }

  if (Object.keys(errores).length > 0) return { ok: false, errores }

  const nuevo = aPayload(campos)
  const viejo = aPayload(original)
  const cambios: Partial<PayloadDeTitular> = {}
  for (const k of Object.keys(nuevo) as (keyof PayloadDeTitular)[]) {
    if (nuevo[k] !== viejo[k]) Object.assign(cambios, { [k]: nuevo[k] })
  }

  return { ok: true, cambios }
}
