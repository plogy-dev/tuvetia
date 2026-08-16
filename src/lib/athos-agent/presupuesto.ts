import "server-only"

// EL TOPE DE GASTO DE IA POR CLÍNICA.
//
// POR QUÉ. El acta del sync del 12-ago cerró el modelo de negocio: el CRM es gratis de por vida, se
// cobra lo que consume IA, y hay un free trial de 3 días. Las dos cosas exigen poder MEDIR y CORTAR
// por clínica, y eso no existía.
//
// Lo que había era `rate-limit.ts`: un contador EN MEMORIA, por instancia serverless. En Vercel cada
// lambda tiene su propio mapa, así que con concurrencia el freno se diluye hasta casi nada — y
// además es por usuario y por minuto, que frena un loop pero no un mes de gasto. El propio archivo
// lo dice: "el presupuesto duro por clínica es fase posterior". Esto es esa fase.
//
// No reemplaza a `rateLimit`: son frenos distintos y conviven. Uno corta la ráfaga (doble clic,
// loop); éste corta el consumo acumulado del período.
//
// QUÉ CUENTA. Filas de `athos_agent_usage` (migración 0046) de la clínica en el mes corriente. UNA
// FILA = UNA LLAMADA AL MODELO, sin importar la superficie: el chat, el widget, la sugerencia de la
// bandeja, el modo automático, cartera y la lectura de facturas por foto gastan todas del mismo
// cupo. Es a propósito: el acta dice "todo lo que consume IA es de pago", y dejar afuera el modo
// automático y cartera —las dos que gastan sin que el vet lo note— sería dejar el agujero
// justamente donde está el gasto que nadie mira.
//
// POR QUÉ LLAMADAS Y NO TOKENS. Un tope por tokens es más justo y menos explicable. "Te quedan 120
// consultas este mes" es una frase que un veterinario puede entender y planificar; "te quedan
// 1.400.000 tokens" no. El costo por llamada varía, pero para un primer tope lo que importa es que
// exista un techo real y comunicable. La tabla guarda `tokens_in`/`tokens_out`, así que cambiar la
// unidad después no pide migrar nada.
//
// DOS LIMITACIONES CONOCIDAS, Y SON DELIBERADAS:
//
//  1. **La cuenta va un turno atrás.** `registrarUso()` escribe DESPUÉS de que el modelo respondió,
//     así que esta guarda lee una suma que no incluye los turnos en vuelo. Con varias pestañas
//     abiertas se puede pasar el tope por unas pocas llamadas. Para un tope de contención alcanza;
//     hacerlo exacto pide reservar antes de gastar, que es otro trabajo.
//  2. **Falla ABIERTA.** Si la consulta de uso falla, se deja pasar. Es el mismo criterio que el
//     juez de evidencia y la verificación de citas en este repo: dejar a un veterinario sin Athos
//     en medio de una consulta porque un `count` no respondió es peor que pasarse del tope. Queda
//     en el log del servidor, ruidoso.

import { createAdminClient } from "@/lib/supabase/admin"
import { bogotaTodayISO } from "@/lib/date-utils"

export type Presupuesto = {
  /** Si false, la superficie NO debe llamar al modelo. */
  permitido: boolean
  /** Llamadas ya registradas en el período. */
  usadas: number
  /** El techo del período. `null` = sin tope configurado (comportamiento de siempre). */
  tope: number | null
  /** Cuántas quedan. `null` cuando no hay tope. Nunca negativo. */
  restantes: number | null
  /** Cuándo se reinicia el contador, en YYYY-MM-DD (calendario de Bogotá). */
  reinicia: string
}

/**
 * Techo de CONTENCIÓN, que aplica cuando nadie configuró uno comercial.
 *
 * NO ES UN PLAN NI UN PRECIO. Es la diferencia entre "cuánto incluye la suscripción" —decisión de
 * negocio, todavía abierta, y que no le corresponde inventar al código— y "a partir de qué punto
 * esto dejó de ser uso y es un bucle". Este número es lo segundo.
 *
 * De dónde sale el 1000. Medido contra el principal el 2026-08-16: 4 clínicas activas, 56 llamadas
 * en el mes entre todas, y la más intensa acumulaba 38. Mil es ~26× esa clínica — ninguna consulta
 * real se acerca, y un bucle lo cruza en minutos.
 *
 * POR QUÉ VIVE EN EL CÓDIGO Y NO SÓLO EN UNA VARIABLE. Antes, sin la variable no había NINGÚN tope,
 * y la variable no estaba puesta en Vercel: verificado el 2026-08-16 mirando el riel, donde el
 * medidor de cupo no se pintaba. O sea que el gasto de IA no tenía techo en producción, y el único
 * freno era `rateLimit`, que es en memoria y por lambda. Un techo que depende de que alguien se
 * acuerde de configurarlo no es un techo.
 */
export const TOPE_DE_SEGURIDAD = 1000

/** Valor con el que se apaga el tope a propósito, sin tener que desplegar código. */
export const SIN_TOPE = "ninguno"

