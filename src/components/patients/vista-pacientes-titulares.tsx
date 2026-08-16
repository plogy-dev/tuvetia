import Link from "next/link"

// El conmutador entre las dos vistas de lo mismo.
//
// POR QUÉ EXISTE. El cliente pidió unir Titulares y Pacientes. La fusión NO puede ser borrar la
// sección de titulares, porque hay tres cosas que sólo viven ahí:
//
//   · El **consentimiento de grabación** (Ley 1581), que es del TITULAR y cubre a todas sus
//     mascotas. Repetirlo por paciente haría que revocarlo desde una apagara la grabación de las
//     otras sin decirlo.
//   · El **documento** y el **correo**, que la lista de pacientes no muestra.
//   · Los titulares **sin mascota** — recién creados, o cuya mascota falleció. Con Pacientes como
//     única lista, desaparecerían de la app.
//
// Así que se une la NAVEGACIÓN y no el modelo: una sola entrada en la barra («Pacientes»), y
// adentro dos vistas de la misma realidad. La relación sigue siendo 1 titular → N mascotas, que es
// lo correcto y lo que el negocio necesita.
//
// Las URLs no cambian: `/dashboard/patients` y `/dashboard/owners` siguen existiendo, así que
// ningún enlace viejo se rompe.

const VISTAS = [
  { href: "/dashboard/patients", etiqueta: "Pacientes" },
  { href: "/dashboard/owners", etiqueta: "Titulares" },
] as const

export function VistaPacientesTitulares({ activa }: { activa: "/dashboard/patients" | "/dashboard/owners" }) {
  return (
    <div
      role="navigation"
      aria-label="Vista de pacientes o titulares"
      className="mb-4 inline-flex rounded-lg border border-line p-0.5"
    >
      {VISTAS.map((v) => {
        const esActiva = v.href === activa
        return (
          <Link
            key={v.href}
            href={v.href}
            aria-current={esActiva ? "page" : undefined}
            // La activa lleva el menta de relleno —el color de "activo" del sistema— y la otra
            // queda en texto. Sin borde entre ellas: la pastilla contenedora ya las agrupa.
            className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
              esActiva
                ? "bg-brand-soft text-brand-text"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            {v.etiqueta}
          </Link>
        )
      })}
    </div>
  )
}
