// A dónde puede volver el navegador después de un consentimiento OAuth.
//
// POR QUÉ EXISTE. La conexión de calendario ya no se pide sólo desde Integraciones: desde v5 la
// agenda le abre una ventana a quien no tiene calendario conectado y lo manda a conectarlo de una
// vez. Después del consentimiento tiene que volver a donde estaba, no a Integraciones, así que la
// ruta de vuelta pasó a ser un dato que manda el cliente.
//
// Y AHÍ ESTÁ EL RIESGO, que es todo el motivo de que esto sea una función con nombre y no un
// `body.volverA ?? "/dashboard"` en la ruta: es una cadena que llega del navegador y termina en un
// redirect. Sin guarda, `volverA=https://sitio-ajeno` convierte el endpoint en un redirector
// abierto — y uno al que se llega justo después de autorizar el acceso al calendario, que es el
// peor momento para mandar a alguien a un sitio que no es el nuestro.
//
// Se acepta una ruta relativa DEL DASHBOARD y nada más. Todo lo demás cae al default en vez de
// rechazarse: una ruta de vuelta rara no puede impedir que alguien conecte su calendario.

/** El destino cuando no se pidió ninguno, o cuando el pedido no es una ruta que aceptemos. */
export const VUELTA_POR_DEFECTO = "/dashboard/conexiones"

/**
 * La ruta interna a la que volver, saneada.
 *
 * Se descarta todo lo que no sea `/dashboard` o un subcamino suyo. `//sitio-ajeno.com` también
 * queda afuera aunque empiece con barra: el navegador lo lee como URL de protocolo relativo, o sea
 * otro dominio. Nada de query ni de fragmento — el `?calendario=conectado` lo pone quien llama, y
 * dejar pasar el resto sería dejar pasar `?next=` de vuelta.
 */
export function rutaDeVuelta(valor: unknown): string {
  const ruta = typeof valor === "string" ? valor.trim() : ""
  return /^\/dashboard(\/[a-z0-9-]+)*$/i.test(ruta) ? ruta : VUELTA_POR_DEFECTO
}
