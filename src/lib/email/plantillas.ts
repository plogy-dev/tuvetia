// Plantillas de correo para el envío masivo, y el relleno de sus huecos.
//
// SIN `server-only` A PROPÓSITO: lo usan las dos mitades. El panel arma la vista previa con esto y
// el servidor valida con esto. Si el preview usara una función y el envío otra, el preview
// mentiría — y una vista previa que miente es peor que no tenerla, porque se firma el envío
// confiando en ella.
//
// EL HUECO SIN RELLENAR ES EL DEFECTO QUE ESTO VIENE A IMPEDIR. "Hola {{nombre}}," salido a 12
// clínicas no se puede deshacer, y es el error clásico de cualquier sistema de plantillas: se ve
// perfecto mientras se redacta, porque quien redacta lee lo que quiso escribir. Por eso `huecos()`
// existe y por eso el servidor RECHAZA un texto que todavía tenga marcas — no alcanza con que la
// interfaz lo deshabilite: la server action es un endpoint y se puede llamar sin pasar por ella.
//
// LAS PLANTILLAS SON TEXTO, Y SE MAQUETAN AL ENVIAR. Acá no hay una sola etiqueta HTML aunque desde
// hoy todo el correo de Tuvetia salga maquetado (`lib/email/maqueta.ts`), y es una decisión, no una
// deuda: lo que devuelve `rellenar()` NO va derecho al destinatario. Cae en un textarea donde quien
// redacta lo edita, y se muestra tal cual en la vista previa que firma antes de mandar.
//
// Devolver HTML desde acá tendría dos costos concretos. Uno, un admin editando `<p style="…">` a
// mano para corregir una coma. Dos —el que rompe algo— `huecos()` tendría que buscar `{{…}}` dentro
// de atributos y entidades: un `{{fecha}}` escapado dentro de un `href` ya no es el mismo string
// que el que se ve en pantalla, y el mensaje de error terminaría nombrando huecos de un texto que
// nadie escribió.
//
// La envoltura se pone UNA vez, en el envío (`admin/usuarios/actions.ts`), sobre el texto ya
// rellenado. Así la vista previa sigue mostrando exactamente la cadena que el servidor valida, que
// es la propiedad que sostiene este módulo entero.
//
// ALCANCE: avisos OPERATIVOS a usuarios del producto (mantenimiento, incidencias, novedades,
// recordatorios de configuración). No hay plantillas comerciales, y no es un olvido: eso exige base
// legal bajo la Ley 1581, enlace de baja y registro de consentimiento, y nada de eso está
// construido. Ver `src/app/admin/usuarios/actions.ts`.

export type Plantilla = {
  id: string
  /** Cómo se llama en el selector. */
  nombre: string
  /** Cuándo usarla. Se muestra bajo el selector para que no se elija por el título. */
  para: string
  asunto: string
  cuerpo: string
}

/** `{{ algo }}` — el hueco que hay que rellenar antes de mandar. */
const MARCA = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

