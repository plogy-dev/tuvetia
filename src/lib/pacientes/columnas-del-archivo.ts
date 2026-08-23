// Qué columna del archivo va a qué campo, al importar pacientes.
//
// EL DEFECTO QUE ARREGLA, reportado por David el 19-ago: al importar, las columnas salen
// intercambiadas — y con otro archivo salen intercambiadas de otra forma.
//
// LA CAUSA. El mapeo anterior recorría los campos en orden y se quedaba con el PRIMER encabezado
// que contuviera alguno de sus sinónimos:
//
//     const hit = headers.find((h) => f.synonyms.some((s) => norm(h) === s || norm(h).includes(s)))
//
// Tres cosas mal, y las tres producen exactamente lo que él vio:
//
//  1. **`includes` sin preferir lo exacto.** El campo `name` (sinónimo "nombre") se quedaba con
//     "Nombre del titular", porque contiene "nombre". El paciente terminaba llamándose como su
//     dueño, y el dueño se perdía — ya no quedaba encabezado libre para `owner_name`.
//
//  2. **Gana el primero del archivo, no el que mejor encaja.** Con dos encabezados candidatos, cuál
//     se llevaba el campo dependía del ORDEN DE LAS COLUMNAS. Por eso "con otro formato sale
//     distinto": el mismo defecto se manifiesta diferente según cómo esté armada la planilla.
//
//  3. **Los campos se servían por turno.** `name` elegía antes que `owner_name` por estar antes en
//     la lista, aunque para `owner_name` ese encabezado fuera un calce perfecto.
//
// CÓMO SE RESUELVE. Se puntúa cada par (campo, columna) y se asigna por PUNTAJE GLOBAL, no por
// orden: primero los calces exactos, después los de palabra completa. Y si lo mejor que hay es una
// coincidencia por pedazo de palabra, NO SE ADIVINA — se deja sin mapear para que lo elija el vet.
//
// Que un campo quede vacío se ve y se corrige en dos segundos. Un campo mal mapeado se ve cuando
// ya hay 300 pacientes con el nombre de su dueño.
//
// PURO Y SIN RED, como el resto de lo testeable: `vitest.config.mts` corre en `environment: "node"`
// sobre `src/**/*.test.ts`.

export const SIN_MAPEAR = "__none__"

export type CampoDestino = {
  key: string
  label: string
  required?: boolean
  synonyms: string[]
  /** Si el campo describe al TITULAR y no a la mascota. Ver `esDelTitular`. */
  delTitular?: boolean
  /**
   * Entre columnas del titular, este campo es el ÚLTIMO en elegir.
   *
   * HACE FALTA POR UNA COLISIÓN REAL: "Teléfono del dueño" calza con `owner_name` (por "dueño") y
   * con `owner_phone` (por "teléfono") con el mismo puntaje. Pero es obvio cuál de los dos es: la
   * palabra que dice QUÉ dato trae es "teléfono"; "dueño" sólo dice DE QUIÉN es.
   *
   * O sea que el nombre del titular es lo que queda cuando la columna no dice nada más específico.
   */
  ultimoRecurso?: boolean
}

/** Una columna del archivo. El `id` es posicional a propósito — ver `columnasDe`. */
export type Columna = { id: string; etiqueta: string }

export const CAMPOS: CampoDestino[] = [
  { key: "name", label: "Nombre de la mascota", required: true, synonyms: ["mascota", "nombre", "paciente", "pet", "name"] },
  { key: "species", label: "Especie", synonyms: ["especie", "species", "animal", "tipo"] },
  { key: "breed", label: "Raza", synonyms: ["raza", "breed"] },
  { key: "sex", label: "Sexo", synonyms: ["sexo", "genero", "sex", "gender"] },
  { key: "birth_date", label: "Fecha de nacimiento", synonyms: ["fecha de nacimiento", "fecha nacimiento", "nacimiento", "fecha nac", "birth", "birthdate", "birth date", "nac"] },
  { key: "age", label: "Edad (si no hay fecha)", synonyms: ["edad", "age"] },
  { key: "weight_kg", label: "Peso (kg)", synonyms: ["peso", "weight", "kg"] },
  { key: "owner_name", label: "Titular (nombre)", delTitular: true, ultimoRecurso: true, synonyms: ["titular", "dueno", "propietario", "cliente", "owner", "responsable"] },
  { key: "owner_phone", label: "Teléfono del titular", delTitular: true, synonyms: ["telefono", "celular", "tel", "phone", "movil", "contacto", "whatsapp"] },
  { key: "owner_email", label: "Email del titular", delTitular: true, synonyms: ["email", "correo", "mail", "e-mail"] },
  { key: "owner_document", label: "Documento del titular", delTitular: true, synonyms: ["documento", "cedula", "dni", "cc", "identificacion", "nit"] },
]

/**
 * Las palabras que delatan que una columna habla del TITULAR y no de la mascota.
 *
 * ES LA REGLA QUE DESARMA EL CHOQUE PRINCIPAL. "Nombre del propietario" y "Nombre" compiten por el
 * mismo sinónimo; la diferencia entre las dos no está en la palabra que comparten sino en la que
 * NO: una nombra a una persona.
 */
const MARCAS_DE_TITULAR = ["titular", "dueno", "propietario", "cliente", "owner", "responsable", "acudiente"]

