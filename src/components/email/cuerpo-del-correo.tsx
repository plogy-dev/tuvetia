"use client"

// El cuerpo de un correo, como correo: con sus imágenes, negritas y tablas.
//
// ── POR QUÉ UN IFRAME Y NO `dangerouslySetInnerHTML` ──────────────────────────────────────────
//
// Lo que hay dentro de un correo lo escribió CUALQUIERA que sepa la dirección de la clínica. Es el
// contenido menos confiable que toca esta aplicación, y hay dos formas de que arruine el día:
//
//   1. EJECUTANDO CÓDIGO. Un `<script>`, un `onerror=` en una imagen rota, un `href="javascript:"`.
//      Inyectado con `dangerouslySetInnerHTML` eso corre CON LA SESIÓN DEL VETERINARIO, en el mismo
//      origen que la app: puede leer sus cookies, llamar a nuestras rutas y hablar con Supabase como
//      él. Un `<iframe sandbox>` sin `allow-scripts` simplemente no ejecuta nada.
//
//   2. ROMPIENDO LA PANTALLA. Un correo de campaña trae su propio `<style>` con reglas globales
//      —`body { background: black }`, `* { font-size: 30px }`, `table { width: 3000px }`— y esas
//      reglas no distinguen entre el correo y la aplicación que lo muestra. Dentro del iframe el
//      CSS del correo sólo alcanza al correo.
//
// Es lo mismo que hacen Gmail y Outlook, y por los mismos dos motivos.
//
// ── LO QUE SE PIERDE, DICHO ───────────────────────────────────────────────────────────────────
//
// Las imágenes REMOTAS se cargan, que es lo que se pidió: un correo sin ellas no se ve como correo.
// El costo es conocido y vale decirlo — al abrirlo, quien lo envió puede saber que la dirección
// está viva y a qué hora se leyó, porque cada imagen es una petición a su servidor. Los clientes
// grandes las bloquean por defecto y ofrecen «mostrar imágenes»; acá se cargan. Si algún día pesa
// más la privacidad que el aspecto, el cambio es un `csp` más estricto en el `sandbox` y un botón.
//
// ── LA LIMPIEZA PREVIA NO ES LA DEFENSA ───────────────────────────────────────────────────────
//
// Se barren `<script>` y los atributos `on*` antes de pintar. Eso NO es lo que nos protege —el
// sandbox ya impide ejecutarlos— y no hay que confiarle nada: es una segunda pared, barata, para el
// día que alguien cambie el `sandbox` sin entender qué sostenía.

import { useMemo } from "react"

/** Barrido conservador. Segunda pared, no la primera: la primera es el `sandbox`. */
export function sinLoEjecutable(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "")
}

export function CuerpoDelCorreo({
  html,
  texto,
  advertencia,
}: {
  /** El HTML del proveedor, o `null` si el correo era texto plano. */
  html: string | null
  /** El texto, que se usa cuando no hay HTML. */
  texto: string
  /** Si el proveedor entregó sólo el comienzo, el aviso que corresponde. */
  advertencia?: React.ReactNode
}) {
  const documento = useMemo(() => {
    if (!html) return null
    // El correo llega sin `<html>` ni charset la mayoría de las veces. Sin declarar UTF-8, las
    // tildes y las eñes salen como rombos — y un correo en español lleno de rombos se lee como si
    // la aplicación estuviera rota, no el correo.
    return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { margin:0; padding:12px; font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; word-break:break-word; }
  img, table { max-width:100% !important; height:auto; }
  table { border-collapse:collapse; }
  a { color:#2563eb; }
</style></head><body>${sinLoEjecutable(html)}</body></html>`
  }, [html])

  if (!documento) {
    return (
      <>
        <p className="text-sm whitespace-pre-wrap">{texto}</p>
        {advertencia}
      </>
    )
  }

  return (
    <>
      {/* `sandbox` VACÍO a propósito: sin `allow-scripts`, sin `allow-same-origin`, sin
          `allow-forms`. El correo se ve y nada más. Agregarle cualquiera de esos tres le devuelve
          justo la capacidad que este componente existe para quitarle. */}
      <iframe
        title="Contenido del correo"
        sandbox=""
        srcDoc={documento}
        referrerPolicy="no-referrer"
        className="h-full min-h-[320px] w-full border-0 bg-white"
      />
      {advertencia}
    </>
  )
}
