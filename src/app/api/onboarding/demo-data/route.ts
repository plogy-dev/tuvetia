import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { clinicaPuede } from "@/lib/planes/servidor"
import {
  borrarDemoCompleto,
  sembrarCatalogo,
  sembrarFacturas,
  sembrarMeta,
} from "@/lib/onboarding/demo-completo"

// Datos de ejemplo del onboarding: paciente "Luna (ejemplo)" con consulta transcrita y nota SOAP
// draft, para que el vet explore el Modo Fantasma sin grabar nada. Marcador: el titular
// "Ejemplo — TuvetIA" (DELETE borra por él; los FKs en cascada limpian todo).
// La nota va SIN citas (citations=[]) a propósito: no fabricamos referencias bibliográficas.
//
// OJO: este string NO se renombró a "Tuvetia" con el resto de la marca a propósito — es una CLAVE
// de búsqueda, no texto visible. Las filas de demo que ya existen en producción lo tienen así, y
// cambiarlo dejaría esos datos huérfanos (el DELETE no los encontraría). Si algún día se migra,
// hay que actualizar el valor en la BD y aquí en el mismo movimiento (ver también dashboard/page.tsx).

const DEMO_OWNER = "Ejemplo — TuvetIA"

const DEMO_TRANSCRIPT = [
  "Veterinario: Hola, cuéntame ¿qué le pasa a Luna?",
  "Titular: Doctor, desde anoche vomitó tres veces y no quiere comer nada.",
  "Veterinario: ¿Comió algo fuera de lo normal? ¿Basura, huesos, algún alimento nuevo?",
  "Titular: Ayer en el parque se comió algo del piso, no alcancé a ver qué era.",
  "Veterinario: Bien. A la palpación el abdomen está algo tenso pero sin dolor agudo. Temperatura 38.6, mucosas rosadas, hidratación normal.",
  "Titular: ¿Es grave?",
  "Veterinario: Por ahora parece una gastritis aguda por indiscreción alimentaria. Vamos con dieta blanda 24 horas, agua en tomas pequeñas y control mañana. Si vomita de nuevo o decae, me la traes de inmediato.",
].join("\n")

const DEMO_SOAP = {
  subjective:
    "Titular reporta 3 episodios de vómito desde anoche e hiporexia. Posible ingesta de material desconocido en el parque el día previo.",
  objective:
    "Abdomen levemente tenso a la palpación, sin dolor agudo. T° 38.6 °C, mucosas rosadas, TLC normal, hidratación adecuada.",
  assessment:
    "Cuadro compatible con gastritis aguda por indiscreción alimentaria. No se observan signos de alarma al examen físico.",
  plan:
    "Dieta blanda por 24 h, agua en tomas pequeñas y frecuentes. Control en 24 h. Acudir de inmediato si hay nuevos vómitos, decaimiento o dolor abdominal.",
}

// Lee con el cliente ADMIN, así que no puede apoyarse en `clinicaDeLaSesion` (que va por la sesión
// del usuario) ni en la RLS: `service_role` se la salta entera. Por eso `is_active` se comprueba
// acá a mano — es el único de los nueve puntos donde la guarda no viene de arriba.
//
// Devolver `clinicId: null` cuando la cuenta está desactivada es exactamente lo que hace falta: la
// ruta ya trata ese caso como "no tiene clínica" y no siembra nada.
async function clinicOf(userId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from("profiles")
    .select("clinic_id, is_active, role")
    .eq("id", userId)
    .maybeSingle()
  const p = data as {
    clinic_id: string | null
    is_active: boolean | null
    role: string | null
  } | null
  if (p?.is_active === false) return { admin, clinicId: null, role: null }
  return { admin, clinicId: p?.clinic_id ?? null, role: p?.role ?? null }
}

/**
 * Las fases con volumen: catálogo con existencias, facturas del mes y la meta.
 *
 * ── EL ORDEN NO ES NEGOCIABLE ─────────────────────────────────────────────────────────────────
 *
 * Catálogo y existencias ANTES que las facturas, porque emitir descuenta inventario de verdad
 * (`issueInvoice` inserta su `SALIDA_VENTA`). Al revés, o quedan existencias en negativo, o la
 * emisión corta con «existencia insuficiente» si la clínica tiene activado ese bloqueo.
 *
 * Y la meta AL FINAL, porque se calcula sobre lo que efectivamente se vendió: ponerla antes sería
 * inventar un número que no guarda relación con lo que el anillo va a comparar.
 *
 * Las facturas se le hacen a los titulares REALES de la clínica, no al titular de ejemplo: son
 * ellos los que aparecen en el libro de ventas y en la cartera, y una lista donde los quince
 * documentos son del mismo cliente no se parece a una clínica.
 */
