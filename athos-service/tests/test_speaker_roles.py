"""Inferencia de roles en la transcripción. Determinístico, sin LLM ni red.

El defecto que fija: `SPEAKER_LABELS = {0: "Veterinario", 1: "Titular"}` asumía que el hablante 0 es
el clínico "porque normalmente inicia la consulta". En la consulta real **el dueño suele abrir**
("Doctor, mi perro no come"), así que el diálogo entero quedaba invertido (§4.6a de la auditoría).
"""
from app.speaker_roles import MIN_MARGEN, infer_vet_speaker, label_for


def _seg(speaker: int, text: str) -> dict:
    return {"speaker": speaker, "text": text, "start": 0.0, "end": 1.0}


def test_el_dueño_abre_la_consulta_y_NO_se_confunde_con_el_veterinario():
    """El caso que rompía: habla primero el titular. Antes se le asignaba 'Veterinario'."""
    segs = [
        _seg(0, "Hola doctor, mi perro no quiere comer desde ayer y lo noté muy triste."),
        _seg(1, "Buen día. ¿Hace cuánto lo ve así? Vamos a revisarlo, voy a palpar el abdomen."),
    ]
    vet, confiable = infer_vet_speaker(segs)
    assert confiable is True
    assert vet == 1                       # el que examina, no el que abrió
    assert label_for(0, vet, 2) == "Titular"
    assert label_for(1, vet, 2) == "Veterinario"


def test_el_veterinario_abre_la_consulta():
    """El caso que la heurística vieja acertaba por casualidad: debe seguir acertando."""
    segs = [
        _seg(0, "Hola, ¿qué le pasa a tu perro? Vamos a revisarlo y le tomo la temperatura."),
        _seg(1, "Hola doctora, mi perro tiene diarrea hace tres días."),
    ]
    vet, confiable = infer_vet_speaker(segs)
    assert confiable is True and vet == 0


def test_transcripcion_realista_completa():
    """Diálogo largo, con los dos alternando, como el de los casos del banco golden."""
    segs = [
        _seg(1, "Buen día, ¿qué le pasa a su perro?"),
        _seg(0, "Hola doctor. Tiene una tos rara y se cansa muy rápido cuando lo saco a pasear."),
        _seg(1, "¿Notó si tiene mucha sed o ha perdido peso?"),
        _seg(0, "Sí, toma más agua que antes y está más flaco, a pesar de que come bien."),
        _seg(1, "Voy a revisarlo. Tiene el pecho con ruidos anormales; esto es sugestivo de una "
                "enfermedad parasitaria. Hay que confirmar con análisis de sangre."),
        _seg(0, "¿Y tiene cura?"),
    ]
    vet, confiable = infer_vet_speaker(segs)
    assert confiable is True and vet == 1


def test_sin_señal_no_inventa_el_rol():
    """Si nadie usa marcadores, es más honesto declararlo incierto que invertir el diálogo."""
    segs = [_seg(0, "Sí, claro."), _seg(1, "Bueno, está bien.")]
    vet, confiable = infer_vet_speaker(segs)
    assert confiable is False


def test_señal_debil_no_alcanza_el_umbral():
    """Un marcador suelto no debe decidir por todo el diálogo."""
    segs = [_seg(0, "Hace dos días."), _seg(1, "Entiendo, sigamos.")]
    _vet, confiable = infer_vet_speaker(segs)
    assert confiable is False


def test_un_solo_hablante_no_tiene_roles_que_repartir():
    assert infer_vet_speaker([_seg(0, "Hola doctor, mi gato no come.")]) == (None, False)


def test_lista_vacia():
    assert infer_vet_speaker([]) == (None, False)


def test_funciona_sin_acentos_ni_mayusculas():
    """La transcripción los pone de forma inconsistente: la inferencia no puede depender de ellos."""
    segs = [
        _seg(0, "HOLA DOCTOR, MI PERRO ESTA MAL"),
        _seg(1, "vamos a revisar, voy a palpar el abdomen y pedimos un hemograma"),
    ]
    vet, confiable = infer_vet_speaker(segs)
    assert confiable is True and vet == 1


def test_label_for_con_tres_hablantes_no_asume_titular():
    """Con más de dos voces (p.ej. dos dueños), sólo se afirma quién es el veterinario."""
    assert label_for(2, 0, 3) == "Hablante 3"
    assert label_for(0, 0, 3) == "Veterinario"


def test_label_for_sin_inferencia_no_etiqueta_roles():
    assert label_for(0, None, 2) == "Hablante 1"
    assert label_for(1, None, 2) == "Hablante 2"


def test_el_umbral_es_explicito():
    """MIN_MARGEN documenta la decisión: por debajo, la señal es ruido."""
    assert MIN_MARGEN >= 1.0
