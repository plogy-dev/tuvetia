// El contenido de la Política de Tratamiento de la Información.
//
// POR QUÉ ES DATO Y NO JSX. Dos razones concretas:
//
//   1. **Se puede verificar que esté completa.** La Ley 1581 y el Decreto 1074 exigen unos
//      contenidos mínimos —quién es el responsable, qué datos, para qué, qué derechos tiene el
//      titular y cómo los ejerce, y la vigencia—. Con el texto como dato, un test comprueba que
//      ninguno falte. Con el texto dentro de un componente, sólo lo comprueba quien lo lea.
//   2. **El texto es el compromiso legal, no la maqueta.** Separarlo del render deja claro qué es
//      lo que se prometió y qué es presentación.
//
// EL INVENTARIO DE DATOS ES REAL. Cada tabla y columna que se nombra salió de consultar la base de
// producción el 2026-08-17, no de una plantilla. Una política que declara tratar datos que el
// sistema no guarda —o que omite los que sí— es peor que ninguna: es una declaración falsa.
//
// ⚠️ **ESTO NO REEMPLAZA LA REVISIÓN DE UN ABOGADO.** El inventario es exacto; la suficiencia
// jurídica de la redacción frente a la SIC no la certifica este archivo.

export type Bloque =
  | { tipo: "parrafo"; texto: string }
  | { tipo: "lista"; items: string[] }
  | { tipo: "tabla"; encabezados: [string, string]; filas: Array<[string, string]> }
  | { tipo: "aviso"; texto: string }

export type Seccion = {
  /** Ancla estable: se usa en el `id` del `<h2>` y no debería cambiar una vez publicada. */
  id: string
  titulo: string
  bloques: Bloque[]
}

/** Última revisión del texto. Se muestra al pie y es lo que fija la versión que alguien aceptó. */
export const VERSION_POLITICA = "2026-08-17"