/**
 * Normaliza para comparar: sin tildes, minúsculas, y **separando lo que venía pegado**.
 *
 * El paso de separar no es cosmético: las planillas exportadas traen `FechaNac`, `owner_name`,
 * `Peso-Kg`. Sin partirlas, "fecha nac" no calza con "FechaNac" ni por palabra ni por pedazo, y una
 * columna perfectamente reconocible se quedaría sin mapear.
 */
export function normalizar(s: string): string {
  return (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // camelCase / PascalCase → dos palabras. `FechaNac` → `Fecha Nac`.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    // Todo lo que no sea letra o número separa palabras: guiones, puntos, paréntesis, barras.
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** ¿La columna habla del titular? */
export function esDelTitular(etiqueta: string): boolean {
  const n = normalizar(etiqueta)
  return MARCAS_DE_TITULAR.some((m) => palabraCompleta(n, m))
}

function palabraCompleta(texto: string, palabra: string): boolean {
  return ` ${texto} `.includes(` ${palabra} `)
}

/** 3 = calce exacto · 2 = palabra completa adentro · 1 = pedazo · 0 = nada. */
export function puntaje(campo: CampoDestino, etiqueta: string): number {
  const n = normalizar(etiqueta)
  if (!n) return 0

  // UNA COLUMNA DEL TITULAR NO PUEDE LLENAR UN CAMPO DE LA MASCOTA. Es la regla que impide que el
  // paciente se llame como su dueño, que era el sintoma más visible del defecto.
  if (esDelTitular(etiqueta) && !campo.delTitular) return 0

  let mejor = 0
  for (const s of campo.synonyms) {
    const sn = normalizar(s)
    if (!sn) continue
    if (n === sn) return 3
    if (palabraCompleta(n, sn)) mejor = Math.max(mejor, 2)
    else if (n.includes(sn)) mejor = Math.max(mejor, 1)
  }
  return mejor
}

/**
 * Las columnas del archivo, con un id POSICIONAL.
 *
 * POR QUÉ EL ID NO ES EL TEXTO DEL ENCABEZADO. Una planilla exportada trae encabezados repetidos
 * ("Teléfono" dos veces) y encabezados vacíos, y con el texto como clave la segunda columna pisaba
 * a la primera: los datos de la columna 7 aparecían bajo el nombre de la 3. Es la otra mitad de
 * "mezcla las columnas", y no se arregla puntuando mejor — se arregla no usando el texto como
 * identidad.
 *
 * La etiqueta que se muestra sí lleva el texto, y numera los repetidos para que se distingan.
 */
export function columnasDe(encabezados: string[]): Columna[] {
  const vistos = new Map<string, number>()
  return encabezados.map((h, i) => {
    const texto = String(h ?? "").trim()
    const base = texto || `Columna ${i + 1}`
    const veces = (vistos.get(base) ?? 0) + 1
    vistos.set(base, veces)
    return { id: `c${i}`, etiqueta: veces > 1 ? `${base} (${veces})` : base }
  })
}

/**
 * Campo → id de columna, o `SIN_MAPEAR`.
 *
 * ASIGNACIÓN POR PUNTAJE GLOBAL. Se arman todos los pares posibles, se ordenan por qué tan bien
 * calzan, y se van tomando los mejores mientras el campo y la columna sigan libres. Así el orden de
 * las columnas del archivo deja de decidir nada — que era la razón de que el mismo defecto se viera
 * distinto con cada planilla.
 */
export function mapearColumnas(columnas: Columna[]): Record<string, string> {
  type Par = { campo: number; columna: number; puntos: number }
  const pares: Par[] = []

  CAMPOS.forEach((campo, ci) => {
    columnas.forEach((col, coli) => {
      const puntos = puntaje(campo, col.etiqueta)
      // MENOS DE 2 NO SE ADIVINA. Un calce por pedazo de palabra ("nac" dentro de "vacunacion") es
      // más probable que sea casualidad que acierto, y una columna vacía se corrige en dos
      // segundos — una mal mapeada se descubre con 300 pacientes ya cargados.
      if (puntos >= 2) pares.push({ campo: ci, columna: coli, puntos })
    })
  })

  // Desempate ESTABLE y explícito: primero lo que mejor calza, después los campos obligatorios,
  // después el orden de los campos, y al final el de las columnas. Sin esto, dos pares con el mismo
  // puntaje se resolverían según cómo ordene `sort`, que es justo la clase de detalle que hace que
  // el resultado cambie entre archivos.
  pares.sort(
    (a, b) =>
      b.puntos - a.puntos ||
      // El último recurso elige después de todos: "Teléfono del dueño" es un teléfono.
      Number(Boolean(CAMPOS[a.campo].ultimoRecurso)) - Number(Boolean(CAMPOS[b.campo].ultimoRecurso)) ||
      Number(Boolean(CAMPOS[b.campo].required)) - Number(Boolean(CAMPOS[a.campo].required)) ||
      a.campo - b.campo ||
      a.columna - b.columna,
  )

  const mapa: Record<string, string> = {}
  for (const c of CAMPOS) mapa[c.key] = SIN_MAPEAR
  const columnaUsada = new Set<number>()

  for (const p of pares) {
    if (mapa[CAMPOS[p.campo].key] !== SIN_MAPEAR) continue
    if (columnaUsada.has(p.columna)) continue
    mapa[CAMPOS[p.campo].key] = columnas[p.columna].id
    columnaUsada.add(p.columna)
  }
  return mapa
}
