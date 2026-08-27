/* Datos de la demo autónoma — el caso de Rocky. */

export const NOTEBOOK = `rocky — prurito 2 sem, peor de noche
orejas: cerumen oscuro ++, olor a levadura
pliegue facial con eritema
cambio de alimento hace 1 mes (¿lleva pollo? ver ficha: alergia marzo)
hoy: citología + raspado
si malassezia → limpiador enzimático + antifúngico tópico
hablar dieta de eliminación con el dueño (8 sem)
ojo: 2 vómitos con espuma esta mañana — palpar abdomen`;

export const liveNote = {
  motivo:
    "Prurito de dos semanas de evolución, con predominio nocturno. Se rasca las orejas y se lame las patas.",
  anamnesis:
    "Cambio de alimento hace ~1 mes. Sin antiparasitario externo al día según el dueño. Sin episodios previos de otitis registrados este año.",
  vitales: {
    Temperatura: "38.6 °C",
    FC: "110 lpm",
    Peso: "12.4 kg (−0.7 vs último control)",
  } as Record<string, string>,
  hallazgos: [
    "Eritema en pliegue facial, con humedad y olor a levadura",
    "Cerumen oscuro abundante bilateral en conducto auditivo",
    "Tinción salival marrón en patas delanteras",
  ],
  plan: "Citología ótica bilateral + raspado del pliegue hoy. Limpieza ótica enzimática. Evaluar dieta de eliminación 8 semanas según resultados.",
  abiertas: [
    "¿Fecha exacta del cambio de alimento?",
    "¿Antipulgas al día? Confirmar producto y fecha",
  ],
};

export const transcript = [
  { t: "10:03", sp: "vet", txt: "A ver Rocky, vamos a revisarte. ¿Hace cuánto notaste que se rasca así?" },
  { t: "10:03", sp: "duenio", txt: "Como dos semanas, doctora. Sobre todo de noche — se rasca las orejas y se lame mucho las patas." },
  { t: "10:04", sp: "vet", txt: "Acá en el pliegue facial tiene la piel irritada, y las orejas con bastante cerumen oscuro. Hay olor a levadura." },
  { t: "10:05", sp: "duenio", txt: "Le cambiamos el alimento el mes pasado, ¿puede ser por eso?" },
  { t: "10:06", sp: "vet", txt: "Puede influir. Vamos a hacer citología de oído y un raspado del pliegue para confirmar antes de medicar." },
];

export const sugs = [
  {
    kind: "contradiction",
    lb: "Contradicciones con la ficha",
    conf: "alta",
    based: "Ficha CRM · alergias + transcript 10:05",
    txt: "En la ficha de Rocky figura «alergia a pollo» registrada en marzo. El alimento nuevo que menciona el dueño lista pollo como primer ingrediente.",
  },
  {
    kind: "differential",
    lb: "Diferenciales a considerar",
    conf: "media",
    based: "Transcript 10:04 + historial de visitas",
    txt: "Prurito facial + otitis bilateral con cerumen oscuro en bulldog francés: considera dermatitis por Malassezia secundaria a atopia, además de la alergia alimentaria.",
  },
  {
    kind: "question",
    lb: "Preguntas para el dueño",
    conf: "media",
    based: "Patrón de anamnesis incompleto",
    txt: "¿El prurito mejora cuando Rocky cambia de ambiente (viajes, campo)? Ayuda a diferenciar atopia estacional de alergia alimentaria.",
  },
];

export const vetNotes = [
  { t: "10:05", txt: "Citología de oído bilateral — pedirle a Laura que prepare los portaobjetos." },
  { t: "10:08", txt: "Volver a pesar al final; la báscula marcaba raro al entrar." },
];

/**
 * Casos parecidos: lo que la clínica YA vio.
 *
 * La pestaña existía en las dos barras y caía al «Próximamente · placeholder en el código real» —
 * a un clic desde la home, en la cara de un visitante. Era el hallazgo más visible de la auditoría
 * del 26-ago y el más barato de cerrar, porque la función existe: `CasosParecidos` busca en el
 * historial de la propia clínica, no en literatura.
 *
 * El segundo caso es el que vale la pena y por eso está: enseña el patrón que se pierde cuando cada
 * consulta se mira sola. No es un adorno del demo, es de qué sirve la pestaña.
 */
export const similares = [
  {
    pac: "Nina · bulldog francés · 4 años",
    cuando: "hace 3 meses",
    match: "Prurito facial y otitis bilateral con cerumen oscuro",
    cierre:
      "Citología: Malassezia. Limpieza enzimática y antifúngico tópico. La dieta sin proteína aviar cortó el prurito en la semana 6.",
  },
  {
    pac: "Trufa · bulldog francés · 6 años",
    cuando: "hace 8 meses",
    match: "Tercer episodio de otitis en el año",
    cierre:
      "Se trató sólo el oído las tres veces. Recién con la dieta de eliminación dejó de recaer.",
  },
];

/**
 * El chat: una pregunta clínica contestada CON FUENTES.
 *
 * Misma historia que `similares` — la pestaña caía al placeholder. La respuesta va en lenguaje de
 * posibilidad y con su banda de evidencia porque esa es la regla que el servicio impone por código,
 * no por prompt: cita o se calla. Un demo que mostrara al modelo afirmando de más estaría vendiendo
 * algo que el producto se niega a hacer.
 */
export const chatDemo = {
  pregunta:
    "¿Cuántas semanas tiene que durar la dieta de eliminación para descartar alergia alimentaria?",
  respuesta:
    "La evidencia disponible sugiere un mínimo de <b>8 semanas</b> con una proteína novel o hidrolizada, y sin premios ni saborizantes en ese período. En cuadros con otitis asociada, varias series describen que la respuesta cutánea puede tardar más que la ótica.",
  fuentes: "2 fuentes citadas",
  banda: "evidencia suficiente",
};

export const PILL_TABS: Array<[string, string]> = [
  ["transcript", "Transcripción"],
  // El id se queda en inglés: es la clave que lee `engine.ts`, no algo que alguien vea.
  ["live-notes", "Notas en vivo"],
  ["similar", "Casos parecidos"],
  ["suggestions", "Sugerencias"],
  ["vet-notes", "Notas del vet"],
  ["chat", "Chat"],
];

export const CK_TABS: Array<[string, string]> = [
  ["consulta", "Consulta"],
  ["transcript", "Transcripción"],
  ["similar", "Casos parecidos"],
  ["suggestions", "Sugerencias"],
  ["chat", "Chat"],
];
