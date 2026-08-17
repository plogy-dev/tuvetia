import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { clinicaDeLaSesion } from "@/lib/api/clinica-de-la-sesion"
import { crearFuenteDePago, tokensDeAceptacion } from "@/lib/wompi/api"
import { cobrarPeriodo } from "@/lib/suscripcion/motor"

// El alta: de un token de tarjeta a una suscripción activa.
//
// LO QUE ENTRA ACÁ NO ES UNA TARJETA. Es un token que el navegador consiguió hablando con Wompi
// directo (`lib/wompi/tokenizar-tarjeta.ts`). El número de tarjeta no pasa por este servidor, ni
// por sus logs, ni por Vercel. Ese es el motivo de que la tokenización esté del otro lado.
//
// TRES PASOS, EN ESTE ORDEN Y CON ESTE MANEJO DE FALLOS:
//
//   1. Crear la fuente de pago (la tarjeta guardada). Si falla, no pasó nada y se puede reintentar.
//   2. GUARDARLA EN LA BASE, aunque el cobro todavía no haya salido. Es el paso que parece de más y
//      es el que evita el peor estado posible: una tarjeta registrada en Wompi que nosotros no
//      conocemos. Si se guardara después del cobro y el proceso muriera en el medio, el vet tendría
//      que volver a escribir la tarjeta y quedarían dos fuentes de pago para la misma clínica.
//   3. Cobrar el primer período. **No activa Pro**: eso lo hace el webhook cuando Wompi confirma.
//
// EL PLAN NO SE ACTIVA ACÁ. Es la regla de todo el motor: `POST /transactions` responde `PENDING` y
// dar eso por aprobado sería regalar el mes cada vez que un banco rechace después.

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const sesion = await clinicaDeLaSesion(supabase, user.id)
  if (!sesion.ok) return NextResponse.json({ error: sesion.mensaje }, { status: sesion.status })
  if (sesion.role !== "admin") {
    return NextResponse.json(
      { error: "Sólo el administrador de la clínica puede contratar el plan." },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as {
    token?: string
    marca?: string
    ultimos4?: string
    correo?: string
  }

  const token = body.token?.trim() ?? ""
  if (!token) return NextResponse.json({ error: "Falta el token de la tarjeta." }, { status: 400 })

  // El correo del cobro es el de la SESIÓN, no uno que venga en el cuerpo. Wompi exige mandar el
  // mismo correo en cada cobro que el usado al crear la fuente de pago, y dejarlo elegir desde el
  // navegador permitiría atar la tarjeta de la clínica a un correo ajeno.
  const correo = user.email
  if (!correo) {
    return NextResponse.json({ error: "Tu cuenta no tiene un correo asociado." }, { status: 400 })
  }

  // ── 1. Términos + fuente de pago ─────────────────────────────────────────────────────────────
  const aceptacion = await tokensDeAceptacion()
  if (!aceptacion.ok) return NextResponse.json({ error: aceptacion.mensaje }, { status: 502 })

  const fuente = await crearFuenteDePago({
    token,
    correo,
    acceptanceToken: aceptacion.data.acceptance_token,
    acceptPersonalAuth: aceptacion.data.accept_personal_auth,
  })
  if (!fuente.ok) return NextResponse.json({ error: fuente.mensaje }, { status: 402 })

  // Una fuente que no queda `AVAILABLE` suele ser un emisor pidiendo autenticación 3D Secure. Hoy
  // ese camino no está implementado, así que se corta acá con un mensaje honesto en vez de dejar
  // una fuente a medias que después falle en cada cobro mensual sin explicación.
  if (fuente.data.status !== "AVAILABLE") {
    console.error("suscripcion/suscribir: fuente de pago no disponible", fuente.data)
    return NextResponse.json(
      {
        error:
          "Tu banco pidió una verificación adicional que todavía no podemos completar. " +
          "Probá con otra tarjeta o escribinos.",
      },
      { status: 402 },
    )
  }

  // ── 2. Guardarla ANTES de cobrar ─────────────────────────────────────────────────────────────
  const db = createAdminClient()
  const { error: errorGuardado } = await db
    .from("clinics")
    .update({
      wompi_payment_source_id: fuente.data.id,
      wompi_customer_email: correo,
      // Los dos únicos datos de la tarjeta que se guardan, y sólo para poder pintar "Visa ···· 4242".
      tarjeta_marca: fuente.data.public_data?.brand ?? body.marca ?? null,
      tarjeta_ultimos4: fuente.data.public_data?.last_four ?? body.ultimos4 ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sesion.clinicId)

  if (errorGuardado) {
    console.error("suscripcion/suscribir: no se pudo guardar la fuente de pago", errorGuardado)
    return NextResponse.json(
      { error: "Guardamos tu tarjeta en la pasarela pero no en tu clínica. Escribinos antes de reintentar." },
      { status: 500 },
    )
  }

  // ── 3. Cobrar el primer período ──────────────────────────────────────────────────────────────
  const cobro = await cobrarPeriodo({
    clinica: {
      id: sesion.clinicId,
      wompi_payment_source_id: fuente.data.id,
      wompi_customer_email: correo,
      plan_renueva_en: null,
      subscription_status: "inactive",
    },
    motivo: "alta",
  })

  if (!cobro.ok) {
    return NextResponse.json({ error: cobro.motivo }, { status: 402 })
  }

  // `pendiente` es la respuesta normal y la interfaz tiene que saber tratarla: se muestra "estamos
  // confirmando tu pago" y se refresca, en vez de anunciar que ya está activo.
  return NextResponse.json({
    ok: true,
    estado: cobro.estado,
    pendiente: cobro.estado === "PENDING",
    transaccionId: cobro.transaccionId,
  })
}
