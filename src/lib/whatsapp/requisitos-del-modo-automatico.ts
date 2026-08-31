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

export type IdDeRequisito = "conexion" | "plan" | "rol"

export type Requisito = {
  id: IdDeRequisito
  cumplido: boolean
  /** Una línea. Si falta, dice qué falta Y qué hacer; si está, confirma sin explicar de más. */
  texto: string
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
}): Requisito[] {
  return [
    {
      id: "conexion",
      cumplido: estado.conectado,
      texto: estado.conectado
        ? "El WhatsApp de la clínica está conectado."
        : "El WhatsApp de la clínica no está conectado: sin línea no llega ningún mensaje que responder.",
    },
    {
      id: "plan",
      cumplido: estado.planPro,
      // Nombra el plan de la clínica, no «tu plan»: lo paga la clínica y lo contrata el
      // administrador. Un vet que lee «tu plan» va a buscar dónde pagarlo y no lo va a encontrar.
      texto: estado.planPro
        ? "La clínica tiene plan Pro, que es donde vive el modo automático."
        : "La clínica está en el plan gratis. El modo automático es de Pro: mientras tanto, VetGPT te sigue sugiriendo las respuestas.",
    },
    {
      id: "rol",
      cumplido: estado.esAdmin,
      texto: estado.esAdmin
        ? "Sos administrador de la clínica, así que podés encenderlo y apagarlo."
        : "Sólo un administrador de la clínica puede encender o apagar las respuestas automáticas. Pedíselo a quien administra la tuya.",
    },
  ]
}

/** ¿Está todo lo comprobable en su sitio? Si no, el interruptor no debería dejarse encender. */
export function puedeEncenderse(requisitos: Requisito[]): boolean {
  return requisitos.every((r) => r.cumplido)
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
