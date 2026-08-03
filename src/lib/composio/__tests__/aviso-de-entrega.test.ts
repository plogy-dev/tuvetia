/**
 * "Enviado con éxito" y "llegó" no son lo mismo.
 *
 * EL CASO REAL, que costó una tarde: se conectó una cuenta de Microsoft cuya dirección es
 * `@gmail.com` — se puede, una cuenta Microsoft se registra con cualquier correo. Athos mostraba
 * "✓ Ejecutada", el mensaje quedaba en Enviados, la API respondía éxito… y no llegaba a ningún
 * lado. El SPF de gmail.com sólo autoriza a Google (`v=spf1 redirect=_spf.google.com`), así que un
 * correo que sale de Microsoft diciendo ser de gmail.com falla la autenticación y el receptor lo
 * filtra.
 *
 * Nada de eso es un error que la API nos devuelva: hay que deducirlo del dominio. De ahí este
 * chequeo, y de ahí que sea importante que no se vuelva ruidoso — un aviso que salta de más se
 * ignora, y entonces no sirve para el día que importa.
 */
import { describe, expect, it } from "vitest"

import { avisoDeEntrega, direccionDelPerfil } from "@/lib/composio/proveedores"

describe("avisoDeEntrega", () => {
  it("avisa cuando una cuenta de Microsoft envía desde un dominio de otro proveedor", () => {
    const aviso = avisoDeEntrega("outlook", "devsplogy@gmail.com")
    expect(aviso).toBeTruthy()
    // Tiene que nombrar la dirección concreta: "revisá tu configuración" no le sirve a nadie.
    expect(aviso).toContain("devsplogy@gmail.com")
  })

  it("se calla con las direcciones que Microsoft sí puede autenticar", () => {
    for (const email of ["ana@outlook.com", "ana@hotmail.com", "ana@live.com.ar", "vet@clinica.co"]) {
      expect(avisoDeEntrega("outlook", email), email).toBeNull()
    }
  })

  it("no dice nada de un dominio propio, del que no sabemos nada", () => {
    // `clinica.com` puede estar perfectamente configurado para que Microsoft envíe por él. Avisar
    // ahí sería adivinar, y entrenaría a la gente a ignorar el aviso.
    expect(avisoDeEntrega("outlook", "vet@clinica.com")).toBeNull()
  })

  it("con Gmail nunca avisa: la dirección de la cuenta siempre es de quien envía", () => {
    for (const email of ["ana@gmail.com", "vet@clinica.co", null]) {
      expect(avisoDeEntrega("gmail", email)).toBeNull()
    }
  })

  it("sin dirección no inventa un aviso", () => {
    expect(avisoDeEntrega("outlook", null)).toBeNull()
  })
})

describe("direccionDelPerfil", () => {
  it("lee la forma de Gmail y la de Graph, envuelta o no", () => {
    expect(direccionDelPerfil({ emailAddress: "ana@gmail.com" })).toBe("ana@gmail.com")
    expect(direccionDelPerfil({ response_data: { mail: "ana@outlook.com" } })).toBe("ana@outlook.com")
    expect(direccionDelPerfil({ response_data: { userPrincipalName: "ana@clinica.co" } })).toBe(
      "ana@clinica.co",
    )
  })

  it("devuelve null si no hay dirección, en vez de un valor cualquiera", () => {
    // La dirección se muestra como "envía como X": inventarla sería peor que no mostrar nada.
    for (const raro of [null, undefined, {}, { displayName: "Plogy App" }, "texto"]) {
      expect(direccionDelPerfil(raro)).toBeNull()
    }
  })
})
