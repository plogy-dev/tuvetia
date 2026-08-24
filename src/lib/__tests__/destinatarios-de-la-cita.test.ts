/**
 * En el calendario de quién vive el evento y a quién se invita (v5).
 *
 * Lo que se prueba acá es lo que v3 rompió y v5 tiene que garantizar a la vez: que la cita llegue al
 * calendario del vet asignado Y que el administrador la siga viendo. Las dos, no una.
 */
import { describe, expect, it } from "vitest"

import {
  candidatosAAnfitrion,
  correosDeInvitados,
  direccionDeLaClinica,
  perfilesAInvitar,
} from "@/lib/agenda/destinatarios"

const VET = "vet-1"
const ADMIN = "admin-1"
const OTRO_ADMIN = "admin-2"

describe("de quién es el calendario que hospeda", () => {
  it("manda el veterinario asignado, y el admin queda de respaldo", () => {
    expect(candidatosAAnfitrion(VET, ADMIN)).toEqual([VET, ADMIN])
  })

  it("sin veterinario asignado va al del administrador", () => {
    // Una cita sin vet no es de nadie, pero tiene que llegar a algún calendario igual: si no, nadie
    // la ve hasta que alguien se acuerde de mirar Tuvetia.
    expect(candidatosAAnfitrion(null, ADMIN)).toEqual([ADMIN])
  })

  it("si el vet asignado ES el administrador no lo intenta dos veces", () => {
    expect(candidatosAAnfitrion(ADMIN, ADMIN)).toEqual([ADMIN])
  })

  it("sin nadie devuelve vacío en vez de un id falso", () => {
    expect(candidatosAAnfitrion(null, null)).toEqual([])
  })
})

describe("a quién se invita", () => {
  it("van TODOS los admins, aunque el evento viva en el calendario del vet", () => {
    // Es el arreglo del defecto de v3: el evento estaba en la agenda del vet y el administrador no
    // lo veía en ningún lado. Con la invitación lo tiene igual, y por eso sigue siendo cierto que
    // "el admin ve el calendario completo".
    const invitados = perfilesAInvitar({
      anfitrionId: VET,
      adminIds: [ADMIN, OTRO_ADMIN],
      vetId: VET,
      creadorId: ADMIN,
    })
    expect(invitados).toEqual([ADMIN, OTRO_ADMIN])
  })

  it("nunca se invita al anfitrión a su propio evento", () => {
    // Es el organizador: ya lo tiene en su calendario, y los proveedores tratan mal que además
    // figure como invitado.
    const invitados = perfilesAInvitar({
      anfitrionId: ADMIN,
      adminIds: [ADMIN, OTRO_ADMIN],
      vetId: null,
      creadorId: ADMIN,
    })
    expect(invitados).not.toContain(ADMIN)
    expect(invitados).toEqual([OTRO_ADMIN])
  })

  it("suma a quien la creó aunque no sea admin ni el vet asignado", () => {
    const invitados = perfilesAInvitar({
      anfitrionId: VET,
      adminIds: [ADMIN],
      vetId: VET,
      creadorId: "vet-2",
    })
    expect(invitados).toEqual([ADMIN, "vet-2"])
  })

  it("no repite a quien cumple dos papeles a la vez", () => {
    const invitados = perfilesAInvitar({
      anfitrionId: ADMIN,
      adminIds: [ADMIN, OTRO_ADMIN],
      vetId: OTRO_ADMIN,
      creadorId: OTRO_ADMIN,
    })
    expect(invitados).toEqual([OTRO_ADMIN])
  })

  it("ignora los ids vacíos en vez de invitar a la nada", () => {
    expect(
      perfilesAInvitar({ anfitrionId: VET, adminIds: [null, undefined], vetId: VET, creadorId: null }),
    ).toEqual([])
  })
})

describe("los correos de la invitación", () => {
  it("el titular va primero, y después el equipo", () => {
    expect(correosDeInvitados(["a@clinica.co", "b@clinica.co"], "titular@correo.com")).toEqual([
      "titular@correo.com",
      "a@clinica.co",
      "b@clinica.co",
    ])
  })

  it("deduplica por correo y no sólo por perfil", () => {
    // Dos perfiles pueden compartir casilla, y un titular que además trabaja en la clínica
    // aparecería dos veces. Un invitado repetido no rompe el evento, pero le llegan dos
    // invitaciones a la misma persona y eso se lee como que el sistema está roto.
    expect(
      correosDeInvitados(["Ana@Clinica.co", "ana@clinica.co", " ana@clinica.co "], "ana@clinica.co"),
    ).toEqual(["ana@clinica.co"])
  })

  it("omite lo que falta en vez de romper el push", () => {
    // Un titular sin correo cargado no puede impedir que la cita llegue al calendario.
    expect(correosDeInvitados([null, "", undefined, "vet@clinica.co"], null)).toEqual([
      "vet@clinica.co",
    ])
    expect(correosDeInvitados([], null)).toEqual([])
  })
})

describe("la dirección que se adjunta a la cita", () => {
  it("junta calle y ciudad en una línea", () => {
    expect(direccionDeLaClinica({ address: "Cra 7 #45-12", city: "Bogotá" })).toBe(
      "Cra 7 #45-12, Bogotá",
    )
  })

  it("con una sola parte no deja la coma colgando", () => {
    expect(direccionDeLaClinica({ address: "Cra 7 #45-12", city: null })).toBe("Cra 7 #45-12")
    expect(direccionDeLaClinica({ address: "   ", city: "Bogotá" })).toBe("Bogotá")
  })

  it("sin dirección cargada devuelve null y no una cadena vacía", () => {
    // De esto depende que el campo `location` no viaje vacío: un evento con ubicación en blanco se
    // ve peor que uno sin ubicación.
    expect(direccionDeLaClinica({ address: null, city: null })).toBeNull()
    expect(direccionDeLaClinica(null)).toBeNull()
  })
})
