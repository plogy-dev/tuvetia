// Qué bloques tiene el tablero, y cómo se reconcilia lo que cada persona guardó con lo que existe.
//
// LO QUE SE PIDIÓ: *"dashboard modular"* (18-ago) y *"los clientes quieren que sea prácticamente
// personalizable"*. El tablero es lo primero que se ve al entrar, y lo primero que necesita saber
// cada uno es distinto: el que factura quiere la plata del mes, el que atiende quiere sus citas y
// sus notas sin aprobar.
//
// ── EL PROBLEMA DE VERDAD NO ES ARRASTRAR, ES EL DESFASE ────────────────────────────────────────
//
// Una preferencia guardada es una foto de los widgets que existían el día que alguien la guardó. El
// código sigue cambiando. Así que toda lectura tiene que resolver dos cosas que van a pasar seguro:
//
//   · **Un widget que ya no existe.** Se retira uno y todas las preferencias que lo nombran quedan
//     apuntando al vacío. Se IGNORA. Reventar la pantalla por un id viejo sería cambiar un bloque
//     de menos por un tablero en blanco.
//
//   · **Un widget nuevo.** Se agrega uno y nadie que haya personalizado alguna vez lo vería jamás —
//     ni sabría que existe. **APARECE, y visible.** Es la decisión que más discutible parece y la
//     más importante: la alternativa es enviar funciones que la mitad de los usuarios nunca ve,
//     sin ninguna señal de por qué.
//
// Va al final y no al principio: lo nuevo se muestra, pero no le pisa el lugar a lo que la persona
// ya ordenó a mano.
//
// PURO Y SIN RED: `vitest.config.mts` corre en `environment: "node"` sobre `src/**/*.test.ts`.

export type IdDeWidget =
  | "riel"
  | "metricas"
  | "grafico"
  | "ventas"
  | "citas"
  | "borradores"

export type Widget = {
  id: IdDeWidget
  titulo: string
  /** Qué contesta este bloque. Es lo que se lee al elegir si tenerlo o no. */
  descripcion: string
  /** Cuánto ocupa en la grilla de 5 columnas del tablero. */
  ancho: "completo" | "tres" | "dos"
}

/**
 * Los bloques que existen. El ORDEN ACÁ es el del tablero por defecto — el de alguien que nunca
 * personalizó nada, que va a ser la mayoría.
 */
export const CATALOGO: Widget[] = [
  {
    id: "riel",
    titulo: "Configurá tu clínica",
    descripcion: "Los pasos que faltan para que VetGPT funcione completo. Desaparece solo al terminarlos.",
    ancho: "completo",
  },
  {
    id: "metricas",
    titulo: "Las cifras del mes",
    descripcion: "Consultas, pacientes, citas de la semana y notas por revisar. Cada una se abre.",
    ancho: "completo",
  },
  {
    id: "grafico",
    titulo: "Consultas por semana",
    descripcion: "Las últimas 12 semanas, para ver si la clínica sube o baja.",
    ancho: "tres",
  },
  {
    id: "citas",
    titulo: "Próximas citas",
    descripcion: "Lo que viene, en orden.",
    ancho: "dos",
  },
  {
    id: "ventas",
    titulo: "Ventas del mes por tipo",
    descripcion:
      "La dona de lo facturado este mes: cuánto fue servicios, cuánto medicamentos, cuánto productos.",
    ancho: "tres",
  },
  {
    id: "borradores",
    titulo: "Notas por aprobar",
    descripcion: "Las consultas cuya nota quedó en borrador. Ninguna entra a la historia hasta que la firmes.",
    ancho: "dos",
  },
]

const POR_ID = new Map(CATALOGO.map((w) => [w.id, w]))

/** Una entrada de la preferencia guardada. */
export type Puesto = { id: IdDeWidget; visible: boolean }

/** Lo que se guarda en `tablero_preferencias.widgets`, tal como llega de la base. */
export type Guardado = { id?: unknown; visible?: unknown }[]

