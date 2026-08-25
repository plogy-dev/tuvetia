import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { EditarTitularDrawer } from "@/components/owners/editar-titular-drawer"
import { RevokeConsentButton } from "@/components/owners/revoke-consent-button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { fmtAgeLong } from "@/lib/age"

// La ficha del titular.
//
// POR QUÉ NO EXISTÍA Y POR QUÉ HACE FALTA AHORA. `/dashboard/owners` era una LISTA sin ficha: un
// callejón sin salida — se veía el nombre y no había a dónde ir. El cliente quiere unir Titulares y
// Pacientes en una sola entrada, y esa fusión no se puede hacer borrando la sección, porque hay tres
// cosas que sólo viven ahí:
//
//   · El **consentimiento de grabación** (Ley 1581), que es del TITULAR y cubre a todas sus
//     mascotas. Moverlo a la ficha del paciente lo duplicaría en cada una, y revocar desde una
//     afectaría a las otras sin decirlo. Eso es riesgo legal, no estético.
//   · El **documento** y el **correo**, que la lista de pacientes no muestra.
//   · Los titulares **sin mascota** — recién creados, o cuya mascota falleció. Si la única entrada
//     fuera Pacientes, desaparecerían de la app.
//
// Esta pantalla es el destino que hace posible la fusión: el titular deja de ser una fila y pasa a
// ser un lugar.

export const metadata = { title: "Titular · Tuvetia" }

type OwnerDetail = {
  id: string
  full_name: string
  document_id: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  created_at: string
}

type PacienteDelTitular = {
  id: string
  name: string
  species: string
  breed: string | null
  birth_date: string | null
  is_deceased: boolean
}

function iniciales(nombre: string) {
  return nombre
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("")
}

/** `etiqueta ··· valor`, la misma gramática del riel y de la tarjeta de acción. */
function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
        {etiqueta}
      </dt>
      <dd className="text-sm">{valor?.trim() ? valor : <span className="text-fg-faint">—</span>}</dd>
    </div>
  )
}

