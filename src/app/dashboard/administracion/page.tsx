import Link from "next/link"
import {
  Building2,
  CreditCard,
  HeartPulse,
  Receipt,
  Sliders,
  UsersRound,
  Wallet,
} from "lucide-react"

import { PageHeader, PageShell } from "@/components/ui/page-shell"

export const metadata = { title: "Administración · Tuvetia" }

// El panel de administración.
//
// ── POR QUÉ ESTA PANTALLA ES CASI TODA ENLACES ────────────────────────────────────────────────
//
// David, 25-ago: «sabés qué falta, un admin panel […] Mk sin este módulo no hay nada». Al medir
// OkVet contra lo que ya teníamos, cuatro de las seis entradas YA EXISTÍAN — repartidas en tres
// sitios distintos: la configuración en `/settings`, lo fiscal en `/facturacion/configuracion`, los
// titulares en `/owners`, la suscripción en `/plan`.
//
// O sea que lo que faltaba no era la función: era LA PUERTA. Un producto donde cada ajuste vive en
// su rincón se siente sin administración aunque la tenga toda. Por eso esto es un índice y no una
// reescritura: mover las funciones a un lugar nuevo habría roto enlaces compartidos y el riel de
// onboarding a cambio de nada.
//
// ── EL CERROJO ────────────────────────────────────────────────────────────────────────────────
//
// Toda entrada de acá lleva a una pantalla que EXISTE. Es la lección del 24-ago, cuando aparecieron
// Compras y Proveedores construidos y sin puerta: un menú que promete lo que no hay es peor que no
// tener menú. `administracion-sin-puertas-muertas.test.ts` lo comprueba contra el árbol de rutas.

const ENTRADAS = [
  {
    href: "/dashboard/administracion/clinica",
    icon: Building2,
    titulo: "Configuración de la veterinaria",
    detalle: "Datos, dirección, horarios de atención y recordatorios de cita.",
  },
  {
    href: "/dashboard/administracion/clinica?tab=equipo",
    icon: UsersRound,
    titulo: "Usuarios y empleados",
    detalle: "Quién entra a la clínica y con qué rol. Invitaciones pendientes.",
  },
  {
    href: "/dashboard/owners",
    icon: Wallet,
    titulo: "Propietarios",
    detalle: "Los titulares de los pacientes y sus datos de contacto.",
  },
  {
    href: "/dashboard/administracion/planes-salud",
    icon: HeartPulse,
    titulo: "Planes de salud",
    detalle: "Paquetes de servicios que la clínica le vende a un paciente.",
  },
  {
    href: "/dashboard/facturacion/configuracion",
    icon: Receipt,
    titulo: "Perfil fiscal",
    detalle: "NIT, resolución DIAN, consecutivos y datos de facturación.",
  },
  {
    href: "/dashboard/plan",
    icon: CreditCard,
    titulo: "Plan y suscripción",
    detalle: "El plan de Tuvetia que tiene tu clínica y su estado.",
  },
] as const

export default function AdministracionPage() {
  return (
    <PageShell className="flex flex-col gap-4">
      <PageHeader
        title="Administración"
        description="Todo lo que se configura una vez y manda para toda la clínica."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {ENTRADAS.map((e) => (
          <Link
            key={e.href}
            href={e.href}
            className="group flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-brand/40 hover:bg-accent/40"
          >
            <e.icon className="mt-0.5 size-5 shrink-0 text-muted-foreground transition-colors group-hover:text-fg" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">{e.titulo}</div>
              <p className="mt-0.5 text-sm text-muted-foreground">{e.detalle}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Variables: el primero de los 8 catálogos de OkVet ya existe (vacunas, 26-ago). Los otros
          siete siguen SIN prometerse — de cinco no existe ni la tabla, y un menú que promete lo
          que no hay es peor que no tener menú. Cada uno entra cuando alguien lo necesite. */}
      <Link
        href="/dashboard/administracion/variables/vacunas"
        className="group flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-brand/40 hover:bg-accent/40"
      >
        <Sliders className="mt-0.5 size-5 shrink-0 text-muted-foreground transition-colors group-hover:text-fg" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">Variables · Catálogo de vacunas</div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Las vacunas que aplica la clínica, para elegir en vez de teclear. Los demás catálogos
            (consultas, cirugías, laboratorio) llegan por fases.
          </p>
        </div>
      </Link>
    </PageShell>
  )
}
