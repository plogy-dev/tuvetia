"use server"

import { registrarBaja } from "@/lib/email/baja"

// LA BAJA SE ESCRIBE EN UN POST, NUNCA EN EL GET QUE ABRE LA PÁGINA.
//
// No es purismo REST: los filtros de correo corporativos y los antivirus ABREN los enlaces de un
// mensaje para revisarlos antes de entregarlo. Con la baja colgada del GET, media lista quedaría
// dada de baja sola —sin que nadie hiciera clic— y el síntoma sería una audiencia que encoge sin
// explicación. Por eso el enlace lleva a una página que pregunta, y el botón es el que escribe.
//
// Es una server action y por lo tanto un endpoint: no depende de que la página la deshabilite.

export async function darDeBaja(token: string, motivo: string | null): Promise<{ ok: boolean }> {
  return { ok: await registrarBaja(token, motivo) }
}