/**
 * La disposición que rige, con TRES orígenes en orden de precedencia:
 *
 *   1. Lo que ESTA PERSONA guardó.
 *   2. El default que dejó el administrador para la clínica (0075).
 *   3. El de fábrica.
 *
 * ── POR QUÉ TRES Y NO DOS ───────────────────────────────────────────────────────────────────────
 *
 * Luciano pidió las dos cosas en la misma llamada del 21-ago: que el tablero lo defina el admin
 * (29:03) y que "mi dashboard es mío" (44:44). Se contradicen, y las dos tienen razón sobre algo
 * distinto — el admin quiere poder poner algo delante de todos, y cada quien quiere su vista. El
 * default de clínica es el punto de PARTIDA; la preferencia personal le gana siempre.
 *
 * ── NO SE MEZCLAN, SE ELIGE UNO ─────────────────────────────────────────────────────────────────
 *
 * Si la persona tiene su fila, el default de la clínica no le toca nada. Fusionarlos —tomar el
 * orden del admin y la visibilidad de la persona, por ejemplo— haría que un bloque se moviera solo
 * un día cualquiera, sin que nadie hubiera tocado su tablero. Eso se lee como un error, no como
 * una novedad, y es imposible de explicar sin contar la regla entera.
 *
 * "Tener su fila" es tener algo RECONOCIBLE en ella: un arreglo vacío, o uno lleno de ids que ya no
 * existen, cae al siguiente origen. Guardar una lista de nada no es una preferencia.
 *
 * Devuelve SIEMPRE el catálogo completo —visibles y ocultos— porque la pantalla de personalizar
 * necesita las dos listas, y separarlas acá obligaría a recomponerlas allá.
 */
export function disposicionEfectiva(
  guardado: Guardado | null | undefined,
  defaultDeLaClinica?: Guardado | null,
): Puesto[] {
  const reconocibles = (g: Guardado | null | undefined) =>
    (g ?? []).filter((x) => typeof x?.id === "string" && POR_ID.has(x.id as IdDeWidget))

  // El primero que diga algo. `??` no sirve: un arreglo vacío no es null y ganaría igual.
  const propio = reconocibles(guardado)
  const fuente = propio.length > 0 ? propio : reconocibles(defaultDeLaClinica)

  const vistos = new Set<IdDeWidget>()
  const salida: Puesto[] = []

  for (const g of fuente) {
    const id = g?.id
    // Se ignora lo que no reconocemos y lo repetido. Un id viejo no puede tirar la pantalla, y un
    // duplicado pintaría el mismo bloque dos veces.
    if (typeof id !== "string" || !POR_ID.has(id as IdDeWidget)) continue
    if (vistos.has(id as IdDeWidget)) continue
    vistos.add(id as IdDeWidget)
    salida.push({ id: id as IdDeWidget, visible: g?.visible !== false })
  }

  // Lo que apareció después de la última vez que esta persona guardó. Visible, al final.
  for (const w of CATALOGO) {
    if (!vistos.has(w.id)) salida.push({ id: w.id, visible: true })
  }

  return salida
}

/** Sólo los que se pintan, en orden. */
export function visibles(d: Puesto[]): Puesto[] {
  return d.filter((p) => p.visible)
}

/** Los datos del catálogo de un puesto. `undefined` si el id no existe (no debería pasar). */
export function widgetDe(id: IdDeWidget): Widget | undefined {
  return POR_ID.get(id)
}

/**
 * Mueve un bloque una posición.
 *
 * MUEVE SOBRE LA LISTA COMPLETA, no sobre los visibles. Si saltara los ocultos, apagar un bloque
 * cambiaría a dónde va el de abajo al subirlo — y el orden guardado dejaría de coincidir con el que
 * se ve al volver a encenderlo.
 */
export function mover(d: Puesto[], id: IdDeWidget, delta: -1 | 1): Puesto[] {
  const i = d.findIndex((p) => p.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= d.length) return d
  const copia = [...d]
  ;[copia[i], copia[j]] = [copia[j], copia[i]]
  return copia
}

/** Reordena por arrastre: saca el de `desde` y lo mete en `hasta`. */
export function reordenar(d: Puesto[], desde: number, hasta: number): Puesto[] {
  if (desde < 0 || hasta < 0 || desde >= d.length || hasta >= d.length || desde === hasta) return d
  const copia = [...d]
  const [sacado] = copia.splice(desde, 1)
  copia.splice(hasta, 0, sacado)
  return copia
}

/** Prende o apaga un bloque. */
export function alternar(d: Puesto[], id: IdDeWidget): Puesto[] {
  return d.map((p) => (p.id === id ? { ...p, visible: !p.visible } : p))
}

/** El tablero de fábrica, para el botón de "volver a como estaba". */
export function porDefecto(): Puesto[] {
  return CATALOGO.map((w) => ({ id: w.id, visible: true }))
}

/**
 * ¿Esta disposición es la de fábrica?
 *
 * Sirve para no escribir en la base cuando no hace falta: alguien que abre el panel, mira y cierra
 * no tiene por qué dejar una fila.
 */
export function esPorDefecto(d: Puesto[]): boolean {
  const f = porDefecto()
  return d.length === f.length && d.every((p, i) => p.id === f[i].id && p.visible === f[i].visible)
}
