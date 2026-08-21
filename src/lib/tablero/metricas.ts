// Qué cifras puede elegir cada veterinario para la tira de arriba del tablero.
//
// LO QUE SE PIDIÓ: que el veterinario pueda escoger opciones adicionales de métricas a las que ya
// están. El tablero ya era modular a nivel de BLOQUES (`widgets.ts`); esto abre el bloque de las
// cifras, que hasta ahora eran cuatro fijas escritas a mano dentro de la página.
//
// ── LA DIFERENCIA CON `widgets.ts` QUE HAY QUE ENTENDER ────────────────────────────────────────
//
// Aquel archivo decide que **un widget nuevo aparece visible** para todo el mundo, y su razón es
// buena: si no, se envían funciones que la mitad de la gente nunca ve ni sabe que existen.
//
// Acá se hace **lo contrario**, y a propósito. Una métrica nueva NO se enciende sola salvo que
// venga marcada como de fábrica. El motivo es que las dos cosas no se parecen:
//
//   · Un widget nuevo se apila abajo. Ocupa su lugar y no le quita nada a lo que ya estaba.
//   · Una métrica nueva entra en una TIRA HORIZONTAL compartida. Cada una que se enciende sola
//     angosta a todas las demás, y con doce cifras la tira deja de ser un vistazo y pasa a ser una
//     planilla — que es exactamente lo que la tira existe para no ser.
//
// Así que el conjunto de fábrica es curado y corto, y el resto es opt-in. Quien quiera más entra a
// «Armá tu tablero» y las prende: el descubrimiento vive ahí, no en encenderlas por sorpresa.
//
// ── POR QUÉ ALGUNAS DEPENDEN DE FACTURACIÓN ────────────────────────────────────────────────────
//
// Las cifras de plata sólo tienen sentido si la clínica factura desde Tuvetia. Ofrecerlas a una que
// no activó el módulo sería ofrecer ceros permanentes. `requiere` lo marca y la pantalla las
// esconde del catálogo — no las borra: si la clínica activa facturación después, reaparecen para
// elegir sin haber perdido lo que ya estaba guardado.
//
// PURO Y SIN RED, como `widgets.ts`: `vitest.config.mts` corre en `environment: "node"`.

/** Espeja lo que el endpoint de detalle sabe abrir. Si nace una, tiene que nacer también allá. */
export type IdDeMetrica =
  // ── Las de fábrica ──
  | "consultas-mes"
  | "pacientes"
  | "citas-7d"
  | "notas-borrador"
  // ── Las que se pueden agregar ──
  | "consultas-hoy"
  | "citas-hoy"
  | "titulares"
  | "pacientes-nuevos-mes"
  | "vacunas-por-vencer"
  | "facturado-mes"
  | "por-cobrar"

export type Metrica = {
  id: IdDeMetrica
  label: string
  /** La línea de abajo en la tarjeta. Dice QUÉ cuenta; no repite el título. */
  hint: string
  /** Qué contesta, para la pantalla donde se eligen. */
  descripcion: string
  /** Encendida para quien nunca eligió nada. */
  porDefecto: boolean
  /** `facturacion` = sólo se ofrece si el módulo está activo. */
  requiere?: "facturacion"
  /** Se pinta como dinero y no como conteo. */
  dinero?: boolean
}

/** El ORDEN ACÁ es el de fábrica: el de alguien que nunca personalizó nada. */
export const CATALOGO_DE_METRICAS: Metrica[] = [
  {
    id: "consultas-mes",
    label: "Consultas este mes",
    hint: "Consultas registradas en la clínica",
    descripcion: "Cuántas consultas se abrieron desde el primero del mes.",
    porDefecto: true,
  },
  {
    id: "pacientes",
    label: "Pacientes",
    hint: "Fichas activas en la clínica",
    descripcion: "El total de mascotas con ficha.",
    porDefecto: true,
  },
  {
    id: "citas-7d",
    label: "Citas (próx. 7 días)",
    hint: "Agenda de la semana",
    descripcion: "Lo que viene en la semana, sin contar las canceladas.",
    porDefecto: true,
  },
  {
    id: "notas-borrador",
    label: "Notas por revisar",
    hint: "Borradores del Modo Fantasma pendientes de aprobar",
    descripcion: "Las que todavía no entraron a la historia clínica.",
    porDefecto: true,
  },

  {
    id: "consultas-hoy",
    label: "Consultas de hoy",
    hint: "Abiertas desde la medianoche",
    descripcion: "Cómo viene el día, no el mes.",
    porDefecto: false,
  },
  {
    id: "citas-hoy",
    label: "Citas de hoy",
    hint: "Lo que queda por atender hoy",
    descripcion: "Las de hoy, sin las canceladas ni las que no se presentaron.",
    porDefecto: false,
  },
  {
    id: "titulares",
    label: "Titulares",
    hint: "Dueños registrados",
    descripcion: "Cuántas personas, no cuántas mascotas.",
    porDefecto: false,
  },
  {
    id: "pacientes-nuevos-mes",
    label: "Pacientes nuevos",
    hint: "Fichas creadas este mes",
    descripcion: "Si la clínica está creciendo se ve acá, no en el total.",
    porDefecto: false,
  },
  {
    id: "vacunas-por-vencer",
    label: "Refuerzos por vencer",
    hint: "Próximos 30 días, y los ya vencidos",
    descripcion: "La cifra que se convierte en llamadas: quién tiene que volver.",
    porDefecto: false,
  },
  {
    id: "facturado-mes",
    label: "Facturado este mes",
    hint: "Facturas emitidas desde el primero",
    descripcion: "Lo que se facturó, esté cobrado o no.",
    porDefecto: false,
    requiere: "facturacion",
    dinero: true,
  },
  {
    id: "por-cobrar",
    label: "Por cobrar",
    hint: "Saldo pendiente de las facturas emitidas",
    descripcion: "Lo que falta que entre. Distinto de lo facturado.",
    porDefecto: false,
    requiere: "facturacion",
    dinero: true,
  },
]

