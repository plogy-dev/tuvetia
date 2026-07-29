"""Gate de dosis: si faltan datos del paciente, ninguna cifra de dosis llega al veterinario.

Regla no negociable nº4 del CLAUDE.md ("sin dosis si faltan especie, peso o edad"). Vive en el
CÓDIGO y no en el prompt por la misma razón que el gate de alergia: **medido, el prompt no la
cumple**. Banco de 23 respuestas contra producción (2026-07-29), consulta general (sin ficha, así
que ninguna dosis es calculable):

  - prompt de producción, que ya decía "no propongas dosis si faltan especie, peso o edad":
    **2/23 respuestas traían cifras** igual.
  - prompt "clínico" (más accionable, +3,1 de utilidad medida): **9/23**. Pedirle a un modelo que
    sea resolutivo lo empuja a dosificar, y endurecer el texto de la regla NO lo evitó — escribía
    el rango y a continuación advertía que no se usara sin el peso. El rango ya quedaba escrito.

Por eso la cifra se tapa determinísticamente. Lo que el veterinario ve es el fármaco y el motivo
por el que falta la dosis, nunca un número que el sistema no pudo verificar.
"""
import re

# Unidades de dosificación por peso: son las que exigen el peso del paciente. Cubre "mg/kg",
# "mg / kg", "mg/kg/día", "mcg/kg/min", "UI/kg", "ml/kg". El número puede ser rango ("5-10"),
# decimal con coma o punto, y llevar unidades compuestas detrás.
_NUM = r"\d+(?:[.,]\d+)?(?:\s*[-–a]\s*\d+(?:[.,]\d+)?)?"
_UNIDAD = r"(?:mg|mcg|µg|ug|g|ml|l|ui|u|meq)"
_POR_KG = r"\s*/\s*(?:kg|kilo|kilogramo)"
DOSE_RE = re.compile(rf"{_NUM}\s*{_UNIDAD}{_POR_KG}(?:\s*/\s*\w+)?", re.IGNORECASE)

# Colchón de emisión para el chat en streaming: ninguna cifra puede escaparse a medias. Es más
# largo que el patrón más largo que reconocemos ("0,25 mg / kg / día" ~ 20 chars), con margen.
STREAM_TAIL = 48

REDACTED = "[dosis omitida: falta peso/edad del paciente]"

# Aviso que acompaña a una redacción, para que el vet sepa qué pasó y cómo obtener la dosis.
DOSE_NOTICE = ("Se omitieron las cifras de dosis: faltan datos del paciente (especie, peso o edad). "
               "Completá la ficha o indicá el peso y te doy la dosificación.")


def patient_data_complete(species: str | None, weight_kg: float | None,
                          age_years: float | None) -> bool:
    """¿Hay con qué dosificar? Exige los tres datos de la regla nº4."""
    return bool(species) and weight_kg is not None and age_years is not None


def has_dose(text: str) -> bool:
    return bool(DOSE_RE.search(text or ""))


def redact_doses(text: str) -> tuple[str, bool]:
    """Tapa toda cifra de dosis por peso. Devuelve (texto, se_redactó).

    No borra la frase: el fármaco, la vía y la frecuencia siguen siendo información clínica útil
    y verificable. Lo único que se quita es el número que el sistema no puede sostener.
    """
    if not text:
        return text or "", False
    nuevo, n = DOSE_RE.subn(REDACTED, text)
    return nuevo, n > 0


def split_safe_tail(buffer: str) -> tuple[str, str]:
    """Parte el buffer del stream en (lo que ya se puede emitir, lo que hay que retener).

    Retiene una cola de `STREAM_TAIL` caracteres para que ningún patrón de dosis quede partido
    entre dos emisiones: si se emitiera "doxiciclina 10 mg" y recién después "/kg", la cifra ya
    estaría en pantalla cuando el guard la reconozca. Corta en un espacio para no partir palabras.
    """
    if len(buffer) <= STREAM_TAIL:
        return "", buffer
    corte = buffer.rfind(" ", 0, len(buffer) - STREAM_TAIL)
    if corte <= 0:
        return "", buffer
    return buffer[:corte + 1], buffer[corte + 1:]
