/**
 * Normalización de teléfonos para WhatsApp (formato wa_id: E.164 sin '+').
 *
 * Contexto Colombia: los celulares son 10 dígitos empezando en 3 y los fijos
 * "nuevos" 10 dígitos empezando en 60x; el indicativo del país es 57.
 * `owners.phone` es texto libre (el vet escribe "300 123 4567", "+57 300...",
 * etc.), así que el matching contra el wa_id del webhook necesita esta
 * canonicalización + un fallback tolerante.
 */

/**
 * Deja solo dígitos y devuelve el número en formato wa_id (ej. 573001234567).
 * Devuelve null si el número no es canonicalizable con confianza (muy corto).
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D+/g, '');
  if (!digits) return null;

  // Prefijos: internacional "00" (ej. 0057300...) y troncal "0" (ej. 0300...).
  // E.164 nunca empieza en 0, así que los ceros iniciales se descartan.
  digits = digits.replace(/^0+/, '');
  if (!digits) return null;

  // Ya viene con indicativo de Colombia: 57 + 10 dígitos.
  if (digits.length === 12 && digits.startsWith('57')) return digits;

  // Nacional de 10 dígitos: celular (3xx) o fijo nuevo (60x) → prepende 57.
  if (digits.length === 10 && (digits.startsWith('3') || digits.startsWith('6'))) {
    return `57${digits}`;
  }

  // Otro país u otro shape con indicativo (11–15 dígitos, regla E.164) → tal cual.
  if (digits.length >= 11 && digits.length <= 15) return digits;

  return null;
}

/**
 * ¿Dos teléfonos apuntan a la misma línea? Compara canonicalizados y, si
 * alguno no canonicaliza (texto libre del CRM), cae a comparar los últimos
 * 10 dígitos.
 */
export function phonesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (na && nb) return na === nb;

  const da = (a ?? '').replace(/\D+/g, '');
  const db = (b ?? '').replace(/\D+/g, '');
  if (da.length >= 10 && db.length >= 10) return da.slice(-10) === db.slice(-10);
  return false;
}
