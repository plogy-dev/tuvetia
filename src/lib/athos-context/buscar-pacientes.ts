// Buscar un paciente entre los de la clínica, del lado del cliente.
//
// POR QUÉ. La pantalla de Athos ya carga hasta 500 pacientes para el selector, y los pintaba todos
// en un `<Select>`. Es exactamente lo que el cliente puso sobre la mesa el 17-ago:
//
//     Luciano: "en el momento en que yo tenga 200 pacientes, ¿cómo carajo le voy a decir al man qué
//               contexto tiene? Imposible"
//
// Con la lista ya en memoria, buscar no cuesta una query: cuesta esta función.
//
// SE BUSCA TAMBIÉN POR TITULAR, y no es un extra. Es la respuesta a la objeción de Jesús en esa
// misma reunión —"si tú tienes 7 perros que tienen leucemia… la característica específica se te
// llega a escapar"—: cuando hay tres "Manchita", lo que las distingue es de quién son.
//
// LAS TILDES NO PUEDEN ESTORBAR. Nadie escribe "Muñéca" con tilde cuando busca rápido, y el vet
// está con un animal delante.

export type PacienteBuscable = {
  id: string
  name: string
  species: string
  /** Titular. Es lo que desambigua dos mascotas con el mismo nombre. */
  owner?: string | null
}

/**
 * Minúsculas y sin diacríticos, para comparar como escribe la gente.
 *
 * `NFD` descompone "á" en "a" + un acento combinante suelto, y `\p{Diacritic}` barre esos acentos.
 * Se usa la propiedad Unicode y no un rango de caracteres a mano: un rango de combinantes escrito
 * literal en el fuente es invisible en cualquier editor y no sobrevive a un copiar y pegar.
 *
 * Efecto secundario BUSCADO: la ñ también se descompone (n + tilde), así que "muneca" encuentra
 * "Muñeca". En un teclado apurado es el error más común y no tiene sentido castigarlo.
 */
export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
}

/**
 * Los pacientes que coinciden con lo escrito.
 *
 * TODAS LAS PALABRAS TIENEN QUE APARECER, en cualquier campo y en cualquier orden: "manchita garcia"
 * encuentra a la Manchita de García sin obligar a acertar el orden ni a saber si el apellido va
 * antes. Con la consulta vacía devuelve la lista entera — el diálogo abre mostrando todo.
 *
 * `limite` acota lo que se PINTA, no lo que se busca: con 500 pacientes y el campo vacío, montar
 * 500 filas para que el vet vea seis es trabajo tirado.
 */
export function buscarPacientes<T extends PacienteBuscable>(
  pacientes: readonly T[],
  consulta: string,
  limite = 50,
): T[] {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean)
  if (!palabras.length) return pacientes.slice(0, limite)

  const encontrados: T[] = []
  for (const p of pacientes) {
    const heno = normalizar(`${p.name} ${p.species} ${p.owner ?? ""}`)
    if (palabras.every((w) => heno.includes(w))) {
      encontrados.push(p)
      if (encontrados.length >= limite) break
    }
  }
  return encontrados
}
