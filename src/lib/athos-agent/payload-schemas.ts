import { z } from "zod"

// Esquemas del payload TAL COMO SE GUARDA en `athos_actions`, para revalidarlo en el momento de
// ejecutar una acción aprobada.
//
// POR QUÉ NO SE REUSA EL `inputSchema` DE LA TOOL. Porque no describen lo mismo: el `inputSchema`
// valida lo que el MODELO escribe, y el payload guardado es el resultado de transformarlo. El caso
// claro es `create_appointment`: el modelo manda `date`, `time` y `duration_min`, y lo que se guarda
// es `starts_at` y `ends_at` ya resueltos a ISO con la zona de Colombia. Validar el payload contra el
// `inputSchema` fallaría siempre, y validar contra nada es lo que había.
//
// EL HUECO QUE CIERRA. La ruta de ejecución hace `{...action.payload, ...body.payload_override}`. Que
// el veterinario pueda editar la propuesta antes de aprobarla es la intención del diseño; que lo
// editado no tenga que seguir siendo válido, no. Entre la propuesta y la ejecución, el payload pasaba
// por el navegador sin que nada volviera a mirarlo.
//
// Dos capas de protección, y la segunda es la que más rinde:
//   1. Los campos conocidos se validan por tipo y por forma (un `patient_id` tiene que ser un uuid).
//   2. **Los campos desconocidos se DESCARTAN**, porque `z.object()` no los conserva al parsear. Si
//      alguien agrega `clinic_id` o `vet_id` al override esperando que llegue a la RPC, no llega.
//
// Esto NO reemplaza a la RLS ni a la sesión del veterinario: la ejecución sigue corriendo bajo su
// `auth.uid()` real. Es defensa en profundidad sobre el único tramo donde el payload sale del
// servidor y vuelve.

const uuid = z.string().uuid()
const textoOpcional = z.string().nullable().optional()

// Los tres campos de fecha se guardan ya resueltos a ISO, no como `date`/`time`. patient_id,
// owner_id y reason pasan a ser obligatorios (0048_calendar_admin_redesign endureció el RPC del
// mismo modo — paciente, titular, vet y motivo obligatorios, y el paciente debe ser DEL titular):
// si el modelo no los trae, la propuesta ya no llega a proponerse (ver tools.ts), así que acá deben
// exigirse igual o una revisión editada a mano podría colarlos vacíos.
const CREATE_APPOINTMENT = z.object({
  title: z.string().min(1),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  patient_id: uuid,
  owner_id: uuid,
  reason: z.string().min(1),
  notes: textoOpcional,
})

/** `update_appointment` guarda el id más SÓLO los campos que cambian: todos opcionales. */
const UPDATE_APPOINTMENT = z.object({
  appointment_id: uuid,
  title: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  duration_min: z.number().int().min(5).max(240).optional(),
  reason: textoOpcional,
  notes: textoOpcional,
  status: z.enum(["scheduled", "confirmed", "completed", "canceled", "no_show"]).optional(),
})

const OWNER = z.object({
  full_name: z.string().min(2),
  phone: textoOpcional,
  email: textoOpcional,
  document_id: textoOpcional,
  address: textoOpcional,
  notes: textoOpcional,
})

const PATIENT_SIN_OWNER = z.object({
  name: z.string().min(1),
  species: z.string().min(1),
  sex: z.enum(["male", "female", "unknown"]).optional(),
  breed: textoOpcional,
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  weight_kg: z.number().positive().max(999).nullable().optional(),
})

export const PAYLOAD_SCHEMAS = {
  send_whatsapp_message: z.object({
    // El teléfono se guarda ya normalizado a dígitos por la tool.
    to_phone: z.string().regex(/^\d{6,20}$/, "el teléfono debe venir normalizado a dígitos"),
    body: z.string().min(1).max(1500),
    owner_id: uuid.nullable().optional(),
    in_reply_to: z.string().nullable().optional(),
  }),
  create_appointment: CREATE_APPOINTMENT,
  update_appointment: UPDATE_APPOINTMENT,
  create_owner: OWNER,
  create_patient: PATIENT_SIN_OWNER.extend({ owner_id: uuid }),
  create_owner_and_patient: z.object({ owner: OWNER, patient: PATIENT_SIN_OWNER }),
  update_patient_record: z.object({
    patient_id: uuid,
    weight_kg: z.number().positive().max(999).optional(),
    notes_append: z.string().min(1).optional(),
    // `allergen`, no `substance`: es el nombre que escribe la tool (`tools.ts` → add_allergy) y el
    // que lee el ejecutor (`execute/route.ts` → allergy.allergen). Con `substance` este esquema
    // rechazaba TODA propuesta de alergia con "add_allergy.substance: Required" — la alergia nunca
    // se podía aprobar. Y `severity` es obligatoria, no opcional: la tool ya la exige y la columna
    // `allergies.severity` es NOT NULL sin default, así que permitir que falte solo movía el fallo
    // a un error de Postgres a mitad de la ejecución.
    add_allergy: z
      .object({
        allergen: z.string().min(1),
        severity: z.enum(["mild", "moderate", "severe"]),
        reaction: textoOpcional,
      })
      .optional(),
  }),
} as const

export type ToolConPayload = keyof typeof PAYLOAD_SCHEMAS

/**
 * Revalida el payload que se va a ejecutar. Devuelve el payload SANEADO (sin campos desconocidos) o
 * un mensaje de error legible para mostrarle al veterinario en la tarjeta.
 *
 * Una tool sin esquema declarado pasa tal cual: es preferible a bloquear una acción legítima porque
 * alguien agregó una tool y olvidó su esquema. El inventario cerrado de tools del smoke test
 * (`agent-smoke.test.ts`) es lo que evita que eso se acumule sin que nadie lo note.
 */
export function validarPayload(
  toolName: string,
  payload: Record<string, unknown>,
): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
  const schema = PAYLOAD_SCHEMAS[toolName as ToolConPayload]
  if (!schema) return { ok: true, payload }

  const r = schema.safeParse(payload)
  if (r.success) return { ok: true, payload: r.data as Record<string, unknown> }

  const detalle = r.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
    .join("; ")
  return { ok: false, error: `La acción editada no es válida — ${detalle}` }
}