export default async function FichaDeTitularPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // La RLS acota por clínica: un id de otra clínica simplemente no existe acá, y cae en el 404 de
  // abajo sin revelar que existe en otro lado.
  const { data: ownerData, error } = await supabase
    .from("owners")
    .select("id, full_name, document_id, phone, email, address, notes, created_at")
    .eq("id", id)
    .maybeSingle()

  if (error) {
    // Un fallo de red no puede verse igual que "este titular no existe": lo primero se reintenta,
    // lo segundo no.
    return (
      <div className="flex flex-col gap-4 px-4 py-4 md:py-6 lg:px-6">
        <Link
          href="/dashboard/owners"
          className="inline-flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg"
        >
          <ArrowLeft className="size-4" /> Volver a titulares
        </Link>
        <p className="rounded-xl border border-line bg-card p-4 text-sm text-danger">
          No se pudo cargar el titular. Recarga la página para reintentar.
        </p>
      </div>
    )
  }
  const owner = ownerData as OwnerDetail | null
  if (!owner) notFound()

  const [{ data: pacientesData }, { count: consentimientos }] = await Promise.all([
    supabase
      .from("patients")
      .select("id, name, species, breed, birth_date, is_deceased")
      .eq("owner_id", id)
      .order("name"),
    // El consentimiento de grabación vigente del titular. Se busca por sus pacientes porque
    // `consents` cuelga del paciente, aunque el alcance (`owner_scope`) sea del titular.
    //
    // `!inner` + `head` para que el filtro y el conteo ocurran EN LA BASE. El listado hace esto
    // trayendo todos los consentimientos de la clínica y cruzándolos en memoria, que ahí se paga
    // una vez; en una ficha se pagaría en cada visita a cada titular para responder un sí/no.
    supabase
      .from("consents")
      .select("id, patient:patients!inner(owner_id)", { count: "exact", head: true })
      .eq("owner_scope", true)
      .is("revoked_at", null)
      .eq("patient.owner_id", id),
  ])

  const pacientes = (pacientesData as PacienteDelTitular[] | null) ?? []
  const tieneConsentimiento = (consentimientos ?? 0) > 0

  const vivos = pacientes.filter((p) => !p.is_deceased)

  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:gap-5 md:py-6 lg:px-6">
      <Link
        href="/dashboard/owners"
        className="inline-flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" /> Volver a titulares
      </Link>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-card p-4">
        <Avatar className="size-14">
          <AvatarFallback className="text-lg font-semibold">
            {iniciales(owner.full_name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">{owner.full_name}</h1>
            {/* La ficha era de sólo lectura: un teléfono mal tecleado al registrar quedaba mal
                para siempre (y es a donde escriben WhatsApp y los recordatorios). Mismo formulario
                que abre desde la ficha del paciente. */}
            <EditarTitularDrawer
              ownerId={owner.id}
              label="Editar"
              inicial={{
                fullName: owner.full_name,
                phone: owner.phone ?? "",
                email: owner.email ?? "",
                documentId: owner.document_id ?? "",
                address: owner.address ?? "",
              }}
            />
          </div>
          <p className="text-sm text-fg-muted">
            {vivos.length === 0
              ? "Sin mascotas registradas"
              : vivos.length === 1
                ? "1 mascota"
                : `${vivos.length} mascotas`}
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-line bg-card p-4 md:p-5">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
          Datos de contacto
        </h2>
        <dl className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
          <Dato etiqueta="Documento" valor={owner.document_id} />
          <Dato etiqueta="Teléfono" valor={owner.phone} />
          <Dato etiqueta="Correo" valor={owner.email} />
          <Dato etiqueta="Dirección" valor={owner.address} />
        </dl>
        {owner.notes?.trim() && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
              Notas
            </p>
            <p className="text-sm whitespace-pre-wrap">{owner.notes}</p>
          </div>
        )}
      </section>

      {/* EL CONSENTIMIENTO DE GRABACIÓN VIVE ACÁ, y es la razón principal de que esta pantalla
          exista. Es del titular y cubre a todas sus mascotas: mostrarlo por paciente lo repetiría
          N veces y haría que revocarlo desde una mascota apagara la grabación de las otras sin que
          nada lo dijera. */}
      <section className="rounded-xl border border-line bg-card p-4 md:p-5">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
          Consentimiento de grabación
        </h2>
        {tieneConsentimiento ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <span className="font-medium">Vigente.</span>{" "}
              <span className="text-fg-muted">
                Cubre la grabación de las consultas de todas sus mascotas.
              </span>
            </p>
            <RevokeConsentButton ownerId={owner.id} ownerName={owner.full_name} />
          </div>
        ) : (
          <p className="text-sm text-fg-muted">
            Sin consentimiento vigente. Se pide al iniciar la primera consulta grabada; sin él, el
            Modo Fantasma no arranca.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-card p-4 md:p-5">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
          Sus mascotas
        </h2>
        {pacientes.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Este titular todavía no tiene mascotas registradas.
          </p>
        ) : (
          <ul className="flex flex-col">
            {pacientes.map((p, i) => {
              const edad = fmtAgeLong(p.birth_date)
              const meta = [p.species, p.breed, edad].filter(Boolean).join(" · ")
              return (
                <li key={p.id} className={i > 0 ? "border-t border-line-soft" : ""}>
                  <Link
                    href={`/dashboard/patients/${p.id}`}
                    className="flex items-baseline justify-between gap-3 py-2.5 hover:underline"
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate font-medium">{p.name}</span>
                      {p.is_deceased && (
                        <Badge variant="outline" className="shrink-0">
                          Fallecido
                        </Badge>
                      )}
                    </span>
                    <span className="shrink-0 text-sm text-fg-muted">{meta}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
