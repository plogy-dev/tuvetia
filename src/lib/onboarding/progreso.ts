// El riel de configuración: qué le falta a una clínica para estar realmente puesta en marcha.
//
// POR QUÉ ESTO Y NO EL CHECKLIST QUE YA HABÍA. `dashboard/onboarding-checklist.tsx` medía tres
// cosas —primer paciente, una grabación, una nota aprobada— y las tres son de USO, no de
// CONFIGURACIÓN. Una clínica podía tenerlas las tres y seguir sin horarios de atención, sin
// servicios en el catálogo y sin WhatsApp: o sea, con Athos incapaz de proponer una cita, de
// cobrar nada y de avisarle a nadie. El checklist decía "listo" sobre una plataforma vacía.
//
// El cliente lo pidió así: "un flujo para que los veterinarios puedan ir llenando la plataforma
// progresivamente desde que se registran. Por ejemplo: Nombre de clinica, Servicios,
// Comunicaciones, etc."
//
// ESTE MÓDULO ES PURO A PROPÓSITO. `vitest.config.mts` corre en `environment: "node"` y sólo mira
// `src/**/*.test.ts`: no hay infraestructura para testear componentes. Lo que quiera cobertura
// tiene que ser un `.ts` sin React adentro. Los datos los trae `consultar.ts`; acá sólo se decide
// qué significan.

/** Los pasos, en el orden en que conviene hacerlos. */
export type PasoId = "logo" | "horarios" | "paciente" | "servicios" | "whatsapp" | "equipo"

export type Paso = {
  id: PasoId
  titulo: string
  /** Qué se desbloquea al hacerlo. No es adorno: es la razón para molestarse. */
  porQue: string
  href: string
  hecho: boolean
}

/**
 * Los hechos crudos de la clínica. Todos booleanos y todos de NIVEL CLÍNICA.
 *
 * Lo que NO está acá, y es deliberado: el correo de Athos. Desde que el correo pasó a Composio
 * (`lib/composio/correo.ts`) la conexión es POR PERSONA, no por clínica —`email_integrations` es
 * una tabla retirada, era la cuenta SMTP institucional—. Meterlo haría que el porcentaje de la
 * clínica cambiara según QUIÉN mira, que es lo contrario de un riel de configuración. Comunicaciones
 * queda representada por WhatsApp, que sí es de la clínica.
 */
export type HechosDeLaClinica = {
  tieneLogo: boolean
  tieneHorarios: boolean
  tienePaciente: boolean
  tieneServicios: boolean
  whatsappConectado: boolean
  tieneEquipo: boolean
}

export type Progreso = {
  pasos: Paso[]
  hechos: number
  total: number
  /** Entero 0–100. Redondeado hacia abajo salvo al completar, para no mostrar 100% con algo pendiente. */
  porcentaje: number
  completo: boolean
  /** El siguiente paso pendiente, o null si no queda ninguno. */
  siguiente: Paso | null
}

/**
 * `/dashboard/settings` aparece tres veces porque las tres cosas se configuran ahí. No se inventan
 * anclas: un `#hash` que no exista deja al vet mirando el tope de la página sin entender por qué.
 */
const DEFINICIONES: ReadonlyArray<Omit<Paso, "hecho">> = [
  {
    id: "logo",
    titulo: "Logo de la clínica",
    porQue: "Sale en las facturas y en los correos al titular.",
    href: "/dashboard/settings",
  },
  {
    id: "horarios",
    titulo: "Horarios de atención",
    porQue: "Sin ellos Athos no puede ofrecer un espacio libre ni agendar nada.",
    href: "/dashboard/settings",
  },
  {
    id: "paciente",
    titulo: "Primer paciente",
    porQue: "Es lo que convierte la cuenta en una clínica con historia.",
    href: "/dashboard/patients",
  },
  {
    id: "servicios",
    titulo: "Servicios en el catálogo",
    porQue: "Sin servicios no se puede facturar una consulta.",
    href: "/dashboard/facturacion/catalogo?tab=servicios",
  },
  {
    id: "whatsapp",
    titulo: "WhatsApp conectado",
    porQue: "Es por donde salen los recordatorios de cita y de cobro.",
    href: "/dashboard/conexiones",
  },
  {
    id: "equipo",
    titulo: "Equipo invitado",
    porQue: "Cada quien entra con su usuario y la ficha dice quién atendió.",
    href: "/dashboard/settings",
  },
]

/** Cuántos pasos tiene el riel. Exportado para que los tests no lo hardcodeen. */
export const TOTAL_PASOS = DEFINICIONES.length

export function calcularProgreso(h: HechosDeLaClinica): Progreso {
  const estado: Record<PasoId, boolean> = {
    logo: h.tieneLogo,
    horarios: h.tieneHorarios,
    paciente: h.tienePaciente,
    servicios: h.tieneServicios,
    whatsapp: h.whatsappConectado,
    equipo: h.tieneEquipo,
  }

  const pasos = DEFINICIONES.map((d) => ({ ...d, hecho: estado[d.id] }))
  const hechos = pasos.filter((p) => p.hecho).length
  const total = pasos.length

  // `Math.floor` y no `Math.round`: con 5 de 6, redondear da 83% y está bien, pero el caso que
  // importa es que NADA que no esté completo pueda mostrar 100%. Floor lo garantiza siempre.
  const porcentaje = total === 0 ? 100 : Math.floor((hechos / total) * 100)

  return {
    pasos,
    hechos,
    total,
    porcentaje,
    completo: hechos === total,
    siguiente: pasos.find((p) => !p.hecho) ?? null,
  }
}
