#!/usr/bin/env node
// Audita que TODO objeto de base que el código invoca exista de verdad.
//
// ── POR QUÉ EXISTE ────────────────────────────────────────────────────────────────────────────
//
// El 26-ago aparecieron CINCO fallos del mismo molde en un solo día: `invoices.issued_on`,
// `clinics.confirmacion_citas_*`, `tablero_preferencias.metricas`, `clinics.meta_ventas_*` y
// `vaccines.name`. Todos son código que le pide a PostgREST una columna que no existe.
//
// Lo que los hace peligrosos es que NO SE VEN. PostgREST responde 42703 con un 400, el cliente de
// Supabase deja `data` en `null`, y el `?? []` o el `?? "—"` de turno pinta una pantalla vacía que
// se lee como «no hay datos». No hay excepción, no llega a Sentry, y ningún test lo atrapa: los
// tests corren sin red y el tipado de PostgREST es texto dentro de un string.
//
// Esto lo atrapa comparando lo que el código PIDE contra lo que la base TIENE.
//
// ── CÓMO SE USA ───────────────────────────────────────────────────────────────────────────────
//
//   SUPABASE_DB_URL='postgresql://...' node scripts/auditar-esquema-usado.mjs
//
// Sin `SUPABASE_DB_URL` no consulta nada: imprime el SQL para pegar en el SQL Editor, que es como
// se corrió la primera vez. Sale con código 1 si encuentra algo que falta, para poder colgarlo de
// CI el día que haya una base de pruebas.
//
// ── LO QUE NO CUBRE, Y NO ES DESCUIDO ─────────────────────────────────────────────────────────
//
// Sólo mira los `select` con nombres PLANOS. Las columnas dentro de un embed —`patient:patients
// (name)`— se descartan porque pertenecen a otra tabla y compararlas contra la de afuera daría
// falsos positivos; medido, ésa era la mitad del ruido. Tampoco mira `.eq()`/`.order()`, que
// también pueden nombrar una columna inexistente: es el siguiente paso natural si esto rinde.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const RAIZ = "src"

/** Todos los .ts/.tsx de producción. Los tests quedan fuera: sus tablas son de mentira. */
function fuentes(dir, acc = []) {
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada)
    if (statSync(p).isDirectory()) fuentes(p, acc)
    else if (/\.tsx?$/.test(p) && !/__tests__|\.test\./.test(p)) acc.push(p)
  }
  return acc
}

/** Quita lo que va dentro de paréntesis, que en un `select` de PostgREST es siempre un embed. */
function sinEmbeds(texto) {
  let antes
  let salida = texto
  do {
    antes = salida
    salida = salida.replace(/\([^()]*\)/g, "")
  } while (salida !== antes)
  return salida
}

// `.from("tabla")` … `.select("columnas")`. El hueco tiene tope porque entre los dos van los
// filtros encadenados; sin tope, emparejaría el `from` de una consulta con el `select` de la
// siguiente y reportaría columnas que nadie pidió.
const CONSULTA = /\.from\(\s*['"`](\w+)['"`]\s*\)([\s\S]{0,400}?)\.select\(\s*(['"`])([\s\S]*?)\3/g
const RPC = /\.rpc\(\s*['"`](\w+)['"`]/g

const columnas = new Set()
const tablas = new Set()
const rpcs = new Set()

for (const archivo of fuentes(RAIZ)) {
  const src = readFileSync(archivo, "utf8")
  for (const m of src.matchAll(RPC)) rpcs.add(m[1])
  for (const m of src.matchAll(CONSULTA)) {
    const tabla = m[1]
    tablas.add(tabla)
    for (let col of sinEmbeds(m[4]).split(",")) {
      col = col.trim()
      if (!col || col === "*") continue
      if (col.includes(":") || col.includes("!")) continue // resto de un embed
      if (!/^[a-z][a-z0-9_]*$/.test(col)) continue // alias, plantillas, agregados
      columnas.add(`${tabla}|${col}`)
    }
  }
}

const valores = (pares) =>
  pares.map((p) => { const [t, c] = p.split("|"); return `('${t}','${c}')` }).join(", ")

const sql = `
-- Columnas que el código pide y la base no tiene:
with usado(tabla, columna) as (values ${valores([...columnas].sort())})
select u.tabla || '.' || u.columna as falta
from usado u
left join information_schema.columns c
  on c.table_schema = 'public' and c.table_name = u.tabla and c.column_name = u.columna
where c.column_name is null

union all

-- Tablas que el código usa y la base no tiene:
select t.n
from (values ${[...tablas].sort().map((t) => `('${t}')`).join(", ")}) as t(n)
where not exists (
  select 1 from information_schema.tables i
  where i.table_schema = 'public' and i.table_name = t.n
)

union all

-- Funciones que el código llama y la base no tiene:
select r.n
from (values ${[...rpcs].sort().map((r) => `('${r}')`).join(", ")}) as r(n)
where not exists (
  select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = r.n
)
order by 1;
`.trim()

const dsn = process.env.SUPABASE_DB_URL
if (!dsn) {
  console.log(`-- ${columnas.size} columnas, ${tablas.size} tablas y ${rpcs.size} funciones en uso.`)
  console.log("-- Sin SUPABASE_DB_URL: pegá esto en el SQL Editor. Cero filas = todo bien.\n")
  console.log(sql)
  process.exit(0)
}

// `pg` no es dependencia del proyecto: si no está, se degrada a imprimir el SQL en vez de fallar.
let Client
try {
  ({ Client } = await import("pg"))
} catch {
  console.error("No está instalado `pg`. Corré sin SUPABASE_DB_URL y pegá el SQL a mano.\n")
  console.log(sql)
  process.exit(0)
}

const cliente = new Client({ connectionString: dsn })
await cliente.connect()
const { rows } = await cliente.query(sql)
await cliente.end()

if (rows.length === 0) {
  console.log(`✓ ${columnas.size} columnas, ${tablas.size} tablas y ${rpcs.size} funciones: todo existe.`)
  process.exit(0)
}
console.error("✗ El código usa objetos que la base no tiene:\n")
for (const r of rows) console.error("  · " + r.falta)
console.error("\nCasi siempre significa que falta aplicar una migración. Ver ESTADO.md.")
process.exit(1)
