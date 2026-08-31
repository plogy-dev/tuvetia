import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireClinicAdmin } from "@/lib/clinic-role"
import { logoutInstance } from "@/lib/whatsapp/evolution"
import { loadIntegration } from "@/lib/whatsapp/send-message"

export const runtime = "nodejs"

// Desconecta el WhatsApp de la clínica.
//
// ── POR QUÉ ESTA RUTA NACE TARDE ───────────────────────────────────────────────────────────────
//
// El aviso que el vet acepta para conectar (`whatsapp-settings.tsx`) dice, literal: «el riesgo
// sobre el número es de la clínica. Puedo desconectar cuando quiera». Se podía conectar y no se
// podía desconectar: `agent-mode`, `connect`, `evolution`, `exchange`, `send`, `status` y `webhook`,
// y ninguna cortaba nada. Eso no es una función que falta — es una promesa firmada que no se
// cumplía, y la promesa es justamente la que hace aceptable el riesgo que se acaba de consentir.
//
// ── SOLO ADMINISTRADOR, igual que `agent-mode` ─────────────────────────────────────────────────
//
// Y por un motivo más fuerte que el de allá. Cambiar `agent_mode` decide si Athos habla solo;
// desconectar corta la línea ENTERA de la clínica: mientras esté desconectada, los mensajes de los
// titulares no llegan a Tuvetia y NO se encolan en ningún lado — lo que entró mientras tanto se
// pierde para la bandeja. Es la definición de `clinic-role.ts`: «lo que sale de la clínica sin
// vuelta atrás».
//
// Y NO CONTRADICE EL CONSENTIMIENTO. El aviso dice «el control sobre el número es de la CLÍNICA»,
// no «de quien apretó conectar». Que el control lo ejerza su administrador es el control de la
// clínica; lo que estaría roto es que no lo pudiera ejercer nadie, que es lo que pasaba hasta hoy.
// Conectar sigue pudiéndolo hacer cualquier miembro: conectar es aditivo y se deshace: desconectar
// es sustractivo y mientras dura hay mensajes que no llegan.
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  let clinicId: string
  try {
    ;({ clinicId } = await requireClinicAdmin())
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const integ = await loadIntegration(clinicId)
  // Idempotente a propósito: dos clics, o el botón de una pestaña vieja, no son un error que
  // haya que explicarle a nadie. Ya está desconectado, que es lo que se pedía.
  if (!integ) return NextResponse.json({ ok: true, ya_estaba: true })

  const admin = createAdminClient()

  // Se lee ANTES de pisarlo: es lo que queda en la traza y lo único que permitiría saber, meses
  // después, que esta clínica tenía el modo automático encendido cuando se desconectó.
  const { data: previa } = await admin
    .from("whatsapp_integrations")
    .select("agent_mode")
    .eq("clinic_id", clinicId)
    .maybeSingle()
  const modoAnterior = (previa as { agent_mode: string } | null)?.agent_mode ?? "review"

  // ── EL HISTORIAL NO SE TOCA ──────────────────────────────────────────────────────────────────
  //
  // `whatsapp_messages` no se borra ni se anonimiza acá. Esa tabla no es «datos de la integración»:
  // es la conversación de la clínica con sus titulares, y buena parte es historia clínica de hecho
  // («la perra sigue vomitando»). Desconectar el proveedor y borrar las conversaciones son dos
  // decisiones distintas; ésta es sólo la primera. Lo que se corta es el cable, no lo que se dijo.
  //
  // Tampoco se toca `unofficial_consent_at`: es el registro de que alguien, un día, aceptó el
  // riesgo del protocolo no oficial. Un dato de auditoría no se borra porque el estado cambió.
  //
  // Ni `phone_number` ni `evolution_instance`: los mensajes ya guardados los referencian, y sin
  // instancia el webhook no sabría a qué clínica pertenece un entrante rezagado.
  const ahora = new Date().toISOString()
  const { error } = await admin
    .from("whatsapp_integrations")
    .update({
      status: "disconnected",
      // ── QUÉ PASA CON `agent_mode`: VUELVE A 'review'. ────────────────────────────────────────
      //
      // No es higiene, es un agujero concreto. `auto-reply.ts` exige `status === 'connected'`, así
      // que una integración desconectada es inerte AHORA; el problema es después. El estado vuelve
      // a `connected` SOLO —lo escriben `status/route.ts` y el `connection.update` del webhook de
      // Evolution— y en ese instante un `agent_mode` que siguiera en 'auto' reanudaría un bot
      // hablándole a los clientes de la clínica sin que nadie, en ese momento, lo haya decidido.
      //
      // Reconectar tiene que ser reconectar y nada más. Encender las respuestas automáticas es una
      // decisión aparte, la toma un administrador, y queda en `audit_logs` con su nombre. El modo
      // que había queda registrado más abajo, así que no se pierde: hay que volver a elegirlo.
      agent_mode: "review",
      // La credencial de Meta/Kapso, fuera. Un `status` en 'disconnected' es una bandera nuestra:
      // el token seguiría siendo un permiso vivo para escribirles a los titulares de esta clínica.
      // «Desconectar» con la llave todavía guardada es media desconexión — y es la mitad que
      // importa cuando alguien desconecta porque desconfía.
      access_token_enc: null,
      token_expires_at: null,
      updated_at: ahora,
    })
    .eq("clinic_id", clinicId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // ── EL PROVEEDOR, DESPUÉS DE LA BASE ─────────────────────────────────────────────────────────
  //
  // El orden es la parte pensada. Si primero se avisara al proveedor y fallara la escritura, el
  // teléfono quedaría desvinculado con Tuvetia diciendo «Conectado»: la pantalla mentiría en la
  // dirección peligrosa. Al revés, un fallo del proveedor deja a Tuvetia sin poder mandar nada
  // —`sendWhatsAppText` corta con `status !== 'connected'`— y la sesión de WhatsApp Web abierta,
  // que es molesto pero no manda ni un mensaje.
  //
  // Sólo Evolution tiene a quién avisarle: Baileys mantiene una sesión de WhatsApp Web viva y hay
  // que cerrarla, o el teléfono del vet sigue mostrando a Tuvetia entre sus dispositivos
  // vinculados. Meta y Kapso no exponen un «logout» equivalente: ahí desconectar es exactamente
  // tirar la credencial, que es lo que acaba de pasar arriba.
  let proveedorAvisado = true
  if (integ.provider === "evolution" && integ.evolution_instance) {
    try {
      await logoutInstance(integ.evolution_instance)
    } catch (e) {
      // NO se revierte la desconexión ni se devuelve un error: para la clínica ya está desconectado
      // y eso es cierto. Lo que se devuelve es el trabajo que quedó pendiente del lado del teléfono,
      // para que la pantalla lo pueda decir en vez de dejar un dispositivo vinculado invisible.
      proveedorAvisado = false
      console.error("whatsapp/disconnect: Evolution no cerró la sesión:", (e as Error).message)
    }
  }

  await admin.from("audit_logs").insert({
    clinic_id: clinicId,
    user_id: user.id,
    action: "whatsapp.disconnect",
    table_name: "whatsapp_integrations",
    payload: {
      provider: integ.provider,
      // El modo que había. Es lo que permite reconstruir por qué el modo automático amaneció
      // apagado, y devolverlo a mano si la clínica lo pide.
      agent_mode_anterior: modoAnterior,
      proveedor_avisado: proveedorAvisado,
    },
  })

  return NextResponse.json({
    ok: true,
    status: "disconnected",
    proveedor_avisado: proveedorAvisado,
    agent_mode: "review",
    agent_mode_anterior: modoAnterior,
  })
}
