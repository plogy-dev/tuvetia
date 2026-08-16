"use client"

// La última red: el boundary que atrapa un fallo del LAYOUT RAÍZ.
//
// Cuando esto se muestra, `app/layout.tsx` no llegó a renderizar, así que **este archivo reemplaza
// el documento entero**. De ahí las tres reglas que lo hacen distinto a los otros dos boundaries
// (doc de Next, `file-conventions/error.md:163-167`):
//
//   1. Tiene que traer sus propios <html> y <body>.
//   2. NO recibe `globals.css` ni las fuentes de `next/font`. Por eso acá no hay una sola clase de
//      Tailwind ni un token `var(--…)`: todo va en línea, con los hex literales de la paleta. Una
//      clase de Tailwind acá no se aplicaría y la pantalla saldría sin estilo.
//   3. No admite `export const metadata`, porque los boundaries son Client Components. El título va
//      con el componente <title> de React.
//
// EL TEMA. Como no llegan los estilos de la app, tampoco llega el `.dark` que pone el ThemeToggle:
// no hay forma de saber acá qué tema eligió el vet. Se resuelve con `prefers-color-scheme`, que es
// lo mejor disponible — si tiene el sistema en oscuro no se come un flashazo blanco.
//
// SIN `unstable_retry` ACÁ. Reintentar re-renderiza el árbol que ya falló, y lo que falló fue el
// layout raíz: si no pudo montar una vez, volver a intentarlo en el mismo documento roto no cambia
// nada. Una recarga completa sí, porque vuelve a pedir el HTML al servidor.

import { useEffect } from "react"

import { reportarError } from "@/lib/errores"

const ESTILOS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: #ffffff;
    color: #0c1613;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    line-height: 1.55;
  }
  .caja { max-width: 26rem; text-align: center; }
  .punto {
    width: 10px; height: 10px; border-radius: 9999px;
    background: #12856a; display: inline-block; margin-bottom: 1.25rem;
  }
  h1 { margin: 0 0 .5rem; font-size: 1.35rem; font-weight: 600; letter-spacing: -.01em; }
  p { margin: 0; font-size: .9rem; color: #5c6d66; }
  button {
    margin-top: 1.25rem; padding: .55rem 1.1rem; border: 0; border-radius: 9px;
    background: #12856a; color: #ffffff; font: inherit; font-size: .875rem;
    font-weight: 500; cursor: pointer;
  }
  button:hover { background: #0f6e58; }
  code {
    display: inline-block; margin-top: 1rem; padding: .15rem .4rem; border-radius: 4px;
    background: #f5f8f7; color: #5c6d66;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .75rem;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0c1613; color: #f5f8f7; }
    p { color: #9dafa7; }
    .punto { background: #7ed0ba; }
    button { background: #7ed0ba; color: #0c1613; }
    button:hover { background: #99dcc9; }
    code { background: #14211c; color: #9dafa7; }
  }
`

export default function ErrorGlobal({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    reportarError(error, "global")
  }, [error])

  return (
    <html lang="es">
      <body>
        <title>Algo se rompió · Tuvetia</title>
        <style dangerouslySetInnerHTML={{ __html: ESTILOS }} />
        <div className="caja">
          <span className="punto" aria-hidden />
          <h1>Tuvetia no pudo cargar</h1>
          <p>
            Es un fallo nuestro, no algo que hayas hecho. Ya quedó registrado. Recargá la página en
            un momento.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Recargar
          </button>
          {error.digest && <code>Código: {error.digest}</code>}
        </div>
      </body>
    </html>
  )
}
