import Link from "next/link"
import { AudioLines, Bot, CalendarClock, CircleHelp, PawPrint } from "lucide-react"

const SECTIONS = [
  {
    icon: PawPrint,
    title: "Pacientes",
    body: "Las fichas de tus pacientes: datos, alergias, vacunas, medicación, y la historia de consultas con su transcripción y audio. Se crean con el botón “Crear paciente”.",
    href: "/dashboard/patients",
  },
  {
    icon: AudioLines,
    title: "Modo Fantasma",
    body: "Grabás la consulta (pidiendo el consentimiento del titular) y Athos la transcribe y redacta la nota clínica SOAP con literatura veterinaria citada. Vos revisás, editás y aprobás: nada entra a la historia sin tu aprobación.",
    href: "/dashboard/consultas",
  },
  {
    icon: Bot,
    title: "Copiloto",
    body: "Preguntale a Athos cualquier duda clínica. Responde con literatura citada y verificable, con lenguaje de posibilidad, y se abstiene antes que inventar una fuente.",
    href: "/dashboard/asistente",
  },
  {
    icon: CalendarClock,
    title: "Calendario",
    body: "Tu agenda de citas: crear, mover y editar. Podés sincronizarla con Google Calendar (opcional) o compartirla con un enlace de solo lectura.",
    href: "/dashboard/calendario",
  },
]

export default function AyudaPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4 md:py-6 lg:px-6">
      <div className="flex items-center gap-2">
        <CircleHelp className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Ayuda</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Una guía rápida de lo principal. En cada sección vas a encontrar un{" "}
        <span className="font-medium text-foreground">“?”</span> con una explicación corta.
      </p>

      <div className="flex flex-col gap-3">
        {SECTIONS.map((s) => (
          <Link
            key={s.title}
            href={s.href}
            className="flex gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40"
          >
            <s.icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-sm font-semibold">{s.title}</div>
              <p className="text-sm text-muted-foreground">{s.body}</p>
            </div>
          </Link>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        ¿Necesitás más ayuda? Escribinos y te damos una mano.
      </p>
    </div>
  )
}
