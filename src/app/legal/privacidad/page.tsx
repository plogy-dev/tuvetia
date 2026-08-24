import Link from "next/link"
import { ArrowLeft } from "lucide-react"

// La Política de Tratamiento de la Información (Ley 1581 de 2012).
//
// SE PUBLICA SOLA CUANDO HAYA RESPONSABLE. Mientras `lib/legal/responsable.ts` esté vacío, esta
// página muestra el aviso de "en preparación" que ya tenía; en cuanto se llenen los cinco campos,
// pasa a renderizar la política entera. No hay que tocar este archivo para publicar.
//
// POR QUÉ ASÍ Y NO PUBLICARLA YA. La ley exige nombrar al responsable —persona jurídica con NIT y
// domicilio— y a la fecha es una decisión comercial sin resolver. Publicar el documento con esos
// campos en blanco sería peor que no publicarlo: aparenta cumplimiento sin darlo, y deja a la
// clínica sin dirección donde ejercer derechos. Fallar hacia "en preparación" es lo honesto.
//
// El contenido vive en `lib/legal/politica-de-datos.ts` como dato: así se puede verificar que no le
// falte ninguna sección obligatoria, cosa que un JSX no permite.

import { POLITICA, VERSION_POLITICA, type Bloque } from "@/lib/legal/politica-de-datos"
import { RESPONSABLE, responsableDefinido } from "@/lib/legal/responsable"

export const metadata = { title: "Política de tratamiento de datos · Tuvetia" }

function Contenido({ bloque }: { bloque: Bloque }) {
  switch (bloque.tipo) {
    case "parrafo":
      return <p className="text-sm leading-relaxed text-fg-muted">{bloque.texto}</p>

    case "lista":
      return (
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-fg-muted">
          {bloque.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )

    case "tabla":
      // `overflow-x-auto` y no `hidden`: en un teléfono, dos columnas de texto legal se aprietan
      // hasta ser ilegibles. Mismo criterio que el resto de las tablas del producto.
      return (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs text-fg-faint">
              <tr>
                {bloque.encabezados.map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bloque.filas.map(([izq, der]) => (
                <tr key={izq} className="border-t border-line align-top">
                  <td className="px-3 py-2 font-medium text-fg">{izq}</td>
                  <td className="px-3 py-2 leading-relaxed text-fg-muted">{der}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )

    case "aviso":
      return (
        <p className="rounded-xl border border-line bg-surface-2 p-4 text-sm leading-relaxed text-fg-muted">
          {bloque.texto}
        </p>
      )
  }
}

function Volver() {
  return (
    <Link
      href="/"
      className="inline-flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg"
    >
      <ArrowLeft className="size-4" /> Volver
    </Link>
  )
}

export default function PrivacidadPage() {
  if (!responsableDefinido()) {
    return (
      <div className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-4 px-6 py-10">
        <Volver />
        <h1 className="text-xl font-bold">Política de tratamiento de datos</h1>
        <p className="text-sm leading-relaxed text-fg-muted">
          Documento en preparación. La versión definitiva de la Política de Tratamiento de la
          Información de Tuvetia —conforme a la Ley 1581 de 2012— se publicará aquí antes del
          lanzamiento general. Si tenés preguntas sobre el manejo de tus datos, escribinos.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <Volver />

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">
          Política de Tratamiento de la Información
        </h1>
        <p className="text-sm text-fg-muted">
          Ley 1581 de 2012 · Decreto 1074 de 2015 — última actualización: {VERSION_POLITICA}
        </p>
      </header>

      {/* Los datos del responsable van arriba de todo y fuera de las secciones: es lo primero que
          busca quien quiere ejercer un derecho, y lo que la ley exige que sea identificable. */}
      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-fg-faint">
          Responsable del tratamiento
        </h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          {(
            [
              ["Razón social", RESPONSABLE.razonSocial],
              ["NIT", RESPONSABLE.nit],
              ["Domicilio", RESPONSABLE.domicilio],
              ["Correo", RESPONSABLE.correo],
              ["Teléfono", RESPONSABLE.telefono],
            ] as const
          ).map(([etiqueta, valor]) => (
            <div key={etiqueta} className="contents">
              <dt className="text-fg-muted">{etiqueta}</dt>
              <dd className="font-medium text-fg">{valor}</dd>
            </div>
          ))}
        </dl>
      </section>

      {POLITICA.map((seccion) => (
        <section key={seccion.id} className="flex flex-col gap-3">
          <h2 id={seccion.id} className="scroll-mt-6 text-lg font-semibold text-fg">
            {seccion.titulo}
          </h2>
          {seccion.bloques.map((bloque, i) => (
            <Contenido key={i} bloque={bloque} />
          ))}
        </section>
      ))}
    </div>
  )
}
