// Chequeo de configuración del despliegue. Responde qué está cableado, NUNCA con qué valor.
//
// Por qué existe: hoy no había forma de saber desde afuera si producción quedó bien configurada. La
// auditoría del Milestone 2 encontró exactamente eso — variables faltantes que apagan funciones
// enteras EN SILENCIO: sin CRON_SECRET la purga de audio (retención de 4 días, Ley 1581) deja de
// correr; sin SUPABASE_SERVICE_ROLE_KEY fallan las escrituras del agente y los webhooks; sin
// ANTHROPIC_API_KEY el agente de 17 tools no responde. Nada de eso da un error visible en la UI: el
// vet ve una función que "no hace nada".
//
// Protegido con CRON_SECRET, el mismo secreto que ya guarda los crons: saber qué integraciones
// tiene una clínica es información útil para un atacante. Y solo devuelve BOOLEANOS — jamás el
// valor, ni un prefijo, ni la longitud (salvo donde la longitud ES el requisito, ver más abajo).

export const dynamic = "force-dynamic" // nunca cachear: refleja el estado del proceso vivo

/** true si la env existe y no está vacía (una env definida en blanco es tan inútil como ausente). */
const set = (name: string): boolean => Boolean(process.env[name]?.trim())

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return new Response("No configurado (falta CRON_SECRET)", { status: 503 })
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  // WHATSAPP_TOKEN_KEY debe ser 32 bytes en base64: si no, el cifrado de los business token de Meta
  // lanza en caliente al conectar. Se valida la FORMA, no se revela el valor.
  const tokenKey = process.env.WHATSAPP_TOKEN_KEY?.trim()
  const tokenKeyValid = Boolean(tokenKey) && Buffer.from(tokenKey ?? "", "base64").length === 32

  // Al menos un proveedor de WhatsApp tiene que estar cableado, o Comunicaciones no envía nada.
  const whatsappProviders = {
    kapso: set("KAPSO_API_KEY") && set("KAPSO_WEBHOOK_SECRET"),
    meta: set("META_APP_ID") && set("META_APP_SECRET"),
    evolution: set("EVOLUTION_API_URL") && set("EVOLUTION_WEBHOOK_TOKEN"),
  }

  const checks = {
    // Sin esto no hay escrituras del agente, ni webhooks, ni crons, ni feed ICS.
    supabase_service_role: set("SUPABASE_SERVICE_ROLE_KEY"),
    // El agente (17 tools), el modo auto y la visión de facturas usan Anthropic.
    anthropic_key: set("ANTHROPIC_API_KEY"),
    // Los dos crons: barrido de cartera y purga de audio.
    cron_secret: true, // si llegamos acá, existe y coincide
    // La tool de evidencia del agente apunta al backend por esta URL.
    athos_url: set("NEXT_PUBLIC_ATHOS_URL"),
    // Cifrado de tokens de WhatsApp: presente Y con la forma correcta.
    whatsapp_token_key: tokenKeyValid,
    whatsapp_provider: Object.values(whatsappProviders).some(Boolean),
    // Origin canónico para los redirects de OAuth y los links de cartera.
    site_url: set("NEXT_PUBLIC_SITE_URL"),
  }

  const missing = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([k]) => k)

  return Response.json(
    { ok: missing.length === 0, checks, whatsapp_providers: whatsappProviders, missing },
    // 200 igual cuando falta algo: el cuerpo dice qué. Un 500 acá haría creer que el endpoint está
    // roto, cuando lo que está incompleto es la configuración.
    { status: 200 },
  )
}
