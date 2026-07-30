"""Quién es el veterinario y quién el titular, inferido del CONTENIDO de lo que dicen.

Deepgram devuelve índices de hablante (0, 1, ...), no roles. El código asumía que **el hablante 0 es
el veterinario** porque "normalmente inicia la consulta", y esa suposición es falsa en la consulta
real: el dueño suele abrir ("Doctor, mi perro no come"). Resultado: **todo el diálogo quedaba
invertido**, y como la etiqueta se escribe dentro de `transcripts.full_text`, tampoco se podía
corregir al mostrarlo. Es el hallazgo §4.6a de la auditoría del Milestone 2.

La inferencia es **determinística y sin LLM**, siguiendo la filosofía del servicio: en español hay
marcadores muy confiables de rol. Quien dice "doctor" o "mi perro" es el dueño; quien dice "vamos a
palpar" o "voy a revisarlo" es el clínico. Se puntúan los dos hablantes y gana la diferencia.

Cuando no hay señal suficiente **no se inventa**: se devuelve `confident=False` y se cae a la
convención anterior, para que la UI pueda ofrecer el intercambio manual sabiendo que es incierto.
"""
import re
import unicodedata

# Marcadores del TITULAR (dueño). El más fuerte es el vocativo: nadie le dice "doctor" al dueño.
_TITULAR = (
    (r"\bdoctor(?:a|es)?\b", 3.0),
    (r"\bdoc\b", 3.0),
    (r"\bveterinari[oa]\b", 2.0),          # "usted es el veterinario", lo dice el dueño
    (r"\bmi (?:perr[oa]|gat[oa]|mascota|cachorr[oa]|anima(?:l|lito)|conej[oa]|lor[oa])\b", 3.0),
    (r"\bmi (?:peludo|bebe|niñ[oa])\b", 2.0),
    (r"\ble (?:doy|di|dimos|damos)\b", 1.0),   # el dueño reporta lo que le dio
    (r"\b(?:lo|la) (?:note|notamos|vi|vimos|traigo|traje)\b", 1.5),
    (r"\bno (?:quiere|quiso) comer\b", 1.0),
    (r"\bhace (?:dos|tres|cuatro|cinco|unos|como)\b", 0.5),
)

# Marcadores del VETERINARIO: exploración, plan y trato del animal como paciente ajeno.
_VETERINARIO = (
    (r"\bvamos a (?:revisar|palpar|auscultar|hacer|tomar|sacar|pesar|examinar)\b", 3.0),
    (r"\b(?:palpo|palpar|ausculto|auscultar|auscultacion|palpacion)\b", 2.5),
    (r"\bvoy a (?:revisar|examinar|palpar|auscultar|tomar|revisarlo|revisarla)\b", 3.0),
    (r"\b(?:compatible con|sugestivo de|diagnostico|pronostico)\b", 2.5),
    (r"\b(?:hemograma|radiografia|ecografia|frotis|analisis de sangre|coprologico)\b", 2.0),
    (r"\b(?:su|tu) (?:perr[oa]|gat[oa]|mascota)\b", 2.0),   # se dirige al dueño sobre SU animal
    (r"\b(?:noto|noto usted|ha notado|notaste|noto si)\b", 1.0),
    (r"\bte (?:voy a|recomiendo|explico)\b", 1.5),
    (r"\b(?:tratamiento|dosis|medicamento|antibiotico|desparasit)\w*\b", 1.0),
    (r"\bhace cuanto\b", 1.5),                              # el clínico interroga
)


def _norm(texto: str) -> str:
    """Minúsculas y sin acentos: la transcripción los pone de forma inconsistente."""
    plano = unicodedata.normalize("NFKD", (texto or "").lower())
    return "".join(c for c in plano if not unicodedata.combining(c))


def _puntuar(texto: str) -> tuple[float, float]:
    """(puntos de titular, puntos de veterinario) para un bloque de texto."""
    t = _norm(texto)
    titular = sum(peso for patron, peso in _TITULAR if re.search(patron, t))
    vet = sum(peso for patron, peso in _VETERINARIO if re.search(patron, t))
    return titular, vet


# Diferencia mínima para creerle a la inferencia. Por debajo, la señal es ruido y es más honesto
# declarar que no se sabe que invertir el diálogo entero por un marcador suelto.
MIN_MARGEN = 2.0


def infer_vet_speaker(segments: list[dict]) -> tuple[int | None, bool]:
    """Devuelve (índice del hablante que es el veterinario, ¿confiable?).

    Con `confident=False` el llamador debe conservar la convención anterior y, idealmente, ofrecerle
    al usuario intercambiar los roles.
    """
    if not segments:
        return None, False
    por_hablante: dict[int, list[str]] = {}
    for s in segments:
        por_hablante.setdefault(s.get("speaker", 0), []).append(s.get("text") or "")
    if len(por_hablante) < 2:
        return None, False

    # Se puntúa el texto COMPLETO de cada hablante: un marcador aislado no debe decidir.
    puntajes: dict[int, float] = {}
    for hablante, textos in por_hablante.items():
        titular, vet = _puntuar(" ".join(textos))
        puntajes[hablante] = vet - titular      # positivo = parece el clínico

    orden = sorted(puntajes.items(), key=lambda kv: kv[1], reverse=True)
    mejor, segundo = orden[0], orden[1]
    margen = mejor[1] - segundo[1]
    return mejor[0], margen >= MIN_MARGEN


def label_for(speaker: int, vet_speaker: int | None, total_hablantes: int) -> str:
    """Etiqueta legible del hablante. Mantiene el vocabulario que ya parsea el front."""
    if vet_speaker is not None:
        if speaker == vet_speaker:
            return "Veterinario"
        if total_hablantes <= 2:
            return "Titular"
    return f"Hablante {speaker + 1}"
