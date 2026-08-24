// QUÉ INCLUYE CADA PLAN. El único lugar del repo donde se decide.
//
// SIN `server-only` A PROPÓSITO. Lo consumen las dos mitades: las rutas de API y el trigger de la
// base cortan el acceso, y la interfaz decide si muestra la ventana de invitación a Pro. Si cada
// mitad tuviera su propia lista, el día que se mueva una capacidad de plan una de las dos quedaría
// atrás — y el modo en que se nota es el peor posible: la interfaz deja pasar, el servidor corta, y
// el vet ve un error críptico en vez de una invitación a pagar.
//
// POR ESO ACÁ NO HAY NADA DE ENTORNO NI DE BASE DE DATOS. Es un archivo de datos puros, importable
// desde el navegador sin arrastrar nada. El precio vive en `precio.ts` (servidor) y el plan de la
// clínica lo resuelve quien consulte la base.
//
// ── EL CORTE ES POR GASTO, NO POR PANTALLA ─────────────────────────────────────────────────────
//
// La forma corta de decirlo es "gratis todo menos Athos y el Modo Fantasma", y para el vet eso es
// exactamente lo que se ve. Pero Athos no vive sólo en su pantalla: hay IA corriendo DENTRO de
// secciones que son gratis —la sugerencia de respuesta de la bandeja, el modo automático de
// WhatsApp, la clasificación de cartera, la lectura de recetas por foto, el briefing— y todas
// gastan del mismo bolsillo.
//
// Si el corte fuera por pantalla, una clínica gratis seguiría quemando IA por el modo automático de
// WhatsApp y por el barrido diario de cartera, que son justamente las dos que gastan SIN QUE NADIE
// LAS MIRE. Por eso lo que se cobra son las capacidades de abajo y no las rutas: la lista es de
// superficies que llaman a un modelo, y está completa a propósito.

/** Los dos planes. Espeja el CHECK de `clinics.plan`. */
export type Plan = "free" | "pro"

/**
 * Cada superficie que llama a un modelo de IA. Si mañana nace una, va acá —y sólo acá.
 *
 * La regla para saber si algo pertenece a esta lista: **¿gasta plata cada vez que se usa?** No es
 * "¿es una función avanzada?" ni "¿está en la pantalla de Athos?".
 */
export type Capacidad =
  /** El chat clínico con literatura citada, y el widget flotante. */
  | "athos"
  /** Grabar la consulta, transcribirla y redactar la nota. El más caro de todos. */
  | "modo-fantasma"
  /** "Athos sugiere la respuesta" en la bandeja de WhatsApp. */
  | "sugerencia-whatsapp"
  /** El modo automático: Athos contesta solo las preguntas operativas. */
  | "whatsapp-automatico"
  /** Cartera leyendo las respuestas del cliente y clasificando la intención. */
  | "cartera-ia"
  /** Cargar una receta por foto o texto y convertirla en ítems de la factura. */
  | "receta-por-foto"
  /** El resumen diario redactado de la clínica. */
  | "briefing"

/**
 * El plan MÍNIMO que habilita cada capacidad.
 *
 * Hoy todas piden `pro` y la tabla parece redundante. No lo es: es el lugar donde se va a mover una
 * capacidad el día que se decida regalar alguna —por ejemplo, dar el briefing gratis como anzuelo—
 * y ese cambio tiene que ser UNA línea acá, no una cacería por el repo.
 */
export const PLAN_MINIMO: Record<Capacidad, Plan> = {
  athos: "pro",
  "modo-fantasma": "pro",
  "sugerencia-whatsapp": "pro",
  "whatsapp-automatico": "pro",
  "cartera-ia": "pro",
  "receta-por-foto": "pro",
  briefing: "pro",
}

/** Orden de menor a mayor. Lo usa `tieneAcceso` para no comparar planes con `===`. */
const JERARQUIA: Record<Plan, number> = { free: 0, pro: 1 }

/**
 * Normaliza lo que venga de la base.
 *
 * Cae a `free` ante cualquier valor desconocido, y esa dirección importa: un plan ilegible tiene
 * que negar, no conceder. Al revés, un typo en la columna regalaría el producto entero.
 */
export function comoPlan(raw: unknown): Plan {
  return raw === "pro" ? "pro" : "free"
}

/** ¿Esta clínica puede usar esta capacidad? */
export function tieneAcceso(plan: Plan, capacidad: Capacidad): boolean {
  return JERARQUIA[plan] >= JERARQUIA[PLAN_MINIMO[capacidad]]
}

/**
 * Lo que se le dice a alguien que pidió algo que su plan no cubre.
 *
 * Una sola frase para las dos mitades: la que devuelve la API y la que pinta la ventana. Nombra la
 * capacidad, porque "tu plan no incluye esto" sin decir qué es no le sirve a nadie.
 */
export const MENSAJE_REQUIERE_PRO: Record<Capacidad, string> = {
  athos: "Athos es parte del plan Pro.",
  "modo-fantasma": "El Modo Fantasma es parte del plan Pro.",
  "sugerencia-whatsapp": "Las respuestas sugeridas por Athos son parte del plan Pro.",
  "whatsapp-automatico": "El modo automático de WhatsApp es parte del plan Pro.",
  "cartera-ia": "La lectura automática de respuestas de cartera es parte del plan Pro.",
  "receta-por-foto": "Cargar recetas por foto es parte del plan Pro.",
  briefing: "El briefing diario es parte del plan Pro.",
}

