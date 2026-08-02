// Los SDKs de proveedor deben hablar la MISMA especificación que la cascada.
//
// Por qué existe esta prueba. Al cablear Gemini (2026-08-02), `npm i @ai-sdk/google` trajo la 4.x,
// que habla la especificación **v4**. La cascada exige v3 (`esV3`), así que un modelo v4 no es un
// error ruidoso: se DESCARTA como respaldo inválido y la cadena sigue funcionando con un proveedor
// menos. O sea, se cree que hay tres y hay dos, y sólo se nota cuando los otros dos ya cayeron.
//
// Sin esta prueba, un `npm update` volvería a introducirlo en silencio.
import { describe, expect, it } from "vitest"
import { anthropic } from "@ai-sdk/anthropic"
import { createDeepSeek } from "@ai-sdk/deepseek"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import type { LanguageModelV3 } from "@ai-sdk/provider"

const deepseek = createDeepSeek({ apiKey: "x" })
const google = createGoogleGenerativeAI({ apiKey: "x" })

describe("los SDKs reales hablan v3, que es lo que la cascada envuelve", () => {
  it.each([
    ["anthropic", anthropic("claude-sonnet-5")],
    ["deepseek", deepseek("deepseek-v4-flash")],
    ["google", google("gemini-3.6-flash")],
  ])("%s", (_nombre, modelo) => {
    expect((modelo as LanguageModelV3).specificationVersion).toBe("v3")
  })
})
