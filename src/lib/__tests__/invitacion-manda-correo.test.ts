// Toda pantalla que cree una invitación tiene que MANDARLA.
//
// EL DEFECTO QUE ESTO FIJA (2026-08-18). El wizard de bienvenida llamaba al RPC `create_invitation`
// —que escribe la fila y devuelve el token— y ahí se detenía: nadie llamaba a
// `/api/team/invite-email`, que es lo único que envía el correo. La invitación quedaba creada, el
// correo no salía nunca, y tres líneas más abajo la misma pantalla decía «También le llega por
// correo». El colega esperaba un mail que nadie había mandado.
//
// Pasaba SÓLO en el wizard: el mismo flujo en Configuración sí llamaba a la ruta. Es el modo de
// fallo más caro de encontrar — la función existe, está probada, funciona, y simplemente hay un
// sitio que no la invoca.
//
// POR QUÉ UN TEST ESTÁTICO Y NO UNO DE COMPORTAMIENTO. Vitest corre acá en `environment: "node"`,
// sin DOM, así que no se puede montar el wizard y apretarle el botón. Un test estructural es más
// pobre, pero atrapa exactamente esta clase de defecto: no verifica que el correo salga —eso lo
// cubren los tests de la ruta— sino que la pantalla se acuerde de pedirlo. Que es lo que faltaba.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const RUTA_DE_ENVIO = "/api/team/invite-email"

/** Cada pantalla desde la que se puede invitar a alguien. Si nace una tercera, va acá. */
const PANTALLAS_QUE_INVITAN = [
  ["el wizard de bienvenida", "src/components/onboarding/welcome-wizard.tsx"],
  ["Configuración → Equipo", "src/components/settings/team-settings.tsx"],
] as const

describe("una invitación creada se envía por correo", () => {
  it.each(PANTALLAS_QUE_INVITAN)("%s llama a la ruta de envío", (_nombre, archivo) => {
    const fuente = readFileSync(join(process.cwd(), archivo), "utf8")

    // Sólo aplica a las pantallas que CREAN invitaciones: si alguna dejara de hacerlo, no tiene
    // nada que enviar y el test no debería exigírselo.
    expect(fuente, `${archivo} debería crear invitaciones`).toContain("create_invitation")

    expect(
      fuente.includes(RUTA_DE_ENVIO),
      `${archivo} crea la invitación pero nunca llama a ${RUTA_DE_ENVIO}: el correo no sale`,
    ).toBe(true)
  })

  // La promesa de la interfaz y lo que el código hace tienen que coincidir. La frase vieja del
  // wizard afirmaba el envío pasara lo que pasara — y era falsa.
  it("el wizard no promete el correo a ciegas: la frase depende del resultado real", () => {
    const fuente = readFileSync(
      join(process.cwd(), "src/components/onboarding/welcome-wizard.tsx"),
      "utf8",
    )

    expect(fuente).toContain("inviteEnviado")
    expect(
      fuente,
      "la frase incondicional «También le llega por correo» es la que mentía",
    ).not.toContain("También le llega por correo.")
  })
})
