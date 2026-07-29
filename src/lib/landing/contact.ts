/* Config centralizada de contacto. Los dos valores de abajo son
   PLACEHOLDERS: cámbialos aquí y toda la landing se actualiza. */

/** Número de WhatsApp del negocio: solo dígitos, con indicativo de país,
 *  sin "+" ni espacios (ej: "573001234567"). */
export const WHATSAPP_NUMBER = "573146624108";

/** Agenda externa para la opción "Meet" (Calendly o citas de Google Calendar). */
export const MEET_SCHEDULING_URL = "https://calendly.com/tuvetia";

/** Mensaje genérico (Hero y fallbacks). */
export const WA_GENERIC_MESSAGE = "Hola, vengo de la página de TU VET IA. Quiero agendar una demo.";

/** Link wa.me con el mensaje prellenado. */
export function buildWaLink(message: string = WA_GENERIC_MESSAGE): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