// ── Lo que se muestra en la pantalla de Plan ───────────────────────────────────────────────────
//
// Vive acá y no en el componente para que la lista de lo que incluye Pro y la lista de lo que
// realmente se cortea salgan del mismo archivo. Una pantalla de precios que promete algo que el
// gate no entrega es una promesa incumplida con recibo.

export type Bullet = {
  texto: string
  /** El nombre del icono de lucide-react. El componente lo resuelve; acá no se importa React. */
  icono: string
}

/** Lo que se lleva cualquier cuenta, para siempre. */
export const INCLUYE_FREE: Bullet[] = [
  { texto: "Pacientes, titulares e historia clínica completa", icono: "PawPrint" },
  { texto: "Agenda con Google Calendar y Outlook", icono: "Calendar" },
  { texto: "Ventas: facturación DIAN, inventario y cartera", icono: "Receipt" },
  { texto: "Bandeja de WhatsApp y de correo", icono: "MessageCircle" },
  { texto: "Dashboard de la clínica", icono: "LayoutDashboard" },
  { texto: "Equipo sin límite de miembros", icono: "Users" },
  { texto: "Exportá todos tus datos cuando quieras", icono: "Download" },
]

/** Lo que agrega Pro. El orden es el de valor percibido, no el del código. */
export const INCLUYE_PRO: Bullet[] = [
  { texto: "Athos, el copiloto clínico con literatura citada", icono: "Bot" },
  { texto: "Modo Fantasma: la consulta se transcribe y se vuelve nota", icono: "Ghost" },
  { texto: "Athos te sugiere la respuesta en WhatsApp", icono: "Sparkles" },
  { texto: "WhatsApp responde solo las preguntas operativas", icono: "MessagesSquare" },
  { texto: "Cartera lee y clasifica las respuestas de tus clientes", icono: "Wallet" },
  { texto: "Cargá recetas con una foto", icono: "Camera" },
  { texto: "El briefing diario de tu clínica", icono: "Sunrise" },
]

// ── Estado de la suscripción ───────────────────────────────────────────────────────────────────

/** Espeja el CHECK de `clinics.subscription_status`. Ver la migración 0065 para qué es cada uno. */
export type EstadoSuscripcion =
  | "trial"
  | "cortesia"
  | "inactive"
  | "active"
  | "past_due"
  | "canceled"

export function comoEstado(raw: unknown): EstadoSuscripcion {
  const v = typeof raw === "string" ? raw : ""
  return v === "cortesia" ||
    v === "inactive" ||
    v === "active" ||
    v === "past_due" ||
    v === "canceled"
    ? v
    : "trial"
}

/** Lo que se le muestra al vet sobre el estado de su suscripción. */
export const ESTADO_LEGIBLE: Record<EstadoSuscripcion, string> = {
  trial: "Sin suscripción",
  cortesia: "Pro de cortesía",
  inactive: "Sin suscripción",
  active: "Activa",
  past_due: "Pago pendiente",
  canceled: "Cancelada",
}

/**
 * ¿Esta suscripción se cobra sola el mes que viene?
 *
 * `cortesia` NO se cobra —es Pro regalado, sin tarjeta— y por eso la pantalla no le ofrece
 * cancelar: no hay nada que cancelar. `trial` tampoco: no hay tarjeta y no se convierte sola.
 */
export function seRenueva(estado: EstadoSuscripcion): boolean {
  return estado === "active" || estado === "past_due"
}

// ── La prueba de tres días ─────────────────────────────────────────────────────────────────────
//
// Decidida en la reunión del 22-ago. Una prueba NO es un plan nuevo ni una columna nueva: es
// `plan = 'pro'` con `subscription_status = 'trial'` y una fecha en `plan_renueva_en`. La estampa
// un trigger al nacer la clínica (migración 0078) y la baja el barrido cuando vence.
//
// POR ESO NO HAY NADA ACÁ QUE DÉ ACCESO. `tieneAcceso` sigue leyendo `plan` y sólo `plan`, sin
// enterarse de que existen las pruebas — que es la propiedad que hace que esto no pueda abrir un
// agujero. Lo de abajo es para CONTAR y para DECIR, no para decidir.

/** Cuántos días dura. El otro lado de este número está en la migración 0078. */
export const DIAS_DE_PRUEBA = 3

/**
 * ¿Está usando la prueba gratuita AHORA?
 *
 * Pide las dos cosas: el estado `trial` y el plan `pro`. Con el estado solo no alcanza —`trial` es
 * además el default histórico de la columna, y hay una clínica vieja en `free` que lo tiene sin
 * haber probado nada—. El plan es el que manda, acá igual que en el gate.
 */
export function enPrueba(estado: EstadoSuscripcion, plan: Plan): boolean {
  return estado === "trial" && plan === "pro"
}

/**
 * Cuántos días enteros le quedan de prueba. 0 = hoy es el último.
 *
 * Redondea HACIA ARRIBA, que es como lo cuenta quien la está usando: a las 23:00 del primer día
 * todavía "quedan 2 días", no 1,04. Nunca devuelve negativos — una prueba vencida que el barrido
 * todavía no bajó muestra 0, no "-2 días".
 */
export function diasDePruebaRestantes(renuevaEn: string | null, ahora = new Date()): number {
  if (!renuevaEn) return 0
  const fin = new Date(renuevaEn).getTime()
  if (!Number.isFinite(fin)) return 0
  return Math.max(0, Math.ceil((fin - ahora.getTime()) / 86_400_000))
}