const POR_ID = new Map(CATALOGO_DE_METRICAS.map((m) => [m.id, m]))

/** Una entrada de la preferencia guardada. */
export type PuestoDeMetrica = { id: IdDeMetrica; visible: boolean }

/** Lo que llega de `tablero_preferencias.metricas`, sin validar. */
export type MetricasGuardadas = { id?: unknown; visible?: unknown }[]

/**
 * Las métricas que rigen: lo que la persona guardó, reconciliado con lo que existe hoy.
 *
 * Devuelve SIEMPRE el catálogo completo —encendidas y apagadas— porque la pantalla de personalizar
 * necesita las dos listas, y separarlas acá obligaría a recomponerlas allá.
 *
 * Un id que ya no existe se ignora: reventar el tablero por una preferencia vieja sería cambiar una
 * cifra de menos por una pantalla en blanco.
 */
export function metricasEfectivas(
  guardado: MetricasGuardadas | null | undefined,
): PuestoDeMetrica[] {
  const vistos = new Set<IdDeMetrica>()
  const salida: PuestoDeMetrica[] = []

  for (const g of guardado ?? []) {
    const id = g?.id
    if (typeof id !== "string" || !POR_ID.has(id as IdDeMetrica)) continue
    if (vistos.has(id as IdDeMetrica)) continue
    vistos.add(id as IdDeMetrica)
    salida.push({ id: id as IdDeMetrica, visible: g?.visible !== false })
  }

  // Lo que apareció DESPUÉS de la última vez que esta persona guardó. Ver la nota de arriba: sólo
  // se enciende sola si es de fábrica; el resto queda esperando a que alguien la elija.
  for (const m of CATALOGO_DE_METRICAS) {
    if (!vistos.has(m.id)) salida.push({ id: m.id, visible: m.porDefecto })
  }

  return salida
}

/** Sólo las encendidas, en orden. */
export function metricasVisibles(d: PuestoDeMetrica[]): PuestoDeMetrica[] {
  return d.filter((p) => p.visible)
}

/** Los datos del catálogo. `undefined` si el id no existe. */
export function metricaDe(id: IdDeMetrica): Metrica | undefined {
  return POR_ID.get(id)
}

/**
 * El catálogo que se le ofrece a ESTA clínica.
 *
 * Sin facturación activa, las cifras de plata no se ofrecen: serían ceros permanentes. No se borran
 * de la preferencia — si la clínica activa el módulo después, reaparecen tal como estaban.
 */
export function catalogoOfrecido(facturacionActiva: boolean): Metrica[] {
  return CATALOGO_DE_METRICAS.filter((m) => m.requiere !== "facturacion" || facturacionActiva)
}

/**
 * Las que hay que PINTAR: encendidas y además ofrecidas.
 *
 * El segundo filtro es el que evita que una clínica que desactivó facturación siga viendo
 * "Por cobrar" en cero para siempre porque alguna vez la prendió.
 */
export function metricasAPintar(
  d: PuestoDeMetrica[],
  facturacionActiva: boolean,
): PuestoDeMetrica[] {
  const ofrecidas = new Set(catalogoOfrecido(facturacionActiva).map((m) => m.id))
  return metricasVisibles(d).filter((p) => ofrecidas.has(p.id))
}

/** Mueve una métrica una posición. Sobre la lista COMPLETA, por lo mismo que en `widgets.ts`. */
export function moverMetrica(
  d: PuestoDeMetrica[],
  id: IdDeMetrica,
  delta: -1 | 1,
): PuestoDeMetrica[] {
  const i = d.findIndex((p) => p.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= d.length) return d
  const copia = [...d]
  const arriba = copia[i]
  copia[i] = copia[j]
  copia[j] = arriba
  return copia
}

/** Enciende o apaga una métrica. */
export function alternarMetrica(d: PuestoDeMetrica[], id: IdDeMetrica): PuestoDeMetrica[] {
  return d.map((p) => (p.id === id ? { ...p, visible: !p.visible } : p))
}
