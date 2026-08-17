import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { clinicaDeLaSesion } from "@/lib/api/clinica-de-la-sesion"
import { tokensDeAceptacion } from "@/lib/wompi/api"

// Los términos que hay que aceptar antes de guardar una tarjeta.
//
// POR QUÉ ES UNA RUTA Y NO SE PIDEN DESDE EL NAVEGADOR. Técnicamente el endpoint de Wompi que los
// entrega acepta la llave pública, así que el formulario podría pedirlos solo. Pasan por acá por
// dos motivos: quedan detrás de la sesión (nadie los saca sin estar autenticado) y el navegador
// nunca necesita saber cuál es el ambiente ni armar la URL de Wompi.
//
// SON DE VIDA CORTA. Se piden al abrir el formulario, no al cargar la app: un token vencido produce
// un error de validación en la creación de la fuente de pago que no dice nada útil.

export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const sesion = await clinicaDeLaSesion(supabase, user.id)
  if (!sesion.ok) return NextResponse.json({ error: sesion.mensaje }, { status: sesion.status })

  // Sólo el administrador. Es el mismo criterio que invitar al equipo o conectar el calendario:
  // una decisión que compromete a la clínica entera y que cuesta plata.
  if (sesion.role !== "admin") {
    return NextResponse.json(
      { error: "Sólo el administrador de la clínica puede gestionar el plan." },
      { status: 403 },
    )
  }

  const res = await tokensDeAceptacion()
  if (!res.ok) return NextResponse.json({ error: res.mensaje }, { status: 502 })

  // Los tokens en sí NO se le mandan al navegador: viajarían al formulario para volver intactos al
  // servidor en el siguiente paso, y eso los convierte en un dato que alguien puede sustituir. Lo
  // que sí va son los ENLACES, que es lo que el usuario tiene que poder leer antes de aceptar.
  //
  // Los tokens los vuelve a pedir la ruta de suscripción, que es donde se usan.
  return NextResponse.json({
    terminos: res.data.urls.terminos,
    tratamientoDeDatos: res.data.urls.datos,
  })
}
