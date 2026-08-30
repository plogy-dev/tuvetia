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

// ── LOS PRESETS (reunión del 28-ago, Luciano, 25:08) ────────────────────────────────────────
//
// «Usar como sugerencias — que el mismo sistema sugiera un texto. Que haya como unos presets.»
//
// Tres tonos por aviso. ELEGIR UN PRESET NO GUARDA: rellena el campo, el vet lo lee, lo ajusta
// si quiere, y guarda con el flujo de siempre. Así se respeta la semántica de las columnas
// (NULL = «no elegí» / texto = «elegí exactamente esto», criterio de la migración 0082): el
// preset sólo existe como texto elegido si alguien apretó Guardar mirándolo.
//
// Los tres cumplen las reglas de la casa: nada clínico (un WhatsApp lo lee cualquiera que
// agarre el teléfono), los cuatro huecos válidos, y una salida al final — el mensaje que no
// ofrece cómo cambiar la cita provoca la llamada que venía a ahorrar.

export type PresetDeAviso = { nombre: string; texto: string }

export const PRESETS_CONFIRMACION: PresetDeAviso[] = [
  {
    nombre: "Formal",
    texto:
      "Su cita para {paciente} en {clinica} quedó registrada para el {fecha} a las {hora}. " +
      "Si requiere reprogramarla, con gusto lo atendemos por este medio.",
  },
  {
    nombre: "Cálido",
    texto:
      "¡Hola! 🐾 Ya quedó agendada la cita de {paciente} en {clinica}: {fecha} a las {hora}. " +
      "Cualquier cambio, escríbanos por acá y lo cuadramos.",
  },
  {
    nombre: "Breve",
    texto: "Cita de {paciente} confirmada: {fecha}, {hora}, en {clinica}. ¿Cambios? Escríbanos.",
  },
]

export const PRESETS_RECORDATORIO: PresetDeAviso[] = [
  {
    nombre: "Formal",
    texto:
      "Le recordamos su cita para {paciente} en {clinica} el {fecha} a las {hora}. " +
      "Si no puede asistir, agradecemos avisar por este medio para reprogramarla.",
  },
  {
    nombre: "Cálido",
    texto:
      "¡Hola! 🐾 Mañana toca: la cita de {paciente} en {clinica} es el {fecha} a las {hora}. " +
      "Si se le complica, escríbanos y la movemos sin problema.",
  },
  {
    nombre: "Breve",
    texto: "Recordatorio: cita de {paciente}, {fecha} a las {hora} en {clinica}. ¿No puede? Escríbanos.",
  },
]
