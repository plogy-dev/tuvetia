import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export const metadata = { title: "Política de privacidad · TuvetIA" }

export default function PrivacidadPage() {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-4 px-6 py-10">
      <Link
        href="/"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Volver
      </Link>
      <h1 className="text-xl font-bold">Política de privacidad</h1>
      <p className="text-sm text-muted-foreground">
        Documento en preparación. La versión definitiva de la Política de privacidad de TuvetIA —
        incluyendo el tratamiento de datos conforme a la Ley 1581 de 2012— se publicará aquí antes del
        lanzamiento general. Si tenés preguntas sobre el manejo de tus datos, contactanos.
      </p>
    </div>
  )
}
