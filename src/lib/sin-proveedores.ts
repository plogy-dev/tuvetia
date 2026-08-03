// Segunda capa: tacha nombres de proveedores y modelos de IA en textos que van a la UI.
//
// La primera capa es la fuente. `athos-service` ya no los pone en el `detail` de sus HTTPException
// (ver `app/transcription.py`), que es de donde venía la fuga conocida: el toast del vet llegó a
// decir "Deepgram respondió 429: {200 caracteres del cuerpo crudo}".
//
// Esta existe porque `athos-service` se despliega APARTE (Railway) y puede ir por detrás del front:
// un `detail` nuevo escrito el mes que viene llega al navegador sin pasar por ningún review de acá.
// Y porque `lib/athos.ts` corre en el navegador, así que no hay un "log del servidor" donde
// esconder el original — o el texto sale limpio, o sale.
//
// Es una lista negra, con lo que eso implica: NO es una garantía, es una red. Lo que de verdad
// impide la fuga es no escribir el nombre en origen.
//
// Ojo con el español al agregar términos: `llama` es "llama por teléfono" y `opus` es el códec de
// audio del `MediaRecorder` — los dos quedan fuera a propósito. Los límites `\b` son lo que salva a
// "coherente" de convertirse en "el proveedorente".
const NOMBRES = [
  "deepgram",
  "anthropic",
  "claude",
  "deepseek",
  "openai",
  "chatgpt",
  "gpt",
  "gemini",
  "cohere",
  "sonnet",
  "haiku",
  "mistral",
]

// Un id de modelo es el nombre pegado a su versión (`claude-sonnet-5`, `deepseek-v4-flash`,
// `gpt-4o`): se traga los sufijos para no dejar "el proveedor-v4-flash" a medio tachar.
const PROVEEDORES = new RegExp(`\\b(?:${NOMBRES.join("|")})(?:[-.][a-z0-9]+)*\\b`, "gi")

/** Devuelve el texto con todo nombre de proveedor o modelo reemplazado por "el proveedor". */
export function sinNombresDeProveedor(texto: string): string {
  return texto.replace(PROVEEDORES, "el proveedor")
}