export const POLITICA: Seccion[] = [
  {
    id: "responsable",
    titulo: "1. Responsable del tratamiento",
    bloques: [
      {
        tipo: "parrafo",
        texto:
          "Los datos personales que se tratan a través de Tuvetia están bajo la responsabilidad de la entidad que se identifica a continuación, ante la cual todo titular puede ejercer sus derechos.",
      },
      {
        tipo: "parrafo",
        texto:
          "La clínica veterinaria que utiliza Tuvetia es Responsable de los datos de sus titulares. Tuvetia actúa como Encargado del tratamiento: trata esos datos por cuenta de la clínica y siguiendo sus instrucciones.",
      },
    ],
  },
  {
    id: "datos",
    titulo: "2. Qué datos se tratan",
    bloques: [
      {
        tipo: "parrafo",
        texto:
          "Este inventario corresponde a los datos que el sistema efectivamente almacena, no a una enumeración genérica.",
      },
      {
        tipo: "tabla",
        encabezados: ["Categoría", "Datos"],
        filas: [
          [
            "Titulares (dueños de las mascotas)",
            "Nombre completo, documento de identidad, dirección, teléfono, correo electrónico y las notas que la clínica registre.",
          ],
          [
            "Comunicaciones",
            "Contenido de los mensajes de WhatsApp y de correo electrónico intercambiados con la clínica, los números y direcciones asociados, y los archivos enviados por esos canales.",
          ],
          [
            "Voz",
            "Grabación de la consulta veterinaria —que incluye la voz del titular— y su transcripción.",
          ],
          [
            "Personal de la clínica",
            "Nombre, teléfono, correo, rol, y la dirección IP registrada en la traza de auditoría.",
          ],
          [
            "Facturación",
            "Datos del adquiriente y de proveedores, incluido documento o NIT, exigidos por la normativa tributaria.",
          ],
        ],
      },
      {
        tipo: "aviso",
        texto:
          "La historia clínica corresponde a un animal. Un animal no es titular de datos personales, de modo que su ficha clínica no constituye dato sensible de salud en los términos de la Ley 1581. Lo que sí es sensible es la voz del titular y su documento de identidad.",
      },
      {
        tipo: "parrafo",
        texto:
          "La grabación de audio se conserva durante 4 días y luego se elimina de forma automática. La transcripción se conserva como parte de la historia clínica. El consentimiento para grabar es previo y bloqueante: sin él la aplicación no habilita el micrófono, y queda registrado el texto exacto que el titular aceptó.",
      },
    ],
  },
  {
    id: "finalidades",
    titulo: "3. Para qué se tratan",
    bloques: [
      {
        tipo: "lista",
        items: [
          "Prestar el servicio veterinario: historia clínica, agenda y seguimiento del paciente.",
          "Comunicarse con el titular: recordatorios de cita, resultados y respuestas a sus mensajes.",
          "Facturar y gestionar el cobro, conforme a la normativa tributaria aplicable.",
          "Asistir al veterinario mediante inteligencia artificial, redactando la nota clínica a partir de la consulta y sugiriendo respuestas. Toda propuesta requiere la aprobación expresa del veterinario: el sistema no ejecuta acciones por su cuenta.",
          "Garantizar la seguridad y la trazabilidad de las operaciones realizadas sobre los datos.",
        ],
      },
      {
        tipo: "parrafo",
        texto:
          "No se venden ni ceden datos personales a terceros con fines comerciales. No se utilizan los datos de una clínica para entrenar modelos de inteligencia artificial ni para beneficiar a otra clínica. Ninguna clínica puede acceder a los datos de otra: el aislamiento está impuesto en la base de datos, no en la aplicación.",
      },
    ],
  },
  {
    id: "encargados",
    titulo: "4. Encargados y transferencias internacionales",
    bloques: [
      {
        tipo: "parrafo",
        texto:
          "Para operar, Tuvetia se apoya en proveedores que pueden procesar datos por su cuenta. Varios de ellos operan fuera de Colombia, lo que constituye transferencia internacional en los términos del artículo 26 de la Ley 1581.",
      },
      {
        tipo: "tabla",
        encabezados: ["Proveedor", "Qué procesa"],
        filas: [
          ["Supabase", "Almacenamiento de la base de datos."],
          [
            "DeepSeek, Anthropic, Google",
            "Texto de la consulta, para redactar la nota clínica o sugerir una respuesta.",
          ],
          ["Deepgram", "Audio de la consulta, para transcribirlo."],
          ["Cohere", "Búsqueda semántica sobre literatura veterinaria."],
          ["Evolution API", "Mensajería de WhatsApp, en servidor propio."],
          ["Composio", "Correo y calendario del veterinario."],
          ["Resend", "Envío de facturas y recordatorios por correo."],
        ],
      },
    ],
  },
  {
    id: "derechos",
    titulo: "5. Derechos del titular",
    bloques: [
      {
        tipo: "parrafo",
        texto: "Como titular de sus datos personales, usted puede en cualquier momento:",
      },
      {
        tipo: "lista",
        items: [
          "Conocer qué datos suyos se tratan y de qué manera.",
          "Actualizar y rectificar los datos incompletos, inexactos o desactualizados.",
          "Solicitar prueba de la autorización que otorgó para el tratamiento.",
          "Revocar la autorización y solicitar la supresión de sus datos, cuando no exista un deber legal o contractual de conservarlos.",
          "Presentar quejas ante la Superintendencia de Industria y Comercio por infracciones a la ley.",
          "Acceder de forma gratuita a sus datos personales.",
        ],
      },
      {
        tipo: "parrafo",
        texto:
          "Para ejercerlos, escriba al correo de contacto indicado en la sección 1, señalando su nombre, documento de identidad y la solicitud concreta. Las consultas se atienden en un plazo máximo de 10 días hábiles y los reclamos en 15 días hábiles, prorrogables en los términos que la ley permite.",
      },
    ],
  },
  {
    id: "conservacion",
    titulo: "6. Conservación",
    bloques: [
      {
        tipo: "tabla",
        encabezados: ["Dato", "Durante cuánto tiempo"],
        filas: [
          ["Grabación de audio de la consulta", "4 días, con eliminación automática."],
          [
            "Transcripción y nota clínica",
            "Mientras dure la relación con la clínica y, después, conforme a la normativa aplicable a la historia clínica.",
          ],
          ["Datos de facturación", "Los plazos que exija la normativa tributaria."],
          [
            "Mensajes de WhatsApp y de correo",
            "Mientras la clínica los conserve en la plataforma.",
          ],
          ["Traza de auditoría", "Mientras exista la clínica en la plataforma."],
        ],
      },
    ],
  },
  {
    id: "seguridad",
    titulo: "7. Medidas de seguridad",
    bloques: [
      {
        tipo: "parrafo",
        texto: "Las siguientes medidas están efectivamente implementadas, no sólo declaradas:",
      },
      {
        tipo: "lista",
        items: [
          "Aislamiento por clínica impuesto en la base de datos mediante seguridad a nivel de fila.",
          "Cifrado de las credenciales de terceros con AES-256-GCM.",
          "Consentimiento de grabación bloqueante, exigido por la propia base de datos.",
          "Nota clínica inmutable una vez aprobada por el veterinario.",
          "Registro de auditoría de las creaciones, modificaciones y eliminaciones de datos.",
          "Eliminación automática del audio de las consultas a los 4 días.",
          "Control de acceso por rol y lista de autorizados para el panel de administración.",
        ],
      },
    ],
  },
  {
    id: "vigencia",
    titulo: "8. Vigencia y cambios",
    bloques: [
      {
        tipo: "parrafo",
        texto:
          "Esta política rige desde su publicación. Los cambios sustanciales se comunicarán a través de la aplicación o por correo electrónico antes de que entren en vigor.",
      },
    ],
  },
]

/**
 * Las secciones que la Ley 1581 y el Decreto 1074 exigen que una política contenga.
 *
 * Está acá y no sólo en el test para que se lea junto al contenido: quien edite la política ve, en
 * el mismo archivo, qué no puede sacar.
 */
export const SECCIONES_OBLIGATORIAS = [
  "responsable",
  "datos",
  "finalidades",
  "derechos",
  "vigencia",
] as const
