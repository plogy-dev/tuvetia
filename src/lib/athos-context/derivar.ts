// Qué está mirando el veterinario, derivado de la ruta.
//
// POR QUÉ EXISTE. Athos pasa a estar presente en toda la app, y un asistente que no sabe qué tenés
// en pantalla obliga a repetirle el contexto en cada pregunta ("¿qué le doy?" no significa nada sin
// saber a quién). Hoy el paciente actual se sabe de CUATRO formas distintas y ninguna compartida:
// parámetro de ruta, query string, estado local de un componente y props desde un server component.
//
// Las dos primeras se leen del router, y son las únicas que hacen falta para el 90% de los casos.
// Las otras dos entran por un canal aparte y OPCIONAL, así que ninguna pantalla está obligada a
// cambiar para que esto funcione.
//
// Es una función PURA, sin React ni imports de Next, por el mismo motivo que `lib/nav-active.ts`:
// la lógica de "qué ruta es esta" se prueba con una tabla de casos y no montando la app. El repo no
// tiene infraestructura para testear componentes (vitest corre en `environment: "node"`), así que
// todo lo que quiera cobertura tiene que vivir en un `.ts` como éste.

export type AthosContexto =
  | { tipo: "paciente"; patientId: string }
  | { tipo: "consulta"; consultaId: string }
  | { tipo: "asistente"; patientId: string | null }
  | { tipo: "titulares" }
  | { tipo: "agenda" }
  | { tipo: "comunicaciones" }
  | { tipo: "facturacion"; facturaId: string | null }
  | { tipo: "general" }

// Un uuid v4 tal como los genera Postgres. Se valida la FORMA antes de tratar un segmento como id:
// `/dashboard/facturacion/catalogo` no es una factura, y sin esto "catalogo" viajaría al agente
// como si fuera un identificador.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const esUuid = (s: string | undefined): s is string => Boolean(s && UUID.test(s))

/**
 * @param pathname el de `usePathname()`
 * @param sp       el de `useSearchParams()` — sólo se lee `patient`
 */
export function derivarContexto(pathname: string, sp?: URLSearchParams): AthosContexto {
  // Se normaliza la barra final: `/dashboard/patients/` y `/dashboard/patients` son la misma
  // pantalla, y el `split` los parte distinto.
  const partes = pathname.replace(/\/+$/, "").split("/").filter(Boolean)
  // ["dashboard", seccion, ...resto]
  if (partes[0] !== "dashboard") return { tipo: "general" }

  const seccion = partes[1]
  const primero = partes[2]

  switch (seccion) {
    case "patients":
      return esUuid(primero) ? { tipo: "paciente", patientId: primero } : { tipo: "general" }

    case "consultas":
      return esUuid(primero) ? { tipo: "consulta", consultaId: primero } : { tipo: "general" }

    case "asistente": {
      // El sidebar enlaza `/dashboard/asistente?patient=<uuid>`; el server ya lo valida contra los
      // pacientes de la clínica, así que acá sólo se comprueba la forma.
      const p = sp?.get("patient") ?? null
      return { tipo: "asistente", patientId: esUuid(p ?? undefined) ? p : null }
    }

    case "owners":
      return { tipo: "titulares" }

    case "calendario":
      return { tipo: "agenda" }

    case "comunicaciones":
      return { tipo: "comunicaciones" }

    case "facturacion":
      // `/facturacion/nueva`, `/facturacion/catalogo`, `/facturacion/compras/...` no son facturas.
      return { tipo: "facturacion", facturaId: esUuid(primero) ? primero : null }

    default:
      // Configuración, Conexiones, Ayuda, el dashboard pelado y lo que venga después.
      return { tipo: "general" }
  }
}

/**
 * El paciente del contexto, si la ruta lo dice.
 *
 * `consulta` NO devuelve paciente aunque lo tenga: la ruta sólo trae el id de la consulta, y
 * resolverlo exige una consulta a la base. Eso lo hace el widget cuando hace falta —perezosamente,
 * al abrirse— para que estar presente no cueste una query en cada navegación.
 */
export function pacienteDelContexto(c: AthosContexto): string | null {
  if (c.tipo === "paciente") return c.patientId
  if (c.tipo === "asistente") return c.patientId
  return null
}

/**
 * Cómo se le nombra al vet lo que está mirando. Va en la etiqueta del widget y en el prompt del
 * agente, así que se lee como una frase, no como un slug.
 */
export function describirContexto(c: AthosContexto): string {
  switch (c.tipo) {
    case "paciente":
      return "la ficha de un paciente"
    case "consulta":
      return "una consulta en curso"
    case "asistente":
      return "el chat de Athos"
    case "titulares":
      return "los titulares"
    case "agenda":
      return "la agenda"
    case "comunicaciones":
      return "las conversaciones con titulares"
    case "facturacion":
      return c.facturaId ? "una factura" : "facturación"
    case "general":
      return "la plataforma"
  }
}
