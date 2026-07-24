import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export const metadata = { title: "Términos de servicio · TuvetIA" }

export default function TerminosPage() {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-4 px-6 py-10">
      <Link
        href="/"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Volver
      </Link>
      <h1 className="text-xl font-bold">Términos de servicio</h1>
      <p className="text-sm text-muted-foreground">
        Documento en preparación. La versión definitiva de los Términos de servicio de TuvetIA se
        publicará aquí antes del lanzamiento general. Si necesitás una copia o tenés preguntas,
        contactanos.
      </p>
    </div>
  )
}
