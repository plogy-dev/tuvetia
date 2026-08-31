"use server"

// Las dos acciones del registro con la puerta cerrada. Ninguna toca la sesión: corren ANTES de que
// exista una cuenta, que es lo que las hace raras y lo que hay que tener presente al leerlas.
//
// UNA SERVER ACTION ES UN ENDPOINT, no un detalle del formulario: se la puede llamar con un POST
// sin pasar por la pantalla. Por eso las dos validan de nuevo del lado del servidor y ninguna
// confía en lo que la interfaz haya dejado pasar. Y por eso mismo lo que de verdad cierra la puerta
// no está acá: está en la base (migración 0100), donde la consola del navegador no llega.

import { normalizarCodigo, veredictoDelCodigo, MOTIVOS } from "@/lib/puerta"
import { canjearCodigo, leerCodigo } from "@/lib/puerta/servidor"

export type ResultadoDeLaPuerta = { ok: true; codigo: string; dias: number } | { ok: false; error: string }

/**
 * ¿Sirve este código? Se llama cuando el vet lo teclea, ANTES de pedirle sus datos.
 *
 * NO CANJEA NADA, y esa separación es el punto: acá todavía no hay correo al que atar el pase, y
 * gastar un cupo por cada persona que teclea un código para ver si anda vaciaría el código sin que
 * nadie se registre. El cupo se gasta en `reservarPase`, con el correo ya escrito.
 *
 * Devuelve los `dias` para poder decirle de una vez cuánto dura su prueba — es la única
 * recompensa visible de haber puesto el código, y callarla hace que el paso se sienta un peaje.
 */
export async function comprobarCodigo(bruto: string): Promise<ResultadoDeLaPuerta> {
  const codigo = normalizarCodigo(bruto)
  if (!codigo) return { ok: false, error: "Escribí el código que te compartieron." }

  const fila = await leerCodigo(codigo)
  const veredicto = veredictoDelCodigo(fila, new Date())
  if (!veredicto.sirve) return { ok: false, error: MOTIVOS[veredicto.motivo] }

  return { ok: true, codigo: fila!.codigo, dias: fila!.dias }
}

/**
 * Ata el código a un correo: a partir de acá esa dirección puede registrarse.
 *
 * SE LLAMA ANTES DE `signInWithOtp`, no después, y el orden es todo el mecanismo. El pase tiene que
 * existir en la base para cuando el vet abra el enlace del correo, porque el trigger de
 * confirmación —que es quien crea la clínica— lo consulta en ese instante y corre una sola vez en
 * la vida de la cuenta. Un pase que llegue después llega tarde.
 *
 * FALLA HACIA «NO REGISTRARSE», al revés que casi todo lo demás en este repo: si el canje no salió,
 * mandar igual el enlace produciría la peor pantalla posible —el vet recibe su correo, entra, y
 * queda adentro sin clínica y sin nada que apretar—. Mejor decirle acá que el código no valió.
 */
export async function reservarPase(input: {
  codigo: string
  email: string
}): Promise<ResultadoDeLaPuerta> {
  const codigo = normalizarCodigo(input.codigo)
  const email = (input.email ?? "").trim().toLowerCase()

  if (!codigo) return { ok: false, error: "Falta el código de acceso." }
  if (!email.includes("@")) return { ok: false, error: "Ese correo no parece válido." }

  const dias = await canjearCodigo(codigo, email)
  if (dias === null) {
    // El canje devuelve `null` por cuatro motivos distintos; se vuelve a leer la fila sólo para
    // poder decir CUÁL. Es una consulta de más en el camino que falla, no en el que funciona.
    const veredicto = veredictoDelCodigo(await leerCodigo(codigo), new Date())
    return {
      ok: false,
      error: veredicto.sirve ? "No se pudo validar el código. Probá de nuevo." : MOTIVOS[veredicto.motivo],
    }
  }

  return { ok: true, codigo, dias }
}