async function sembrarComercial(
  admin: ReturnType<typeof createAdminClient>,
  clinicId: string,
  userId: string,
) {
  const items = await sembrarCatalogo(admin, clinicId, userId)

  const { data: titulares } = await admin
    .from("owners")
    .select("id")
    .eq("clinic_id", clinicId)
    .limit(12)
  const ownerIds = ((titulares as { id: string }[] | null) ?? []).map((o) => o.id)

  const hoy = new Date()
  const facturas = await sembrarFacturas(admin, clinicId, userId, ownerIds, items, hoy)

  // Lo vendido de verdad, leído de la base y no acumulado en memoria: si alguna emisión falló, la
  // meta tiene que salir de lo que quedó escrito, no de lo que se intentó.
  const inicioDeMes = new Date(
    Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1) + 5 * 3_600_000,
  )
  const { data: emitidas } = await admin
    .from("invoices")
    .select("total_cents")
    .eq("clinic_id", clinicId)
    .eq("status", "EMITIDA")
    .gte("issued_at", inicioDeMes.toISOString())
  const vendido = ((emitidas as { total_cents: number }[] | null) ?? []).reduce(
    (s, f) => s + (f.total_cents ?? 0),
    0,
  )
  const meta = await sembrarMeta(admin, clinicId, vendido)

  return { items: items.length, ...facturas, vendidoCents: vendido, metaCents: meta }
}

