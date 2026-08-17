-- Cuántos tokens de entrada vinieron del caché del proveedor.
--
-- POR QUÉ HACE FALTA. Medido el 2026-08-17 sobre esta misma tabla: **la entrada es 40× la salida**
-- (1.824.105 contra 45.185 tokens), y el agente promedia **32.588 tokens de entrada por llamada**.
-- Eso no es lo que Athos escribe: es lo que se le manda cada vez — el prompt de sistema más las
-- definiciones de las 21 herramientas, que son 30 KB de fuente y viajan idénticos en cada llamada.
--
-- El caché de prefijo existe justamente para eso. Pero **no se podía saber si estaba ocurriendo**:
-- el AI SDK reporta el desglose y `registrarUso` lo descartaba, porque su tipo sólo contemplaba
-- `inputTokens` y `outputTokens`.
--
-- SIN ESTAS COLUMNAS, ENCENDER EL CACHÉ ES OPTIMIZAR A CIEGAS. Un cambio que promete ahorrar 90 % y
-- no se puede medir es indistinguible de uno que no hace nada — y esta auditoría ya encontró cuatro
-- veces una mejora que no era tal. Primero el instrumento, después la optimización.
--
-- LOS DOS PROVEEDORES CACHEAN DISTINTO, y por eso esto sirve para ambos:
--   · DeepSeek —el que responde hoy en 62 de 64 llamadas— cachea **automáticamente**, sin
--     marcadores. Puede que ya esté ahorrando y nadie lo sepa: es lo primero que estas columnas van
--     a contestar.
--   · Anthropic exige marcarlo, y el marcador NO va a nivel de llamada como parecía: el proveedor
--     lo lee de `tool.providerOptions` y de los mensajes (`@ai-sdk/anthropic`, `get-cache-control`),
--     o sea POR HERRAMIENTA y POR MENSAJE, con un máximo de 4 puntos de corte.
--
-- POR QUÉ ESTA MIGRACIÓN VIENE SOLA, SIN EL CACHÉ. Porque al leer el SDK aparecieron dos cosas que
-- desarman la estimación con la que se empezó:
--
--   1. El `system` del agente es `PROMPT_ESTABLE + BLOQUE_DINÁMICO` en una sola cadena
--      (`agent/route.ts:147`): fecha, clínica, vet, paciente y señales cambian en cada llamada. Un
--      bloque que cambia no se cachea — y marcado a la ligera produciría ESCRITURAS de caché, que
--      cuestan más que la entrada normal. Lo estable de verdad son las definiciones de herramientas.
--   2. Con DeepSeek respondiendo, un marcador de Anthropic no lo mira nadie.
--
-- Así que el orden correcto es medir primero y decidir después, con el dato en la mano en vez de una
-- proporción supuesta. Esa es la única razón por la que esta migración existe sin su optimización.
--
-- ── POR QUÉ DOS COLUMNAS Y NO UNA ────────────────────────────────────────────────────────────────
--
-- Porque **leer y escribir el caché no cuestan lo mismo**. En Anthropic, escribirlo cuesta MÁS que
-- la entrada normal y leerlo cuesta una fracción. Con una sola cifra de "tokens cacheados" el costo
-- no se puede calcular: la primera llamada de cada ventana escribe (y sale más cara) y las
-- siguientes leen (y salen mucho más baratas). Guardar sólo el total mezclaría las dos y daría un
-- número que parece exacto y no lo es — el mismo defecto que `admin/pricing.ts` documenta al dejar
-- las tarifas de DeepSeek vacías a propósito.
--
-- Los nombres siguen al SDK (`inputTokenDetails.cacheReadTokens` / `.cacheWriteTokens`) para que no
-- haya que traducir mentalmente entre lo que se lee en el código y lo que hay en la tabla.
--
-- NULL Y NO 0. Igual que `tokens_in`: `null` significa "el proveedor no lo reportó" y `0` significa
-- "no hubo caché". Sumar un null como si fuera cero convierte "no sé" en "no pasó", que es la clase
-- de silencio que este esquema evita en todas sus columnas.
--
-- AMBAS VAN INCLUIDAS EN `tokens_in`, que el SDK define como "the TOTAL number of input tokens".
-- Sumarlas aparte al total sería contar dos veces.

alter table public.athos_agent_usage
  add column if not exists tokens_cache_read  integer,
  add column if not exists tokens_cache_write integer;

comment on column public.athos_agent_usage.tokens_cache_read is
  'Tokens de entrada servidos desde el cache del proveedor (inputTokenDetails.cacheReadTokens). '
  'Van INCLUIDOS en tokens_in. null = el proveedor no lo reporto; 0 = no hubo acierto.';

comment on column public.athos_agent_usage.tokens_cache_write is
  'Tokens de entrada escritos al cache (inputTokenDetails.cacheWriteTokens). Cuestan MAS que la '
  'entrada normal: es la primera llamada de cada ventana. Van INCLUIDOS en tokens_in.';
