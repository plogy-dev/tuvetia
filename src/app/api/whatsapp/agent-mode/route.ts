import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireClinicAdmin } from "@/lib/clinic-role"
import { columnasDelNivel } from "@/lib/whatsapp/nivel-de-autonomia"

// Cambia el NIVEL de autonomía del agente de WhatsApp de la clínica. Escritura con service_role
// tras validar la sesión — `whatsapp_integrations` no tiene policies de escritura para clientes.
//
// TRES NIVELES, DOS COLUMNAS. El cuerpo trae uno de `review | auto | confirma` y acá se traduce:
//
//     review    → agent_mode='review'                              (VetGPT sólo sugiere)
//     auto      → agent_mode='auto',  confirma_citas_solo=false    (responde lo no clínico)
//     confirma  → agent_mode='auto',  confirma_citas_solo=true     (además agenda y confirma)
//
// El tercero NO es un valor nuevo del enum `whatsapp_agent_mode`, y es deliberado: todo el sistema
// pregunta `agent_mode = 'auto'` para saber si puede hablar, así que un quinto valor dejaría a la
// clínica de nivel 3 con el agente entero mudo. Ver la migración 0102.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const parsed = z
    .object({ mode: z.enum(["review", "auto", "confirma"]) })
    .safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 })
  const nivel = parsed.data.mode
  // La traducción vive en un solo lugar: la barra la usa al revés para pintar el punto activo, y
  // dos traducciones separadas se desincronizan mostrando un nivel que no es el guardado.
  const { agentMode, confirmaSolo } = columnasDelNivel(nivel)

  // SOLO ADMIN. `agent_mode='auto'` es el ÚNICO interruptor de autorización de las dos rutas que le
  // hablan solas a los titulares (`whatsapp/auto-reply.ts` y `cartera/wa-router.ts`). Todo lo demás
  // en esa cadena —debounce de 5 s, reserva atómica del entrante, rampa de calentamiento, 8/hora,
  // límite diario— son frenos de VOLUMEN, no de permiso: ninguno pregunta quién lo encendió.
  //
  // El `audit_logs` de más abajo deja rastro DESPUÉS del hecho; esto es lo que lo previene.
  let clinicId: string
  try {
    ;({ clinicId } = await requireClinicAdmin())
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const admin = createAdminClient()
  // LAS DOS COLUMNAS SE ESCRIBEN JUNTAS SIEMPRE. Bajar de `confirma` a `auto` tiene que apagar
  // `confirma_citas_solo`, o la clínica seguiría agendando sola después de haber pedido que no —
  // un interruptor que no apaga es peor que no tenerlo.
  const { error } = await admin
    .from("whatsapp_integrations")
    .update({
      agent_mode: agentMode,
      confirma_citas_solo: confirmaSolo,
      updated_at: new Date().toISOString(),
    })
    .eq("clinic_id", clinicId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // EL NIVEL 3 EXIGE QUE EL AVISO AL TITULAR ESTÉ ENCENDIDO. Una cita que VetGPT confirma y de la
  // que la persona nunca se entera es el peor resultado posible: se presentaría o no según lo que
  // recuerde de una conversación por WhatsApp. `confirmarCita` respeta ese interruptor, así que
  // encenderlo acá es lo que hace que el nivel 3 signifique lo que su nombre promete.
  if (confirmaSolo) {
    const { error: errAviso } = await admin
      .from("clinics")
      .update({ confirmacion_citas_activo: true })
      .eq("id", clinicId)
    if (errAviso) {
      console.error("[whatsapp/agent-mode] no se pudo encender el aviso de citas:", errAviso.message)
    }
  }

  await admin.from("audit_logs").insert({
    clinic_id: clinicId,
    user_id: user.id,
    action: `whatsapp.agent_mode.${nivel}`,
    table_name: "whatsapp_integrations",
    payload: { nivel, agent_mode: agentMode, confirma_citas_solo: confirmaSolo },
  })
  return NextResponse.json({ ok: true, mode: nivel })
}
