// Límites del panel de plataforma, en un solo lugar.
//
// Vive fuera de `admin/usuarios/actions.ts` porque ese archivo es `"use server"` y sólo puede
// exportar funciones async — una constante ahí no se puede importar desde el cliente. Y tiene que
// ser importable desde los dos lados: si la UI ofrece un tope y el servidor valida otro, el usuario
// arma una tanda que el servidor le rechaza recién al apretar Enviar.

/**
 * Destinatarios por tanda del envío masivo.
 *
 * Lo determina el reloj de la función serverless, no una preferencia: el bucle pausa entre envíos y
 * cada envío puede tardar hasta 20 s. Ver el comentario extenso en
 * `admin/usuarios/actions.ts`. Para tandas mayores hace falta una cola, no un número más grande.
 */
export const TOPE_ENVIO_MASIVO = 12
