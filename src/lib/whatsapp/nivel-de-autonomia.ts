// Los tres niveles de la barra de autonomía, y cómo se guardan.
//
// SIN IMPORTACIONES, como sus hermanos de `lib/whatsapp`: lo consumen el endpoint (servidor), la
// barra (cliente) y el panel de ajustes, y si cada uno tuviera su propia traducción se
// desincronizarían en el peor lugar posible — el estado que la pantalla PINTA dejaría de ser el que
// el servidor GUARDÓ, y el vet vería un nivel que no es el que tiene.
//
// ── EL NIVEL NO ES UNA COLUMNA: SON DOS ───────────────────────────────────────────────────────
//
//     review    → agent_mode='review'
//     auto      → agent_mode='auto',  confirma_citas_solo=false
//     confirma  → agent_mode='auto',  confirma_citas_solo=true
//
// Y no es capricho. Un tercer valor del enum `whatsapp_agent_mode` habría sido más corto, pero TODO
// el sistema pregunta `agent_mode = 'auto'` para saber si puede hablar —`auto-reply.ts`,
// `cartera/wa-router.ts`— así que una clínica en un modo `autoconfirm` se habría quedado con el
// agente ENTERO mudo. El porqué completo está en la migración 0102.

/** Lo que la barra manda y el endpoint acepta. */
export type NivelDeAutonomia = "review" | "auto" | "confirma"

/** Lo que la base guarda. `agent_mode` tiene cuatro valores; sólo dos se escriben desde acá. */
export type ColumnasDelNivel = { agentMode: "review" | "auto"; confirmaSolo: boolean }

/**
 * Nivel → columnas.
 *
 * `confirmaSolo` se escribe SIEMPRE, también cuando es `false`. Bajar de `confirma` a `auto` tiene
 * que apagarlo: un interruptor que no apaga es peor que no tenerlo, y acá lo que no se apagaría es
 * la clínica agendando sola después de haber pedido que no.
 */
export function columnasDelNivel(nivel: NivelDeAutonomia): ColumnasDelNivel {
  return {
    agentMode: nivel === "review" ? "review" : "auto",
    confirmaSolo: nivel === "confirma",
  }
}

/**
 * Columnas → nivel.
 *
 * `confirma_citas_solo` en `true` con `agent_mode` en `review` NO es el nivel 3: es una fila
 * incoherente —que la base permite— y el nivel que manda es el de `agent_mode`, porque es el que de
 * verdad decide si el agente habla. Pintar el 3 ahí le diría al vet que VetGPT agenda solo cuando
 * en realidad no contesta ni un mensaje.
 *
 * `paused`/`intervene` (sin UI hoy) caen en el nivel 1, igual que `review`.
 */
export function nivelDeLasColumnas(
  agentMode: string | null | undefined,
  confirmaSolo: boolean | null | undefined,
): NivelDeAutonomia {
  if (agentMode !== "auto") return "review"
  return confirmaSolo === true ? "confirma" : "auto"
}
