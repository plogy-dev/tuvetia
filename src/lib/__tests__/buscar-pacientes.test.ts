// La búsqueda del selector de contexto de Athos.
//
// Reemplaza a un `<Select>` que pintaba hasta 500 pacientes de corrido, que es el problema que el
// cliente planteó en la reunión del 17-ago con estas palabras: "en el momento en que yo tenga 200
// pacientes, ¿cómo carajo le voy a decir al man qué contexto tiene? Imposible".

import { describe, expect, it } from "vitest"

import { buscarPacientes, normalizar, type PacienteBuscable } from "@/lib/athos-context/buscar-pacientes"

const PACIENTES: PacienteBuscable[] = [
  { id: "1", name: "Manchita", species: "Gato", owner: "María García" },
  { id: "2", name: "Manchita", species: "Perro", owner: "Pedro Rueda" },
  { id: "3", name: "Muñeca", species: "Perro", owner: "Ana Bogotá" },
  { id: "4", name: "Rocky", species: "Perro", owner: "María García" },
  { id: "5", name: "Simón", species: "Hurón", owner: null },
]

const nombres = (ps: PacienteBuscable[]) => ps.map((p) => p.name)
const ids = (ps: PacienteBuscable[]) => ps.map((p) => p.id)

describe("normalizar", () => {
  it("quita tildes y baja a minúsculas", () => {
    expect(normalizar("Bogotá")).toBe("bogota")
    expect(normalizar("SIMÓN")).toBe("simon")
  })

  it("la ñ se busca como n, que es como la escribe quien va apurado", () => {
    expect(normalizar("Muñeca")).toBe("muneca")
  })

  it("recorta los bordes", () => {
    expect(normalizar("  Rocky  ")).toBe("rocky")
  })
})

describe("con el campo vacío se ve todo", () => {
  it("devuelve la lista entera", () => {
    expect(buscarPacientes(PACIENTES, "")).toHaveLength(5)
    expect(buscarPacientes(PACIENTES, "   ")).toHaveLength(5)
  })

  it("pero acotada al límite: no se montan 500 filas para ver seis", () => {
    const muchos = Array.from({ length: 500 }, (_, i) => ({
      id: String(i),
      name: `Paciente ${i}`,
      species: "Perro",
    }))
    expect(buscarPacientes(muchos, "", 50)).toHaveLength(50)
  })
})

describe("busca por nombre, especie y titular", () => {
  it("por nombre de la mascota", () => {
    expect(nombres(buscarPacientes(PACIENTES, "rocky"))).toEqual(["Rocky"])
  })

  it("por especie", () => {
    expect(nombres(buscarPacientes(PACIENTES, "huron"))).toEqual(["Simón"])
  })

  it("por titular", () => {
    expect(nombres(buscarPacientes(PACIENTES, "rueda"))).toEqual(["Manchita"])
  })

  it("sin tildes encuentra lo que las tiene, en cualquier campo", () => {
    expect(nombres(buscarPacientes(PACIENTES, "muneca"))).toEqual(["Muñeca"])
    expect(nombres(buscarPacientes(PACIENTES, "simon"))).toEqual(["Simón"])
    expect(nombres(buscarPacientes(PACIENTES, "bogota"))).toEqual(["Muñeca"])
  })

  it("un titular ausente no rompe la búsqueda", () => {
    expect(() => buscarPacientes(PACIENTES, "cualquiera")).not.toThrow()
    expect(nombres(buscarPacientes(PACIENTES, "simon"))).toEqual(["Simón"])
  })
})

// LO QUE RESUELVE LA OBJECIÓN DE JESÚS: con dos "Manchita", el titular es lo que las separa.
describe("desambiguar dos mascotas con el mismo nombre", () => {
  it("el nombre solo devuelve las dos", () => {
    expect(ids(buscarPacientes(PACIENTES, "manchita"))).toEqual(["1", "2"])
  })

  it("nombre + titular deja una sola", () => {
    expect(ids(buscarPacientes(PACIENTES, "manchita garcia"))).toEqual(["1"])
    expect(ids(buscarPacientes(PACIENTES, "manchita rueda"))).toEqual(["2"])
  })

  it("nombre + especie también", () => {
    expect(ids(buscarPacientes(PACIENTES, "manchita gato"))).toEqual(["1"])
  })
})

describe("todas las palabras cuentan, en cualquier orden", () => {
  it("el orden no importa", () => {
    expect(ids(buscarPacientes(PACIENTES, "garcia manchita"))).toEqual(["1"])
  })

  it("si una palabra no aparece, no hay coincidencia", () => {
    expect(buscarPacientes(PACIENTES, "manchita elefante")).toEqual([])
  })

  it("los espacios de más no cambian nada", () => {
    expect(ids(buscarPacientes(PACIENTES, "  manchita   garcia "))).toEqual(["1"])
  })
})