/**
 * El techo por clínica y por mes.
 *
 *   sin definir / vacío  → `TOPE_DE_SEGURIDAD`
 *   `"ninguno"`          → sin tope, y es una decisión explícita de alguien
 *   entero ≥ 0           → ése (el número comercial, cuando exista)
 *   inválido             → `TOPE_DE_SEGURIDAD`, con aviso
 *
 * EL `0` SIGUE SIENDO VÁLIDO y sigue significando "Athos apagado para todos". Es el kill-switch que
 * ya existía y que su test documenta como deliberado; no se toca.
 *
 * LO QUE SÍ CAMBIA es a dónde cae un valor inválido: antes a "sin tope", ahora al de contención.
 * Ante un typo en una variable de entorno, contener es más seguro que abrir — y "abrir" acá era, en
 * los hechos, no tener ningún techo en producción.
 */
export function topeConfigurado(raw: string | undefined = process.env.ATHOS_TOPE_MENSUAL_POR_CLINICA): number | null {
  if (raw === undefined || raw.trim() === "") return TOPE_DE_SEGURIDAD
  if (raw.trim().toLowerCase() === SIN_TOPE) return null

  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    console.error(
      `[athos/presupuesto] ATHOS_TOPE_MENSUAL_POR_CLINICA="${raw}" no es un entero >= 0 ni "${SIN_TOPE}": ` +
        `se aplica el tope de contención (${TOPE_DE_SEGURIDAD}).`,
    )
    return TOPE_DE_SEGURIDAD
  }
  return n
}

/**
 * El primer día del mes corriente **en el calendario de Bogotá**, como YYYY-MM-DD.
 *
 * Anclado a Bogotá y no a UTC por el mismo motivo que todo lo demás en `date-utils.ts`: el servidor
 * corre en UTC, y el 31 a las 20:00 de Bogotá ya son las 01:00 UTC del 1º. Con la fecha de UTC, el
 * contador de una clínica se reiniciaría cinco horas antes de que termine su mes — regalando un
 * pedazo de mes cada 30 días.
 */
export function inicioDelMesBogota(now: Date = new Date()): string {
  return `${bogotaTodayISO(now).slice(0, 7)}-01`
}

/** El instante exacto en que arranca ese día en Bogotá (UTC-5 fijo, sin horario de verano). */
export function inicioDelMesISO(now: Date = new Date()): string {
  const [y, m] = inicioDelMesBogota(now).split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1) + 5 * 3600_000).toISOString()
}

/** El primer día del mes SIGUIENTE: cuándo vuelve a haber cupo. `Date.UTC` rueda el año solo. */
export function proximoReinicio(now: Date = new Date()): string {
  const [y, m] = inicioDelMesBogota(now).split("-").map(Number)
  const d = new Date(Date.UTC(y, m, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`
}

/** La decisión, separada de la consulta para poder probarla sin base. */
export function evaluar(usadas: number, tope: number | null, now: Date = new Date()): Presupuesto {
  if (tope === null) {
    return { permitido: true, usadas, tope: null, restantes: null, reinicia: proximoReinicio(now) }
  }
  return {
    permitido: usadas < tope,
    usadas,
    tope,
    restantes: Math.max(0, tope - usadas),
    reinicia: proximoReinicio(now),
  }
}

/**
 * Lo que la clínica lleva gastado este mes, y si puede seguir.
 *
 * Lee con `service_role` a propósito: las superficies de fondo (modo automático, cartera, crons) no
 * tienen sesión de veterinario, y el tope tiene que valer igual para ellas — son justamente las que
 * gastan sin que nadie mire. El `clinic_id` va SIEMPRE explícito, que es la regla de la casa cuando
 * se usa service_role.
 */
export async function consultarPresupuesto(clinicId: string, now: Date = new Date()): Promise<Presupuesto> {
  const tope = topeConfigurado()
  // Sin tope no se consulta nada: es una consulta por turno que no cambiaría ninguna decisión.
  if (tope === null) return evaluar(0, null, now)

  try {
    // `head: true` — sólo el contador, sin traer filas. El índice `(clinic_id, created_at desc)` de
    // la 0046 cubre exactamente este filtro.
    const { count, error } = await createAdminClient()
      .from("athos_agent_usage")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .gte("created_at", inicioDelMesISO(now))

    if (error) {
      console.error(`[athos/presupuesto] no se pudo contar el uso de ${clinicId}: ${error.message}. Se deja pasar.`)
      return evaluar(0, null, now)
    }
    return evaluar(count ?? 0, tope, now)
  } catch (e) {
    console.error(`[athos/presupuesto] fallo consultando el uso de ${clinicId}: se deja pasar.`, e)
    return evaluar(0, null, now)
  }
}

/**
 * El texto que ve el veterinario cuando se agotó el cupo.
 *
 * NO dice "actualizá tu plan": no hay planes ni pasarela todavía (Wompi está sin integrar). Prometer
 * una salida que no existe deja al vet buscando un botón que no está. Dice qué pasó, cuándo vuelve,
 * y a quién escribirle.
 */
export function mensajeSinCupo(p: Presupuesto): string {
  return (
    `La clínica llegó al tope de ${p.tope} consultas con IA de este mes. ` +
    `El cupo se renueva el ${p.reinicia}. El resto de Tuvetia sigue funcionando normal; ` +
    `si necesitas más antes de esa fecha, escríbenos.`
  )
}
