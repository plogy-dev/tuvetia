import "server-only"

// Las cuatro llaves de Wompi, y de dónde sale el ambiente.
//
// SON CUATRO Y HACEN COSAS DISTINTAS. Confundirlas es el error más caro de esta integración, así
// que quedan escritas:
//
//   · **pública** (`pub_test_` / `pub_prod_`) — tokeniza la tarjeta. Es la ÚNICA que puede viajar
//     al navegador, y tiene que hacerlo: el número de tarjeta va del navegador a Wompi DIRECTO, sin
//     pasar por nuestro servidor. Que no lo toquemos es lo que mantiene el alcance PCI en el mínimo.
//   · **privada** (`prv_test_` / `prv_prod_`) — crea fuentes de pago y cobra. Si esta se filtra,
//     cualquiera puede cobrarle a las tarjetas guardadas. Nunca sale del servidor.
//   · **integridad** (`test_integrity_` / `prod_integrity_`) — firma el monto de cada cobro.
//   · **eventos** (`test_events_` / `prod_events_`) — valida los webhooks entrantes.
//
// EL AMBIENTE SE DEDUCE DE LAS LLAVES, NO DE UNA VARIABLE APARTE. Una `WOMPI_ENV=production` con
// llaves de prueba —o al revés— es el fallo silencioso clásico: todo "funciona", nadie cobra nada
// de verdad, y se descubre al cerrar el mes. Acá el prefijo manda, y si las cuatro no coinciden en
// ambiente la integración se declara mal configurada y no cobra nada.

export type AmbienteWompi = "sandbox" | "production"

const BASE: Record<AmbienteWompi, string> = {
  sandbox: "https://sandbox.wompi.co/v1",
  production: "https://production.wompi.co/v1",
}

export type ConfigWompi = {
  ambiente: AmbienteWompi
  baseUrl: string
  llavePublica: string
  llavePrivada: string
  secretoIntegridad: string
  secretoEventos: string
}

/** Qué ambiente declara un prefijo, o `null` si no reconoce el formato. */
function ambienteDe(llave: string, prefijoTest: string, prefijoProd: string): AmbienteWompi | null {
  if (llave.startsWith(prefijoTest)) return "sandbox"
  if (llave.startsWith(prefijoProd)) return "production"
  return null
}

export type ResultadoConfig =
  | { ok: true; config: ConfigWompi }
  /** `motivo` es para el log del servidor: nombra variables de entorno y no se le muestra a nadie. */
  | { ok: false; motivo: string }

/**
 * Lee y valida la configuración.
 *
 * DEGRADA, NO ROMPE. Es la regla del repo para toda integración externa: sin credenciales, la
 * pantalla de Plan muestra la comparación y dice que el pago no está disponible, en vez de reventar
 * el dashboard entero. Por eso devuelve un resultado y no lanza.
 */
export function configWompi(): ResultadoConfig {
  const llavePublica = process.env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY?.trim() ?? ""
  const llavePrivada = process.env.WOMPI_PRIVATE_KEY?.trim() ?? ""
  const secretoIntegridad = process.env.WOMPI_INTEGRITY_SECRET?.trim() ?? ""
  const secretoEventos = process.env.WOMPI_EVENTS_SECRET?.trim() ?? ""

  const faltan = [
    !llavePublica && "NEXT_PUBLIC_WOMPI_PUBLIC_KEY",
    !llavePrivada && "WOMPI_PRIVATE_KEY",
    !secretoIntegridad && "WOMPI_INTEGRITY_SECRET",
    !secretoEventos && "WOMPI_EVENTS_SECRET",
  ].filter(Boolean)

  if (faltan.length) {
    return { ok: false, motivo: `Faltan variables de Wompi: ${faltan.join(", ")}` }
  }

  const ambientes = {
    publica: ambienteDe(llavePublica, "pub_test_", "pub_prod_"),
    privada: ambienteDe(llavePrivada, "prv_test_", "prv_prod_"),
    integridad: ambienteDe(secretoIntegridad, "test_integrity_", "prod_integrity_"),
    eventos: ambienteDe(secretoEventos, "test_events_", "prod_events_"),
  }

  const desconocidas = Object.entries(ambientes)
    .filter(([, v]) => v === null)
    .map(([k]) => k)
  if (desconocidas.length) {
    return {
      ok: false,
      motivo:
        `Llaves de Wompi con prefijo irreconocible: ${desconocidas.join(", ")}. ` +
        `Se esperan pub_/prv_/…_integrity_/…_events_ en su variante test o prod.`,
    }
  }

  const distintos = new Set(Object.values(ambientes))
  if (distintos.size > 1) {
    // El detalle nombra cuál es cuál: "mezcladas" a secas obliga a revisar las cuatro a mano.
    const detalle = Object.entries(ambientes)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")
    return {
      ok: false,
      motivo: `Llaves de Wompi de ambientes distintos (${detalle}). Las cuatro tienen que ser del mismo.`,
    }
  }

  const ambiente = ambientes.publica as AmbienteWompi

  return {
    ok: true,
    config: {
      ambiente,
      baseUrl: BASE[ambiente],
      llavePublica,
      llavePrivada,
      secretoIntegridad,
      secretoEventos,
    },
  }
}

/**
 * ¿Se puede cobrar hoy?
 *
 * La usa la pantalla de Plan para decidir si muestra el botón de pago o un aviso. No expone el
 * motivo al navegador: los nombres de las variables que faltan son información del servidor.
 */
export function wompiConfigurado(): boolean {
  return configWompi().ok
}