// `request` es OPCIONAL a propósito: los tests que fijan el contrato de la siembra de siempre
// llaman `POST()` sin argumentos, y ese contrato es justamente lo que no se puede mover — es la
// prueba de que las clínicas nuevas siguen recibiendo lo mismo. Sin cuerpo, no hay modo completo.
export async function POST(request?: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const { admin, clinicId, role } = await clinicOf(user.id)
  if (!clinicId) return NextResponse.json({ error: "El usuario no tiene clínica" }, { status: 400 })

  // ── EL MODO COMPLETO ES OPT-IN, Y NO ES UN DETALLE ────────────────────────────────────────────
  //
  // Este mismo endpoint lo llama el asistente de bienvenida para TODA clínica nueva. La siembra
  // comercial —catálogo, existencias, facturas emitidas con su consecutivo— no puede entrar por
  // ese camino: una clínica real nacería con ventas que nadie hizo, y esas facturas llevan número,
  // quedan en la historia y ensucian los números de su primer mes.
  //
  // Sin la bandera, todo lo de abajo se comporta EXACTAMENTE como antes. Es lo que fijan los tests
  // que ya existían, y por eso no se tocaron.
  //
  // El cuerpo puede venir vacío (el asistente hace `POST` sin cuerpo), así que el parseo falla
  // hacia el lado seguro: sin cuerpo, no hay modo completo.
  const cuerpo = request
    ? ((await request.json().catch(() => ({}))) as { completo?: boolean })
    : {}
  const completo = cuerpo?.completo === true

  // Sembrar veinte facturas es una escritura grande y visible para toda la clínica. Que la pida
  // quien administra, no cualquiera con sesión.
  if (completo && role !== "admin") {
    return NextResponse.json(
      { error: "Sólo un administrador puede sembrar los datos de demostración completos" },
      { status: 403 },
    )
  }

  // EL TITULAR CREADO EN ESTA LLAMADA, para poder deshacer si algo falla a mitad de camino.
  //
  // POR QUÉ HACE FALTA. La siembra son cinco inserts y NO es transaccional: si el cuarto falla, los
  // tres primeros ya están escritos. Y como la guarda de idempotencia de abajo pregunta sólo por el
  // TITULAR, el reintento lo encuentra y responde `{ ok: true, already: true }` — o sea que el demo
  // queda roto para siempre y encima reportando éxito. Es el peor final posible: un fallo que se
  // presenta como un acierto.
  //
  // Deshacer restaura la invariante de la que depende la guarda: **si el titular demo existe,
  // el demo está completo**. Los FK en cascada se llevan paciente, consulta, transcript y nota.
  let titularSembrado: string | null = null

  try {
    // Idempotente: si el demo ya existe, no duplicar.
    const { data: existing } = await admin
      .from("owners")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("full_name", DEMO_OWNER)
      .maybeSingle()
    if (existing) {
      // LA GUARDA VIEJA NO PUEDE CORTAR EL MODO COMPLETO. Preguntaba sólo por el titular, así que
      // una clínica ya sembrada respondía «already» y no se le podía agregar nada — que es
      // exactamente el caso de la clínica que había que preparar para la demostración: tenía el
      // titular desde hace días y ni una factura. Cada fase de abajo trae su propia guarda.
      if (!completo) return NextResponse.json({ ok: true, already: true })
      const extra = await sembrarComercial(admin, clinicId, user.id)
      return NextResponse.json({ ok: true, already: true, completo: extra })
    }

    const { data: owner, error: oErr } = await admin
      .from("owners")
      .insert({ clinic_id: clinicId, full_name: DEMO_OWNER })
      .select("id")
      .single()
    if (oErr) throw new Error(oErr.message)
    titularSembrado = (owner as { id: string }).id

    const { data: patient, error: pErr } = await admin
      .from("patients")
      .insert({
        clinic_id: clinicId,
        owner_id: (owner as { id: string }).id,
        name: "Luna (ejemplo)",
        species: "Perro",
        breed: "Criollo",
        weight_kg: 12,
        notes: "Paciente de ejemplo creado por el onboarding — se puede borrar desde el dashboard.",
      })
      .select("id")
      .single()
    if (pErr) throw new Error(pErr.message)

    const patientId = (patient as { id: string }).id

    // ── LA FICHA DE EJEMPLO TIENE ALERGIA SEVERA Y VACUNAS, Y NO ES ADORNO ────────────────────
    //
    // Hasta el 27-ago Luna nacía con la ficha vacía: sin alergias, sin vacunas, sin historia. O sea
    // que el demo de Tuvetia OMITÍA justo lo que más lo diferencia — el gate de alergia severa, que
    // es una regla determinística del producto (nº3) y la función que hace que un vet levante la
    // ceja. Un veterinario recorriendo el ejemplo veía una ficha de perro cualquiera.
    //
    // Se descubrió probando: con la ficha vacía, cuatro preguntas de la batería de VetGPT no podían
    // ejercitarse —el gate, el cruce ficha-contra-relato, los refuerzos de vacuna— y el asistente
    // contestaba, correctamente, «no voy a inventar». La prueba no fallaba: no llegaba a existir.
    //
    // AMOXICILINA Y NO POLLO, a propósito: el gate tiene que dispararse contra un PLAN, y un
    // antibiótico de primera línea es lo que un vet va a proponer sin pensarlo. Una alergia
    // alimentaria se queda en la anamnesis y no frena nada.
    const { error: aErr } = await admin.from("allergies").insert({
      clinic_id: clinicId,
      patient_id: patientId,
      allergen: "Amoxicilina",
      severity: "severe",
      reaction: "Angioedema facial y urticaria a los 20 minutos de la primera dosis (ejemplo).",
      confirmed: true,
      created_by: user.id,
    })
    if (aErr) throw new Error(aErr.message)

    // Dos vacunas: una vencida y otra por vencer este mes. Con las dos, la ficha muestra el estado
    // real de un paciente de verdad —al día en una, atrasado en otra— que es lo que se ve en una
    // clínica y lo que hace útil el recordatorio.
    const hoy = new Date()
    const enDias = (d: number) =>
      new Date(hoy.getTime() + d * 86400000).toISOString().slice(0, 10)
    const { error: vErr } = await admin.from("vaccines").insert([
      {
        clinic_id: clinicId,
        patient_id: patientId,
        vaccine_name: "Quíntuple canina",
        administered_at: enDias(-350),
        next_dose_at: enDias(-5), // vencida: aparece como atrasada
        administered_by: user.id,
        notes: "Ejemplo del onboarding.",
      },
      {
        clinic_id: clinicId,
        patient_id: patientId,
        vaccine_name: "Antirrábica",
        administered_at: enDias(-340),
        next_dose_at: enDias(12), // por vencer: aparece en los refuerzos del mes
        administered_by: user.id,
        notes: "Ejemplo del onboarding.",
      },
    ])
    if (vErr) throw new Error(vErr.message)

    // ── DE ACÁ EN ADELANTE ES DEMO DEL MODO FANTASMA, Y ESO ES DE PRO ─────────────────────────
    //
    // Los tres inserts que siguen —consulta, transcripción y nota SOAP— existen para que el vet
    // vea cómo queda una consulta grabada sin tener que grabar una. En una clínica free eso es
    // demostrar algo que no puede usar, y además **el trigger `consultations_requiere_pro` de la
    // 0065 lo rechaza**: los triggers se disparan aunque el cliente sea `service_role`, que sólo
    // se salta la RLS.
    //
    // Sin este corte, la siembra reventaría en el insert de la consulta, el `catch` desharía el
    // titular y el veterinario terminaría el onboarding SIN datos de ejemplo y con el mensaje
    // "El Modo Fantasma es parte del plan Pro" en la cara, sin haber pedido nada de eso. Un muro
    // de pago que aparece solo, en el peor momento y rompiendo otra cosa.
    //
    // Con el corte, una clínica free igual se lleva a Luna y a su titular: puede recorrer la ficha,
    // la lista de pacientes y la agenda, que es lo que SÍ tiene. Se le muestra lo que compró.
    //
    // LO QUE SE ACEPTA A CAMBIO: la guarda de idempotencia de arriba pregunta sólo por el titular,
    // así que una clínica que siembre en free y después suba a Pro no recibe la consulta de
    // ejemplo al reintentar — le responde `already: true`. Es un demo de onboarding, de una sola
    // vez; agregarle una segunda guarda por consulta complicaría el deshacer a cambio de un caso
    // que se resuelve borrando el ejemplo y volviéndolo a cargar.
    if (!(await clinicaPuede(clinicId, "modo-fantasma"))) {
      return NextResponse.json({ ok: true, parcial: "sin-modo-fantasma" })
    }

    const { data: consultation, error: cErr } = await admin
      .from("consultations")
      .insert({
        clinic_id: clinicId,
        patient_id: (patient as { id: string }).id,
        owner_id: (owner as { id: string }).id,
        vet_id: user.id,
        status: "review",
        chief_complaint: "Vómitos y falta de apetito (ejemplo)",
      })
      .select("id")
      .single()
    if (cErr) throw new Error(cErr.message)

    const consultationId = (consultation as { id: string }).id
    const { error: tErr } = await admin.from("transcripts").insert({
      clinic_id: clinicId,
      consultation_id: consultationId,
      full_text: DEMO_TRANSCRIPT,
      stt_provider: "demo",
      stt_model: "ejemplo",
    })
    if (tErr) throw new Error(tErr.message)

    const { error: nErr } = await admin.from("clinical_notes").insert({
      clinic_id: clinicId,
      consultation_id: consultationId,
      status: "draft",
      ...DEMO_SOAP,
      citations: [],
      ai_model: "ejemplo (datos de demostración)",
      ai_generated_at: new Date().toISOString(),
    })
    if (nErr) throw new Error(nErr.message)

    if (completo) {
      const extra = await sembrarComercial(admin, clinicId, user.id)
      return NextResponse.json({ ok: true, completo: extra })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    // DESHACER lo sembrado a medias. Sin esto, el reintento encuentra al titular, lo da por completo
    // y devuelve éxito sobre un demo que no tiene ni consulta ni nota.
    //
    // El borrado va con su `clinic_id` además del id: es `service_role`, que se salta la RLS, y la
    // regla de la casa es que toda consulta con esa credencial lleve su filtro de clínica explícito.
    if (titularSembrado) {
      const { error: limpieza } = await admin
        .from("owners")
        .delete()
        .eq("id", titularSembrado)
        .eq("clinic_id", clinicId)
      // Si NI SIQUIERA se pudo limpiar, se dice: es el único caso en que sí queda un demo a medias,
      // y callarlo lo volvería indiagnosticable — que es el defecto que este bloque vino a cerrar.
      if (limpieza) {
        console.error(
          `[onboarding/demo-data] siembra fallida Y limpieza fallida en la clínica ${clinicId}:`,
          limpieza.message,
        )
      }
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  try {
    const { admin, clinicId } = await clinicOf(user.id)
    if (!clinicId) return NextResponse.json({ error: "El usuario no tiene clínica" }, { status: 400 })

    // PRIMERO LO QUE NO CUELGA DEL TITULAR. Facturas, catálogo y movimientos tienen sus claves a
    // paciente y titular en `set null`, así que la cascada no los alcanza: borrar sólo al titular
    // los dejaría para siempre, invisibles y sin forma de encontrarlos. Se borran por su marca.
    const borrados = await borrarDemoCompleto(admin, clinicId)

    // Y ahora sí el titular demo: los FKs en cascada limpian paciente -> consulta -> transcript/nota.
    const { error, count } = await admin
      .from("owners")
      .delete({ count: "exact" })
      .eq("clinic_id", clinicId)
      .eq("full_name", DEMO_OWNER)
    if (error) throw new Error(error.message)

    // Se devuelve el CONTEO y no un `ok` a secas. El borrado viejo respondía éxito aunque no
    // hubiera borrado nada —por ejemplo si alguien le cambió el nombre al titular—, y desde afuera
    // era indistinguible de haber limpiado de verdad.
    return NextResponse.json({ ok: true, borrados: { ...borrados, owners: count ?? 0 } })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
