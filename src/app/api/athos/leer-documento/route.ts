import { generateText } from "ai"
import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { clinicaDeLaSesion, requiereCapacidad } from "@/lib/api/clinica-de-la-sesion"
import { visionModel } from "@/lib/athos-agent/model"
import { registrarUso } from "@/lib/athos-agent/usage"
import { rateLimit } from "@/lib/athos-agent/rate-limit"
import { consultarPresupuesto, mensajeSinCupo } from "@/lib/athos-agent/presupuesto"

export const runtime = "nodejs"
export const maxDuration = 60

// FASE 2 de los adjuntos del chat: leer con el modelo un PDF que NO trae texto digital (escaneado).
//
// La fase 1 es gratis y no pasa por aquí: `lib/athos-adjuntos.ts` extrae el texto con pdfjs en el
// navegador, y solo cuando esa extracción sale vacía (documento escaneado) el cliente cae a esta
// ruta. El diseño de costos es deliberado: el PDF se paga UNA vez —aquí, al adjuntarlo— y al chat
// entra ya como texto, así que los turnos siguientes de la conversación no lo re-facturan.
//
// Modelo: `visionModel()` — la misma superficie de visión que lee recetas y facturas desde imagen
// (Anthropic por defecto, `ATHOS_VISION_CASCADE` para respaldo con Gemini). DeepSeek no lee PDFs,
// por eso esto NO usa el modelo del agente.

// ~10 MB de PDF en base64. El límite real de la fase 2 son las páginas (abajo), pero sin un tope de
// bytes un PDF gigante viaja entero hasta el modelo solo para fallar allá, pagando el intento.
const MAX_BASE64 = 14_000_000

// Tope de páginas para leer con IA: el costo escala por página (~1.5-3k tokens c/u). 25 páginas
// cubre cualquier laboratorio/informe real; un libro escaneado no es un adjunto de chat.
// (Espejo del MAX_PAGINAS_IA del cliente en lib/athos-adjuntos.ts — un route.ts no puede exportar
// constantes, así que el número vive dos veces a propósito y cada copia apunta a la otra.)
const MAX_PAGINAS_IA = 25

const BodySchema = z.object({
  nombre: z.string().min(1).max(200),
  pdf_base64: z.string().min(100).max(MAX_BASE64),
  paginas: z.number().int().positive().max(MAX_PAGINAS_IA),
})

// Transcripción fiel, no interpretación: el documento entra al chat como CONTEXTO que el vet y
// Athos discuten después — si el lector "opinara", esa opinión se disfrazaría de contenido del
// documento. Acotar la salida también acota el costo.
const EXTRACCION_SYSTEM =
  "Transcribes documentos clínicos veterinarios (laboratorios, historias, recetas, informes) a " +
  "texto plano fiel.\n" +
  "- Extrae TODO el contenido informativo: valores con unidades y rangos de referencia, fechas, " +
  "nombres, medicamentos, hallazgos, conclusiones.\n" +
  "- Conserva la estructura con encabezados y listas simples; una sección por página solo si el " +
  "documento la trae.\n" +
  "- Omite la decoración repetida (membretes, pies de página iguales en cada hoja).\n" +
  "- NO interpretes, NO diagnostiques, NO agregues nada que no esté en el documento. Lo ilegible " +
  "se marca [ilegible], no se adivina."

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  // Más estricto que el chat (5/min): cada llamada arrastra un documento entero por el modelo.
  const rl = rateLimit(`athos-leer-doc:${user.id}`, 5, 60_000)
  if (!rl.allowed)
    return NextResponse.json({ error: "Demasiados documentos seguidos" }, { status: 429 })

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: `El documento no se pudo procesar (¿más de ${MAX_PAGINAS_IA} páginas o muy pesado?).` },
      { status: 400 },
    )
  }
  const { nombre, pdf_base64 } = parsed.data

  const sesion = await clinicaDeLaSesion(supabase, user.id)
  if (!sesion.ok) return NextResponse.json({ error: sesion.mensaje }, { status: sesion.status })
  const { clinicId } = sesion

  // Leer documentos ES Athos: misma capacidad y mismo cupo mensual compartido que el chat.
  const conPlan = requiereCapacidad(sesion.plan, "athos")
  if (!conPlan.ok) {
    return NextResponse.json(
      { error: conPlan.mensaje, requierePlan: "pro", capacidad: conPlan.capacidad },
      { status: conPlan.status },
    )
  }
  const presupuesto = await consultarPresupuesto(clinicId)
  if (!presupuesto.permitido) {
    return NextResponse.json({ error: mensajeSinCupo(presupuesto) }, { status: 402 })
  }

  const elegido = visionModel()
  try {
    const result = await generateText({
      model: elegido.model,
      system: EXTRACCION_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "file", data: pdf_base64, mediaType: "application/pdf" },
            {
              type: "text",
              text: `Transcribe el contenido de este documento ("${nombre}") para el veterinario.`,
            },
          ],
        },
      ],
      maxOutputTokens: 3000,
    })

    // Best-effort, como todas las superficies (`registrarUso` no lanza). `totalUsage` por si el
    // proveedor parte la respuesta en pasos.
    void registrarUso({
      clinicId,
      userId: user.id,
      surface: "leer_documento",
      elegido,
      usage: result.totalUsage,
    })

    const texto = result.text?.trim()
    if (!texto) {
      return NextResponse.json(
        { error: `No se pudo leer "${nombre}" — el documento parece vacío o ilegible.` },
        { status: 502 },
      )
    }
    return NextResponse.json({ texto })
  } catch (e) {
    console.error("athos/leer-documento:", e)
    return NextResponse.json(
      { error: `No se pudo leer "${nombre}". Intenta de nuevo o adjunta el resultado como texto.` },
      { status: 502 },
    )
  }
}
