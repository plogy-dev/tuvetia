// Los textos por defecto de los avisos de cita.
//
// VIVEN APARTE Y SIN `server-only` a propósito: los usa el servidor para armar el mensaje y la
// PANTALLA DE AJUSTES para mostrarlos como marcador de posición del campo. `confirmacion.ts` es
// server-only —toca `service_role`— así que importar la constante desde ahí rompería el componente
// cliente.
//
// Es el mismo criterio que `lib/planes/index.ts`: los datos puros que consumen las dos mitades no
// llevan `server-only`.

/**
 * El aviso que sale al AGENDAR.
 *
 * Dice las tres cosas que el titular necesita —qué, cuándo, dónde— y ofrece una salida. Sin la
 * salida, la única forma de cambiar la cita es llamar, que es justamente la llamada que este
 * mensaje viene a ahorrar.
 *
 * NADA DE DATOS CLÍNICOS: va el nombre de la mascota y la hora, no el motivo. Un WhatsApp lo lee
 * cualquiera que agarre el teléfono.
 */
export const TEXTO_POR_DEFECTO_CONFIRMACION =
  "¡Listo! La cita de {paciente} en {clinica} quedó agendada para el {fecha} a las {hora}. " +
  "Si necesita cambiarla, escríbanos por acá."
