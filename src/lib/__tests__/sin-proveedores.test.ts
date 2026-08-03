import { describe, expect, it } from "vitest"

import { sinNombresDeProveedor } from "@/lib/sin-proveedores"

describe("sinNombresDeProveedor", () => {
  it("tacha el mensaje que de verdad se filtraba al toast del vet", () => {
    const antes = "Deepgram respondió 429: {\"err_code\":\"TOO_MANY_REQUESTS\"}"
    expect(sinNombresDeProveedor(antes)).toBe(
      "el proveedor respondió 429: {\"err_code\":\"TOO_MANY_REQUESTS\"}",
    )
  })

  it("se traga el id completo del modelo, no sólo la marca", () => {
    // Sin los sufijos quedaría "el proveedor-v4-flash", que delata igual.
    expect(sinNombresDeProveedor("falló claude-sonnet-5")).toBe("falló el proveedor")
    expect(sinNombresDeProveedor("falló deepseek-v4-flash")).toBe("falló el proveedor")
    expect(sinNombresDeProveedor("falló gpt-4o")).toBe("falló el proveedor")
  })

  it("no distingue mayúsculas y tacha todas las apariciones", () => {
    expect(sinNombresDeProveedor("ANTHROPIC cayó, Anthropic sigue caído")).toBe(
      "el proveedor cayó, el proveedor sigue caído",
    )
  })

  // Estos son el motivo de los límites \b. Sin ellos el tachado rompe español corriente, y un
  // arreglo de privacidad que corrompe los mensajes buenos se termina revirtiendo.
  it("no toca palabras españolas que contienen un nombre de proveedor", () => {
    const frases = [
      "la respuesta no es coherente con la ficha",
      "el titular llama por teléfono",
      "no se pudo grabar en audio/webm;codecs=opus",
      "hay incoherencias en la transcripción",
    ]
    for (const frase of frases) expect(sinNombresDeProveedor(frase)).toBe(frase)
  })

  it("deja intactos los mensajes útiles del microservicio", () => {
    const utiles = [
      "la consulta no tiene audio disponible",
      "el usuario no pertenece a esa clínica",
      "faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el backend",
      "no se pudo transcribir el audio (502)",
    ]
    for (const m of utiles) expect(sinNombresDeProveedor(m)).toBe(m)
  })
})
