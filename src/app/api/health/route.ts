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
  // Nombres verificados uno por uno contra el código: `EVOLUTION_BASE_URL` (no ..._API_URL, que fue
  // el primer intento y habría reportado Evolution como sin configurar estándolo).
  const whatsappProviders = {
    kapso: set("KAPSO_API_KEY") && set("KAPSO_WEBHOOK_SECRET"),
    // META_WEBHOOK_VERIFY_TOKEN incluido: sin él el challenge de Meta falla, y el test e2e del 403
    // pasa igual con la variable ausente (cualquier token es "incorrecto" cuando no hay ninguno).
    meta: set("META_APP_ID") && set("META_APP_SECRET") && set("META_WEBHOOK_VERIFY_TOKEN"),
    evolution: set("EVOLUTION_BASE_URL") && set("EVOLUTION_API_KEY") && set("EVOLUTION_WEBHOOK_TOKEN"),
  }

  // El agente puede correr con Anthropic (default) o DeepSeek según ATHOS_AGENT_PROVIDER
  // (`src/lib/athos-agent/model.ts`). Chequear siempre ANTHROPIC_API_KEY reportaba ok:true con el
  // agente sin credencial cuando el proveedor era DeepSeek.
  const agentProvider = process.env.ATHOS_AGENT_PROVIDER?.trim() || "anthropic"

  // Y con la CASCADA encendida hay más de un proveedor en juego. Este chequeo mira `*_PROVIDER`,
  // que sigue siendo "anthropic" cuando DeepSeek es sólo el RESPALDO — así que sin esto el endpoint
  // reportaría ok:true con un respaldo sin credencial. Ese respaldo no protege de nada: cuando el
  // primario se cae por saldo, el respaldo falla por credencial y se propaga el error original. Peor
  // que no tenerlo, porque suma una llamada perdida y la falsa tranquilidad de creerlo cubierto.
  //
  // Se recorren las tres cadenas y se junta la credencial que cada entrada necesita.
  //
  // El `?? "anthropic"` NO es decorativo: `leerCadena` (athos-agent/cascada.ts) resuelve una entrada
  // sin `@proveedor` como Anthropic. Si acá se descartaran esas entradas, una cadena escrita
  // "claude-sonnet-5,deepseek-v4@deepseek" pasaría el chequeo sin haber verificado nunca la
  // credencial que su primer modelo necesita. Dos lugares que interpretan el mismo string tienen
  // que interpretarlo igual, o el health miente sobre la configuración que valida.
  const proveedoresDeCascada = new Set(
    [
      process.env.ATHOS_AGENT_CASCADE,
      process.env.ATHOS_AUTO_CASCADE,
      process.env.ATHOS_VISION_CASCADE,
    ].flatMap((cadena) =>
      (cadena ?? "")
        .split(",")
        .map((par) => par.trim())
        .filter(Boolean)
        .map((par) => par.split("@")[1]?.trim() || "anthropic"),
    ),
  )
  // La credencial que necesita cada proveedor. Antes esto era `p === "deepseek" ? DEEPSEEK : ANTHROPIC`,
  // o sea que TODO lo que no fuera DeepSeek se validaba contra la key de Anthropic — incluido Gemini,
  // que entró a las tres cadenas el 02-ago. Con la cascada apuntando a `@google` y sin
  // `GEMINI_API_KEY`, este chequeo respondía `true`: exactamente el fallo que el comentario de arriba
  // dice haber cerrado, reintroducido al sumar el tercer proveedor.
  //
  // Un proveedor DESCONOCIDO ahora falla en vez de pasar como Anthropic: un typo en la cadena
  // (`@gemini` en vez de `@google`) es un respaldo que no existe, y el endpoint tiene que decirlo.
  const CREDENCIAL_POR_PROVEEDOR: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    google: "GEMINI_API_KEY", // el nombre lo fija `athos-agent/model.ts`: misma cuenta que el backend
  }
  const credencialDe = (p: string): boolean => {
    const env = CREDENCIAL_POR_PROVEEDOR[p]
    return env ? set(env) : false
  }
  const cascadaConCredenciales = [...proveedoresDeCascada].every(credencialDe)

  // Proveedor de WhatsApp que la UI va a OFRECER, que no es lo mismo que "hay alguno cableado".
  // `whatsapp-settings.tsx:22,247` elige evolution -> meta -> kapso por precedencia, así que sin
  // NEXT_PUBLIC_WA_PROVIDER=evolution el botón "Conectar" cae a Kapso y SACA al veterinario de la
  // plataforma. Se declara acá para poder contrastar lo que la UI ofrece con lo que hay configurado.
  const waDeclarado = process.env.NEXT_PUBLIC_WA_PROVIDER?.trim() || null

  const checks = {
    // Sin esto no hay escrituras del agente, ni webhooks, ni crons, ni feed ICS.
    supabase_service_role: set("SUPABASE_SERVICE_ROLE_KEY"),
    // El agente (17 tools), el modo auto y la visión de facturas usan Anthropic. Ojo: este nombre no
    // aparece en nuestro código — lo lee `@ai-sdk/anthropic` del entorno por convención. Justamente
    // por eso hace falta chequearlo acá: un grep del repo no lo encuentra y pasa desapercibido.
    anthropic_key: set("ANTHROPIC_API_KEY"),
    // La credencial del proveedor que el agente USA de verdad (puede no ser Anthropic).
    agent_provider_key: credencialDe(agentProvider),
    // Todos los proveedores nombrados en las cadenas de cascada tienen su key. Sin cascada
    // configurada el conjunto está vacío y esto da true, que es lo correcto: no hay nada que cubrir.
    cascada_con_credenciales: cascadaConCredenciales,
    // La cobranza en modo simulacro NO envía nada y no deja síntoma: es literalmente el fallo
    // silencioso que este endpoint existe para atrapar. En producción debe estar apagado.
    cartera_envio_real: process.env.CARTERA_MESSAGING_SIMULATED !== "1",
    // Los dos crons: barrido de cartera y purga de audio.
    cron_secret: true, // si llegamos acá, existe y coincide
    // La tool de evidencia del agente apunta al backend por esta URL.
    athos_url: set("NEXT_PUBLIC_ATHOS_URL"),
    // Cifrado de tokens de WhatsApp: presente Y con la forma correcta.
    whatsapp_token_key: tokenKeyValid,
    whatsapp_provider: Object.values(whatsappProviders).some(Boolean),
    // COHERENCIA, que es distinto de lo de arriba: que el proveedor que la UI ofrece sea justo el
    // que tiene credenciales. El check anterior es un OR — pasaba en verde con credenciales de
    // Kapso (legado, en retirada) mientras Evolution, el que se va a usar, estaba sin configurar.
    // Un verde que no significa lo que aparenta es peor que un rojo.
    whatsapp_provider_coherente:
      waDeclarado === null
        ? Object.values(whatsappProviders).some(Boolean) // sin declarar: basta con que haya alguno
        : whatsappProviders[waDeclarado as keyof typeof whatsappProviders] === true,
    // Origin canónico para los redirects de OAuth y los links de cartera.
    site_url: set("NEXT_PUBLIC_SITE_URL"),
    // Sin esta allowlist NADIE entra a /admin (falla cerrado, que es lo correcto, pero conviene
    // enterarse acá y no descubriéndolo cuando alguien la necesita).
    platform_admins: set("PLATFORM_ADMIN_EMAILS"),
  }

  const missing = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([k]) => k)

  return Response.json(
    {
      ok: missing.length === 0,
      checks,
      whatsapp_providers: whatsappProviders,
      // Solo el NOMBRE del proveedor declarado (nunca un valor secreto): es lo que hace depurable
      // el caso "todo cableado pero el botón ofrece otro camino".
      wa_provider_declarado: waDeclarado,
      missing,
    },
    // 200 igual cuando falta algo: el cuerpo dice qué. Un 500 acá haría creer que el endpoint está
    // roto, cuando lo que está incompleto es la configuración.
    { status: 200 },
  )
}
