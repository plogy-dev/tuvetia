/**
 * El informe del titular, listo para imprimir o guardar como PDF.
 *
 * DISTINTO DE LA NOTA. La nota SOAP está escrita para otro veterinario y se queda adentro del
 * sistema; esto se lo lleva el dueño y se lee en la casa, con el animal delante. Por eso el papel
 * es deliberadamente más cálido y menos clínico: sin etiquetas técnicas, con tipografía más
 * generosa, y con el contacto de la clínica al pie para que sepa a dónde llamar.
 *
 * IMPRIME LO QUE SE GUARDÓ, no lo que el modelo diría hoy. Es el punto entero de que
 * `client_reports` exista (0071): si el titular vuelve con el papel en la mano, lo que hay que
 * poder reimprimir es ESE papel. Un documento que se regenera cada vez no puede responder "¿qué
 * decía el que me llevé?" — el modelo redacta distinto cada corrida.
 *
 * Toma el MÁS RECIENTE porque el vet puede haber reenviado uno corregido.
 */
import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { PrintAutoTrigger } from "@/components/print/PrintAutoTrigger"
import { bogotaDateOnly } from "@/lib/date-utils"

export const metadata = { title: "Informe para el titular · Tuvetia" }
export const dynamic = "force-dynamic"

type Fila = {
  subject: string
  salutation: string | null
  body: string
  plan: string | null
  warnings: string | null
  signature: string | null
  sent_at: string
}

/** Un bloque de texto libre, respetando los saltos que escribió el vet. */
function Parrafos({ texto }: { texto: string }) {
  return (
    <>
      {texto
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i} className="parrafo">
            {p.split("\n").map((linea, j) => (
              <span key={j} className="linea">
                {linea}
              </span>
            ))}
          </p>
        ))}
    </>
  )
}

export default async function InformeDelTitularPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: informes }, { data: consulta }] = await Promise.all([
    supabase
      .from("client_reports")
      .select("subject, salutation, body, plan, warnings, signature, sent_at")
      .eq("consultation_id", id)
      .order("sent_at", { ascending: false })
      .limit(1),
    supabase
      .from("consultations")
      .select("started_at, patient:patients(name, species, owner:owners(full_name))")
      .eq("id", id)
      .maybeSingle(),
  ])

  const informe = ((informes as Fila[] | null) ?? [])[0]
  if (!informe) notFound()

  const c = consulta as unknown as {
    started_at: string
    patient: { name: string; species: string | null; owner: { full_name: string } | null } | null
  } | null

  return (
    <>
      <style>{ESTILOS}</style>
      <PrintAutoTrigger />
      <article className="hoja">
        <header className="cabecera">
          <h1 className="asunto">{informe.subject}</h1>
          <p className="sub">
            {c?.patient?.name}
            {c?.patient?.species ? ` · ${c.patient.species}` : ""}
            {c?.started_at ? ` · Consulta del ${bogotaDateOnly(c.started_at)}` : ""}
          </p>
        </header>

        {informe.salutation && <p className="saludo">{informe.salutation}</p>}

        <section className="cuerpo">
          <Parrafos texto={informe.body} />
        </section>

        {informe.plan?.trim() && (
          <section className="bloque">
            <h2>Qué hacer en casa</h2>
            <Parrafos texto={informe.plan} />
          </section>
        )}

        {/* LAS ALERTAS VAN DESTACADAS Y AL FINAL, que es donde el ojo vuelve. Es la única sección
            del papel que puede evitar una urgencia mal atendida: si el dueño lee una sola cosa,
            que sea con qué señales volver corriendo. */}
        {informe.warnings?.trim() && (
          <section className="bloque alertas">
            <h2>Cuándo volver de urgencia</h2>
            <Parrafos texto={informe.warnings} />
          </section>
        )}

        <footer className="pie">
          {informe.signature && <p className="firma">{informe.signature}</p>}
          <p className="fecha">Entregado el {bogotaDateOnly(informe.sent_at)}</p>
        </footer>
      </article>
    </>
  )
}

// A4 con márgenes de carta. Sin tokens del sistema de diseño a propósito: esto se imprime en papel,
// donde no hay tema oscuro ni variables CSS — y donde el negro sobre blanco es la única paleta.
const ESTILOS = `
  @page { size: A4; margin: 18mm 16mm; }
  body { background: #fff; }
  .hoja {
    max-width: 176mm; margin: 0 auto; padding: 8mm 0;
    color: #1a1a1a; font-size: 12pt; line-height: 1.6;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .cabecera { border-bottom: 1px solid #d8d8d8; padding-bottom: 6mm; margin-bottom: 7mm; }
  .asunto { font-size: 19pt; line-height: 1.25; font-weight: 600; margin: 0 0 2mm; }
  .sub { margin: 0; font-size: 10.5pt; color: #5c5c5c; }
  .saludo { margin: 0 0 5mm; font-size: 12.5pt; }
  .parrafo { margin: 0 0 3.5mm; }
  .linea { display: block; }
  .bloque { margin-top: 7mm; }
  .bloque h2 { font-size: 12.5pt; font-weight: 600; margin: 0 0 2.5mm; }
  .alertas {
    border: 1px solid #c9c9c9; border-left: 3px solid #1a1a1a;
    padding: 4mm 5mm; page-break-inside: avoid;
  }
  .pie { margin-top: 10mm; padding-top: 5mm; border-top: 1px solid #d8d8d8; }
  .firma { margin: 0 0 1.5mm; font-weight: 500; }
  .fecha { margin: 0; font-size: 10pt; color: #6b6b6b; }
  @media print { .no-print { display: none !important; } }
`
