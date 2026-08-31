// Lo que le hace falta al modo automático para responder DE VERDAD, en el idioma del vet.
//
// ── POR QUÉ EXISTE (David, 27-ago) ─────────────────────────────────────────────────────────────
//
// «Lo activé y no pasó nada». Y tenía razón en las dos mitades: el interruptor se dejaba encender
// siempre, y encenderlo no garantizaba nada. `auto-reply.ts` comprueba OTRAS cosas antes de
// contestar —la línea conectada, el plan Pro, un tope diario con rampa, el cupo mensual de IA— y
// cuando alguna no se cumple GUARDA SILENCIO. El silencio es la conducta correcta del lado del
// titular (mejor una respuesta humana tarde que un bot a medias) y la peor posible del lado del
// vet: apretó un botón, el botón dice «Activadas», y no pasa nada nunca.
//
// Acá viven las condiciones que la pantalla puede comprobar ANTES de que el vet apriete, para que
// la respuesta a «¿por qué no contesta?» esté en la misma pantalla que el interruptor.
//
// ── ⚠️ ESTO ES UNA COPIA DELIBERADA, NO LA FUENTE DE VERDAD ────────────────────────────────────
//
// Quien decide es `lib/whatsapp/auto-reply.ts`, que corre en el servidor desde el webhook del
// proveedor. No se puede importar desde acá: arrastra `service_role` y el SDK del modelo, y esto lo
// consume un componente de cliente. Así que la rampa y los topes están replicados, y si allá se
// mueve una condición acá hay que moverla también.
//
// Es un precio consciente: la alternativa es que la pantalla no pueda decir nada hasta después de
// que el vet apriete, que es exactamente el defecto que esto viene a cerrar.
//
// Sin `server-only` y sin una sola importación: es aritmética y texto, importable desde el
// navegador. Por eso además se puede probar con vitest, que sólo corre `.ts`.

/** El día 0 de una conexión nueva. Rampa de `auto-reply.ts`: +5 por cada día conectado. */
export const RESPUESTAS_DEL_PRIMER_DIA = 5

/** Anti-loop por conversación de `auto-reply.ts` (`MAX_PER_HOUR_PER_CONVERSATION`). */
export const MAXIMO_POR_CHAT_POR_HORA = 8

export type IdDeRequisito = "conexion" | "plan" | "rol" | "horarios"

export type Requisito = {
  id: IdDeRequisito
  cumplido: boolean
  /** Una línea. Si falta, dice qué falta Y qué hacer; si está, confirma sin explicar de más. */
  texto: string
  /**
   * ¿Sin esto el interruptor NO se puede encender?
   *
   * Los tres primeros sí: sin línea no hay mensajes, sin Pro no hay capacidad y sin ser
   * administrador no hay permiso. `horarios` NO, y es una decisión de producto, no un olvido —
   * hacerlo bloqueante cambiaría HOY, en silencio, quién puede tener el modo automático encendido,
   * y hay clínicas corriendo con cero horarios que se encontrarían un interruptor que ya no pueden
   * volver a prender. Se avisa fuerte y se deja pasar.
   */
  bloqueante: boolean
}

/**
 * Las condiciones que se pueden comprobar desde la pantalla, en el orden en que se rompen.
 *
 * NO están todas las de `auto-reply.ts`, y la ausencia es deliberada: el tope diario y el cupo
 * mensual no son un sí/no que se pueda evaluar antes de recibir un mensaje —son cantidades que se
 * gastan— así que la pantalla los cuenta aparte, como límites, y no como requisitos incumplidos.
 * Pintarlos en rojo cuando todavía queda cupo diría que algo está mal cuando no lo está.
 */
