// Genera los PNG de la app instalable desde el monograma de marca.
//
// ── POR QUÉ PNG SI YA HAY SVG ───────────────────────────────────────────────────────────────────
//
// iOS no usa el SVG del manifiesto para la pantalla de inicio: sin un PNG (y el apple-icon de 180)
// el icono instalado sale genérico — una captura de la página dentro de un marco. Android acepta
// SVG pero el maskable con zona segura también conviene precalcularlo.
//
// ── CUÁNDO CORRERLO ─────────────────────────────────────────────────────────────────────────────
//
// Sólo cuando cambia `public/marca/monogram.svg`. Los PNG generados SE COMMITEAN: no es un paso de
// build (Vercel no corre esto), es una herramienta de mano. `node scripts/generar-iconos.mjs`.
//
// El maskable lleva al monograma al 80% centrado: Android recorta hasta un 10% por lado según la
// forma de la máscara del launcher, y sin ese margen la chispa de la esquina se pierde.

import { readFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const fuente = readFileSync(join(raiz, "public", "marca", "monogram.svg"))
const destino = join(raiz, "public", "icons")
mkdirSync(destino, { recursive: true })

/** El fondo del tile, para el lienzo del maskable. Tiene que coincidir con el rect del SVG. */
const GRAFITO = "#0c1613"

async function normal(lado, nombre) {
  await sharp(fuente, { density: (72 * lado) / 64 })
    .resize(lado, lado)
    .png()
    .toFile(join(destino, nombre))
  console.log(`  ${nombre} (${lado}×${lado})`)
}

async function maskable(lado, nombre) {
  const interior = Math.round(lado * 0.8)
  const margen = Math.round((lado - interior) / 2)
  const mono = await sharp(fuente, { density: (72 * interior) / 64 })
    .resize(interior, interior)
    .png()
    .toBuffer()
  await sharp({
    create: { width: lado, height: lado, channels: 4, background: GRAFITO },
  })
    .composite([{ input: mono, top: margen, left: margen }])
    .png()
    .toFile(join(destino, nombre))
  console.log(`  ${nombre} (${lado}×${lado}, maskable)`)
}

console.log("Generando iconos desde public/marca/monogram.svg:")
await normal(192, "icon-192.png")
await normal(512, "icon-512.png")
await maskable(512, "icon-maskable-512.png")
await normal(180, "apple-icon-180.png")
console.log("Listo. Commitear public/icons/.")
