// Normalizar un teléfono al formato que WhatsApp entiende: dígitos con indicativo de país.
//
// POR QUÉ EXISTE. Medido en producción el 2026-08-03: Athos propuso responderle a un titular y el
// envío murió con
//
//     400 {"jid":"3244669300@s.whatsapp.net","exists":false,"number":"3244669300"}
//
// El número iba SIN el 57. WhatsApp no resuelve números en formato nacional — para él `3244669300`
// simplemente no existe, y devuelve un 400 que no dice "te falta el indicativo" sino "este número no
// existe", que manda a buscar en el lugar equivocado.
//
// El origen es que los teléfonos se guardan y se comparan de muchas formas: `+57 324 466 9300` en
// `owners.phone`, los últimos 10 dígitos para emparejar titulares (`slice(-10)`, que es correcto para
// BUSCAR y no para enviar), y lo que el modelo escriba en la tool. Cualquiera de esos caminos puede
// entregar diez dígitos pelados.
//
// DÓNDE SE APLICA: en `sendWhatsAppText`, que el propio archivo declara como "el ÚNICO camino de
// salida de mensajes". Arreglarlo ahí cubre de una vez la bandeja, las acciones aprobadas de Athos,
// las respuestas automáticas y la cobranza — en vez de parchear cada llamador y olvidarse de uno.

const INDICATIVO_COLOMBIA = "57"

/**
 * Devuelve sólo dígitos, con indicativo.
 *
 * Es DELIBERADAMENTE conservador: sólo agrega el 57 cuando el número tiene exactamente diez dígitos,
 * que es el formato nacional colombiano (móviles `3XXXXXXXXX` y fijos `60XXXXXXXX`). Cualquier otra
 * longitud se devuelve intacta, porque un número internacional de diez dígitos con otro indicativo
 * quedaría destrozado si asumiéramos que todo el mundo es Colombia. Ante la duda, no tocar.
 */
export function normalizarTelefono(valor: string): string {
  const soloDigitos = valor.replace(/\D/g, "")
  if (soloDigitos.length === 10) return `${INDICATIVO_COLOMBIA}${soloDigitos}`
  return soloDigitos
}
