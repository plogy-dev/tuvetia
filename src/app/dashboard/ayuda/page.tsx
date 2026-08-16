import Link from "next/link"
import {
  AudioLines,
  Bot,
  CalendarClock,
  Contact,
  MessageCircle,
  MessageSquareHeart,
  PawPrint,
  Plug,
  Receipt,
  Settings2,
} from "lucide-react"

import { RepetirOnboarding } from "@/components/onboarding/repetir-onboarding"
import { Button } from "@/components/ui/button"
import { PageHeader, PageShell } from "@/components/ui/page-shell"
import { buildWaLink } from "@/lib/landing/contact"

// Esta página cubría cuatro secciones de nueve y terminaba con "Escribinos y te damos una mano"
// sin un solo enlace de contacto en todo el dashboard: una invitación a hacer algo imposible.
// Ahora están las nueve, y "escribinos" lleva al WhatsApp que `lib/landing/contact.ts` ya definía
// y que hasta ahora sólo usaba la landing.

const SOPORTE = buildWaLink(
  "Hola, soy usuario de Tuvetia y necesito ayuda con la aplicación.",
)

const SECTIONS = [
  {
    icon: Bot,
    title: "Athos, el copiloto",
    body: "Pregúntale cualquier duda clínica. Responde con literatura citada y verificable, con lenguaje de posibilidad, y se abstiene antes que inventar una fuente. Cuando propone una acción —una cita, un mensaje— la deja para que tú la apruebes.",
    href: "/dashboard/asistente",
  },
  {
    icon: AudioLines,
    title: "Modo Fantasma",
    body: "Grabas la consulta (pidiendo el consentimiento del titular) y Athos la transcribe y redacta la nota clínica SOAP con literatura veterinaria citada. Tú revisas, editas y apruebas: nada entra a la historia sin tu aprobación.",
    href: "/dashboard/consultas",
  },
  {
    icon: PawPrint,
    title: "Pacientes",
    body: "Las fichas de tus pacientes: datos, alergias, vacunas, medicación, y la historia de consultas con su transcripción y audio. Se crean con el botón “Nuevo paciente”.",
    href: "/dashboard/patients",
  },
  {
    icon: Contact,
    title: "Titulares",
    body: "Los dueños de tus pacientes, con su teléfono y correo. Es de donde salen los contactos que usan WhatsApp y la facturación.",
    href: "/dashboard/owners",
  },
  {
    icon: CalendarClock,
    title: "Agenda",
    body: "Tu agenda de citas: crear, mover y editar. Puedes sincronizarla con Google Calendar (opcional) o compartirla con un enlace de sólo lectura.",
    href: "/dashboard/calendario",
  },
  {
    icon: Receipt,
    title: "Ventas",
    body: "Factura electrónica DIAN, catálogo de servicios y productos, inventario por movimientos, compras y cartera. Se activa cuando quieras desde su propia configuración.",
    href: "/dashboard/facturacion",
  },
  {
    icon: MessageCircle,
    title: "Comunicaciones",
    body: "Las conversaciones de WhatsApp de la clínica y las propuestas de respuesta que Athos deja esperando tu aprobación.",
    href: "/dashboard/comunicaciones",
  },
  {
    icon: Plug,
    title: "Integraciones",
    body: "Donde conectas el WhatsApp de la clínica y el correo desde el que salen las facturas.",
    href: "/dashboard/conexiones",
  },
  {
    icon: Settings2,
    title: "Configuración",
    body: "Los datos de la clínica, tu equipo, los horarios de atención que Athos usa para proponer citas, y la descarga de todos tus datos en formato abierto.",
    href: "/dashboard/settings",
  },
]

export default function AyudaPage() {
  return (
    <PageShell width="narrow">
      <PageHeader
        title="Ayuda"
        description="Una guía rápida de cada sección. Dentro de la app, el “?” de cada pantalla explica lo suyo en corto."
      />

      <div className="flex flex-col gap-3">
        {SECTIONS.map((s) => (
          <Link
            key={s.title}
            href={s.href}
            className="flex gap-3 rounded-lg border border-line-soft bg-card p-4 transition-colors hover:bg-surface-2"
          >
            <s.icon className="mt-0.5 size-5 shrink-0 text-fg-faint" aria-hidden />
            <div>
              <div className="text-sm font-semibold text-fg">{s.title}</div>
              <p className="text-sm text-fg-muted">{s.body}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-4">
        <RepetirOnboarding />
      </div>

      <div className="mt-4 rounded-lg border border-line-soft bg-card p-4">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-fg">
          <MessageSquareHeart className="size-4 text-fg-faint" aria-hidden /> ¿Necesitas más ayuda?
        </div>
        <p className="mb-3 text-sm text-fg-muted">
          Escríbenos por WhatsApp y te damos una mano.
        </p>
        <Button
          variant="outline"
          render={<a href={SOPORTE} target="_blank" rel="noopener noreferrer" />}
        >
          <MessageCircle className="size-4" aria-hidden /> Escribirnos por WhatsApp
        </Button>
      </div>
    </PageShell>
  )
}