export function requisitosDelModoAutomatico(estado: {
  /** La integración de WhatsApp está en `connected`. Sin línea no hay entrantes que responder. */
  conectado: boolean
  /** La clínica tiene plan Pro (capacidad `whatsapp-automatico`). */
  planPro: boolean
  /** Quien mira es administrador de la clínica: el único que puede mover el interruptor. */
  esAdmin: boolean
  /**
   * La clínica cargó al menos un horario de atención propio (`clinic_hours` con `vet_id` nulo).
   *
   * Opcional para no romper a quien ya llamaba esta función con tres campos: sin el dato no se
   * afirma nada, que es mejor que afirmar que faltan horarios cuando nadie los miró.
   */
  tieneHorarios?: boolean
}): Requisito[] {
  return [
    {
      id: "conexion",
      cumplido: estado.conectado,
      bloqueante: true,
      texto: estado.conectado
        ? "El WhatsApp de la clínica está conectado."
        : "El WhatsApp de la clínica no está conectado: sin línea no llega ningún mensaje que responder.",
    },
    {
      id: "plan",
      bloqueante: true,
      cumplido: estado.planPro,
      // Nombra el plan de la clínica, no «tu plan»: lo paga la clínica y lo contrata el
      // administrador. Un vet que lee «tu plan» va a buscar dónde pagarlo y no lo va a encontrar.
      texto: estado.planPro
        ? "La clínica tiene plan Pro, que es donde vive el modo automático."
        : "La clínica está en el plan gratis. El modo automático es de Pro: mientras tanto, VetGPT te sigue sugiriendo las respuestas.",
    },
    {
      id: "rol",
      bloqueante: true,
      cumplido: estado.esAdmin,
      texto: estado.esAdmin
        ? "Sos administrador de la clínica, así que podés encenderlo y apagarlo."
        : "Sólo un administrador de la clínica puede encender o apagar las respuestas automáticas. Pedíselo a quien administra la tuya.",
    },
    // ── EL AVISO QUE FALTABA, Y QUE HABRÍA EVITADO EL INCIDENTE DEL 30-AGO ──────────────────────
    //
    // `Clinica de Santiago Tellez` encendió el modo automático a las 20:53 con CERO horarios
    // cargados. Cuatro minutos después un titular pidió cita, dijo «Mañana», y VetGPT no tenía ni un
    // cupo que ofrecerle. La app no dijo nada en ningún momento: el interruptor se dejó encender, el
    // toast dijo «Encendidas», y el problema recién apareció del lado del cliente.
    //
    // El aviso que sí existía apuntaba al revés —en la pantalla de HORARIOS, contando que VetGPT los
    // usa—, o sea que sólo lo leía quien ya estaba cargándolos.
    {
      id: "horarios",
      bloqueante: false,
      // `undefined` = nadie preguntó. No se afirma que falten horarios sin haberlos mirado.
      cumplido: estado.tieneHorarios !== false,
      texto:
        estado.tieneHorarios === false
          ? "La clínica no tiene horarios de atención cargados. VetGPT va a responder igual y a tomar los pedidos de cita, pero no va a poder ofrecer una hora hasta que los cargues en Administración → Agenda."
          : "La clínica tiene horarios cargados, así que VetGPT puede ofrecer cupos reales.",
    },
  ]
}

/**
 * ¿Está todo lo que BLOQUEA en su sitio? Si no, el interruptor no debería dejarse encender.
 *
 * Mira sólo los bloqueantes a propósito: `horarios` avisa fuerte pero no frena — el porqué está en
 * el campo `bloqueante` del tipo, y cambiarlo por un `every` a secas apagaría el interruptor de las
 * clínicas que hoy lo tienen encendido sin horarios.
 */
export function puedeEncenderse(requisitos: Requisito[]): boolean {
  return requisitos.filter((r) => r.bloqueante).every((r) => r.cumplido)
}

/**
 * Cuántas respuestas automáticas puede mandar la clínica HOY.
 *
 * Réplica de la rampa de `auto-reply.ts`: un número recién conectado no arranca a todo volumen
 * porque eso es el patrón de baneo clásico de WhatsApp. Cinco el primer día, +5 por cada día
 * conectado, hasta el tope configurado de la clínica.
 *
 * ES EL NÚMERO QUE MÁS SORPRENDE, y por eso se muestra: quien conecta y enciende el modo automático
 * el mismo día se topa con CINCO, no con las 30 de la columna — y probando dos veces ya gastó
 * casi la mitad sin saber que existía un límite.
 *
 * El resultado se acota a >= 0 aunque `auto-reply.ts` no lo haga: allá un número negativo se
 * traduce en silencio (`daily >= effectiveDailyLimit` es cierto para cualquier conteo), acá se
 * traduciría en la frase «hasta -5 respuestas hoy». La única forma de llegar ahí es un
 * `connected_at` en el futuro, o sea un reloj corrido.
 */
export function limiteDeRespuestasDeHoy(
  autoDailyLimit: number,
  connectedAt: string | null,
  ahora: Date = new Date(),
): number {
  const diasConectada = connectedAt
    ? Math.floor((ahora.getTime() - new Date(connectedAt).getTime()) / 86_400_000)
    : 0
  const rampa = RESPUESTAS_DEL_PRIMER_DIA * (1 + diasConectada)
  return Math.max(0, Math.min(autoDailyLimit, rampa))
}

/** `true` mientras la rampa siga por debajo del tope de la clínica: hay que explicar por qué. */
export function estaCalentandoElNumero(
  autoDailyLimit: number,
  connectedAt: string | null,
  ahora: Date = new Date(),
): boolean {
  return limiteDeRespuestasDeHoy(autoDailyLimit, connectedAt, ahora) < autoDailyLimit
}