export const PLANTILLAS: Plantilla[] = [
  {
    id: "mantenimiento",
    nombre: "Mantenimiento programado",
    para: "Cuando Tuvetia va a estar caído o degradado en una ventana conocida.",
    asunto: "Mantenimiento programado el {{fecha}}",
    cuerpo:
      "Hola,\n\n" +
      "El {{fecha}}, entre las {{desde}} y las {{hasta}} (hora de Colombia), vamos a hacer un " +
      "mantenimiento de Tuvetia. Durante ese rato la plataforma puede quedar lenta o no responder.\n\n" +
      "No hace falta que hagas nada. Nada de lo que tengas cargado se pierde.\n\n" +
      "Si al terminar notás algo raro, escribinos y lo miramos enseguida.\n\n" +
      "El equipo de Tuvetia",
  },
  {
    id: "incidencia",
    nombre: "Incidencia resuelta",
    para: "Después de una caída o un fallo que los usuarios pudieron notar. Se manda cuando ya está resuelto.",
    asunto: "Ya está resuelto: {{resumen}}",
    cuerpo:
      "Hola,\n\n" +
      // LA FECHA ES UN HUECO, no "hoy". Un post-mortem se manda con frecuencia al día siguiente
      // —cuando ya se sabe la causa— y con "hoy" escrito a mano el correo salía mintiendo, sin
      // forma de corregirlo salvo editando el cuerpo.
      "El {{fecha}}, entre las {{desde}} y las {{hasta}}, {{resumen}}. Ya está resuelto.\n\n" +
      "Qué pasó: {{causa}}\n\n" +
      "Qué hicimos para que no se repita: {{remedio}}\n\n" +
      "Si algo te quedó a medias durante ese rato, escribinos y lo revisamos con vos.\n\n" +
      "El equipo de Tuvetia",
  },
  {
    id: "novedad",
    nombre: "Novedad del producto",
    para: "Una función nueva que cambia cómo se trabaja. No es publicidad: describe algo que ya está en su cuenta.",
    asunto: "Nuevo en Tuvetia: {{titulo}}",
    cuerpo:
      "Hola,\n\n" +
      "Desde hoy tenés {{titulo}} en tu cuenta.\n\n" +
      "{{descripcion}}\n\n" +
      "Lo encontrás en {{donde}}.\n\n" +
      "Si algo no se entiende o no funciona como esperabas, respondé este correo.\n\n" +
      "El equipo de Tuvetia",
  },
  {
    id: "configuracion",
    nombre: "Recordatorio de configuración",
    para: "Para cuentas que quedaron a medio configurar y por eso no están aprovechando el producto.",
    asunto: "Te falta un paso para terminar de configurar Tuvetia",
    cuerpo:
      "Hola,\n\n" +
      "Vimos que tu cuenta de Tuvetia quedó sin {{pendiente}}, y eso hace que {{consecuencia}}.\n\n" +
      "Se resuelve en un minuto desde {{donde}}.\n\n" +
      "Si preferís que lo hagamos juntos, respondé este correo y coordinamos.\n\n" +
      "El equipo de Tuvetia",
  },
]

export function plantillaPorId(id: string): Plantilla | undefined {
  return PLANTILLAS.find((p) => p.id === id)
}

/** Los huecos que quedan sin rellenar, en orden de aparición y sin repetir. */
export function huecos(...textos: string[]): string[] {
  const vistos = new Set<string>()
  for (const texto of textos) {
    for (const m of texto.matchAll(MARCA)) vistos.add(m[1])
  }
  return [...vistos]
}

/** Reemplaza los huecos por sus valores. Los que no tengan valor QUEDAN VISIBLES a propósito. */
export function rellenar(texto: string, valores: Record<string, string>): string {
  return texto.replace(MARCA, (marca, nombre: string) => {
    const v = valores[nombre]
    // Un valor en blanco NO cuenta como relleno: dejar la marca es lo que hace que `huecos()` lo
    // siga viendo y el envío siga bloqueado. Reemplazar por "" produciría "Hola ," — que pasa todas
    // las validaciones y llega igual de mal.
    return v && v.trim() ? v.trim() : marca
  })
}

// NO HAY UN `listoParaEnviar()`, y se quitó a propósito. Existía, y nadie lo usaba: los dos
// consumidores reales —el panel y la validación del servidor— no preguntan SI está listo, preguntan
// QUÉ falta, porque los dos nombran los huecos que quedan (la pantalla los lista, el servidor los
// pone en el mensaje de error). Un booleano encima de `huecos()` obligaba a llamar dos funciones
// para una sola pregunta, o a calcular lo mismo dos veces.
//
// Su propio test decía que era "lo mismo que mirar los huecos". Cuando un test tiene que afirmar
// que una función es redundante, la función es redundante.
