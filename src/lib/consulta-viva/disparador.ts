// Cuándo pedirle a Athos que mire la consulta en curso.
//
// LO QUE PIDIÓ EL CLIENTE, el 17-ago:
//
//     Luciano: "la inteligencia de datos no tiene que estar solamente al finalizar la consulta, sino
//               durante la consulta… yo como médico darle toda la consulta al man, que me dé notas,
//               me dé sugerencias de qué decir, me busque la literatura en tiempo real"
//
// Con dos cadencias: notas cada 15-20 s y sugerencias clínicas cada 45 s. Pero el propio Luciano
// puso la condición que define este archivo — sólo **"cuando tenga material para analizar"** — y
// anticipó el problema: "esto sí nos va a subir costos".
//
// ── POR QUÉ NO PUEDE SER UN `setInterval` ───────────────────────────────────────────────────────
//
// La aritmética, con los números reales del producto:
//
//   · Tope de seguridad: 1000 llamadas de IA por clínica y por mes (`athos-agent/presupuesto.ts`).
//   · Medido contra el principal el 2026-08-16: la clínica MÁS INTENSA acumuló 38 en todo el mes.
//
// A intervalo fijo, una consulta de 15 minutos gasta 60 notas + 20 sugerencias = **80 llamadas**.
// O sea que UNA consulta costaría más del doble de lo que hoy gasta la clínica más activa en un mes
// entero, y doce consultas agotarían el tope. Un reloj no es una cadencia: es una fuga.
//
// Disparar por CONTENIDO lo arregla en el caso que más pesa, que es el silencio. Una consulta real
// tiene exploración, esperas, el titular que busca algo en el bolso. Esos tramos no producen texto
// nuevo, y sin texto nuevo no hay nada que analizar — pedirle a un modelo que relea lo mismo cuesta
// igual y no devuelve nada.
//
// LOS DOS PISOS SON CONJUNTIVOS, y cada uno tapa un fallo distinto:
//
//   · el de TIEMPO evita ráfagas cuando alguien habla rápido y corrido;
//   · el de CONTENIDO evita gastar en silencio, que es lo que hacía el reloj.
//
// Y encima hay un TECHO POR CONSULTA, porque los dos pisos juntos siguen sin acotar el total: una
// consulta de 90 minutos hablando sin parar los cumple cientos de veces. Es la misma lección que
// `presupuesto.ts` ya dejó escrita: un techo que depende de que el uso sea razonable no es un techo.
//
// ⚠️ **EL SOBRE DE COSTO SIGUE SIENDO UNA DECISIÓN DE NEGOCIO.** Estos números contienen el bucle;
// no dicen cuánto debería incluir la suscripción. Con el techo de acá, una consulta gasta hasta 32
// llamadas y el tope de 1000 da para ~31 consultas al mes por clínica. Eso alcanza para las pruebas
// cerradas y NO alcanza para una clínica en producción — hay que fijarlo antes de vender esto.
//
// SÓLO CUENTA EL TEXTO ESTABLE. Lo provisional el proveedor todavía puede reemplazarlo, y generar
// una nota clínica desde algo que puede cambiar es escribir sobre arena. Es el mismo criterio con el
// que el panel lo pinta apagado.

export type Cadencia = {
  /** Cómo se llama en la traza y en los logs. */
  nombre: string
  /** Piso de TIEMPO: no dispara antes de esto aunque llueva texto. */
  minSegundos: number
  /** Piso de CONTENIDO: no dispara sin esto aunque pase el tiempo. */
  minPalabrasNuevas: number
  /** Techo por consulta. Contiene el bucle; no es un presupuesto comercial. */
  maxPorConsulta: number
}

/**
 * Notas en vivo: "cada 15-20 segundos" del pedido.
 *
 * 40 palabras nuevas son unos 16 segundos de habla continua (~150 palabras/minuto es la velocidad
 * normal de conversación). O sea que hablando de corrido cae dentro de la ventana pedida, y en
 * cuanto hay silencio se espacia solo.
 */
export const NOTAS: Cadencia = {
  nombre: "notas",
  minSegundos: 15,
  minPalabrasNuevas: 40,
  maxPorConsulta: 24,
}

/**
 * Sugerencias clínicas: "cada 45 segundos", y son la mitad cara — llevan literatura detrás.
 *
 * 120 palabras nuevas son unos 48 segundos de habla. El techo es bajo a propósito: ocho sugerencias
 * en una consulta ya es más de lo que un veterinario lee mientras atiende.
 */
export const SUGERENCIAS: Cadencia = {
  nombre: "sugerencias",
  minSegundos: 45,
  minPalabrasNuevas: 120,
  maxPorConsulta: 8,
}

/** Lo que hay que recordar entre disparos. Inmutable: se reemplaza, no se muta. */
export type EstadoDisparo = {
  /** Segundo de la grabación en el que se disparó por última vez. `null` = nunca. */
  ultimoEn: number | null
  /** Cuántas palabras estables había en ese momento. */
  palabrasEntonces: number
  /** Cuántas veces se disparó en esta consulta. */
  disparos: number
}

export const NUNCA: EstadoDisparo = { ultimoEn: null, palabrasEntonces: 0, disparos: 0 }

/**
 * Cuenta palabras, que es la unidad en la que "hay material" significa algo.
 *
 * Caracteres no sirven: 40 caracteres pueden ser dos palabras largas o el ruido de un micrófono mal
 * puesto. Y los signos de puntuación no cuentan como palabra.
 */
export function contarPalabras(texto: string): number {
  const limpio = texto.trim()
  if (!limpio) return 0
  return limpio.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

/**
 * ¿Toca disparar?
 *
 * @param segundos  cuánto lleva la grabación
 * @param estable   el texto CONFIRMADO hasta ahora (no el provisional)
 */
export function debeDisparar(
  cadencia: Cadencia,
  segundos: number,
  estable: string,
  ultimo: EstadoDisparo,
): boolean {
  if (ultimo.disparos >= cadencia.maxPorConsulta) return false

  const desdeElUltimo = segundos - (ultimo.ultimoEn ?? 0)
  if (desdeElUltimo < cadencia.minSegundos) return false

  const nuevas = contarPalabras(estable) - ultimo.palabrasEntonces
  return nuevas >= cadencia.minPalabrasNuevas
}

/** El estado después de disparar. Se llama con el MISMO texto con el que se decidió. */
export function trasDisparar(segundos: number, estable: string, ultimo: EstadoDisparo): EstadoDisparo {
  return {
    ultimoEn: segundos,
    palabrasEntonces: contarPalabras(estable),
    disparos: ultimo.disparos + 1,
  }
}

/**
 * Cuánto costaría esta consulta en el peor caso, para poder decirlo en vez de estimarlo.
 *
 * Lo usa el panel para mostrar el gasto y la traza para dejarlo registrado. Que el techo sea
 * visible es parte de que sea un techo.
 */
export function techoDeLlamadas(): number {
  return NOTAS.maxPorConsulta + SUGERENCIAS.maxPorConsulta
}
