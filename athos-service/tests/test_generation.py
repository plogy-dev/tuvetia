"""B->A (generación): armado de prompt y parseo/verificación de citas. Sin LLM (mockeado)."""
import json

import app.generation.generate as gen
import app.generation.provider_cascade as pc
from app.generation.generate import build_note_prompt, parse_note_response, generate_note
from app.models import PatientContext, RetrievedChunk


def _patient():
    return PatientContext(patient_id="luna", species="perro", weight_kg=12.0, age_years=4.0,
                          severe_allergies=["pollo"])


def test_build_note_prompt_incluye_contexto(sample_chunks):
    system, user = build_note_prompt("el perro vomita", sample_chunks, _patient(), ["pollo"])
    assert "JSON" in system                      # instruye salida estructurada
    assert "el perro vomita" in user             # transcripción
    assert "perro" in user and "pollo" in user   # ficha + alergia severa
    assert "c1" in user and "c2" in user          # chunk_id de la literatura


# ── El cuaderno del veterinario (migración 0058) ────────────────────────────────────────────────

def test_sin_cuaderno_el_prompt_es_EL_MISMO_de_antes(sample_chunks):
    """Una consulta sin cuaderno tiene que armar el prompt idéntico al de siempre.

    Es lo que hace que las mediciones ya tomadas del Fantasma sigan siendo comparables: si el
    prompt cambiara para todos, el banco de calidad estaría midiendo otra cosa.
    """
    _, con_defecto = build_note_prompt("el perro vomita", sample_chunks, _patient(), ["pollo"])
    _, vacio = build_note_prompt("el perro vomita", sample_chunks, _patient(), ["pollo"],
                                 notebook="")
    _, blancos = build_note_prompt("el perro vomita", sample_chunks, _patient(), ["pollo"],
                                   notebook="   \n  ")
    assert con_defecto == vacio == blancos
    assert "NOTAS DEL VETERINARIO" not in con_defecto


def test_el_cuaderno_entra_en_su_propia_seccion(sample_chunks):
    _, user = build_note_prompt("el perro vomita", sample_chunks, _patient(), ["pollo"],
                                notebook="Peso real 12,4 kg. Pedir hemograma.")
    assert "NOTAS DEL VETERINARIO" in user
    assert "Pedir hemograma" in user
    # Y NO se mezcla con lo hablado: son dos secciones distintas, porque una la dictó el criterio
    # del vet y la otra el micrófono.
    assert user.index("NOTAS DEL VETERINARIO") < user.index("TRANSCRIPCIÓN DE LA CONSULTA")


def test_el_cuaderno_prima_sobre_lo_hablado_y_el_prompt_lo_dice(sample_chunks):
    """Un peso anotado a mano es una medición; el mismo peso dicho al pasar puede ser un estimado."""
    _, user = build_note_prompt("pesa como doce kilos", sample_chunks, _patient(), ["pollo"],
                                notebook="Peso real 12,4 kg")
    assert "PRIMAN" in user


def test_parse_descarta_citas_inventadas(sample_chunks):
    text = json.dumps({
        "soap": {"subjective": "s", "objective": "o", "assessment": "a", "plan": "p"},
        "citations": [{"chunk_id": "c1", "doc_id": "PM16485488"},
                      {"chunk_id": "cX", "doc_id": "INVENTADO"}],
        "allergy_transcript_flag": True,
    })
    soap, cites, flag = parse_note_response(text, sample_chunks)
    assert soap.assessment == "a"
    assert [c.chunk_id for c in cites] == ["c1"]   # cX (no recuperado) se descarta
    assert flag is True


def test_parse_tolera_fences_y_texto(sample_chunks):
    text = "Claro, aquí va:\n```json\n" + json.dumps({
        "soap": {"assessment": "compatible con X"}, "citations": [], "allergy_transcript_flag": False,
    }) + "\n```"
    soap, cites, flag = parse_note_response(text, sample_chunks)
    assert soap.assessment == "compatible con X"
    assert cites == []
    assert flag is False


def test_generate_note_con_llm_mockeado(monkeypatch, sample_chunks):
    canned = json.dumps({
        "soap": {"subjective": "vómito agudo", "objective": "", "assessment": "compatible con Y",
                 "plan": "observación"},
        "citations": [{"chunk_id": "c1", "doc_id": "PM16485488", "locator": "The Study",
                       "source": "PubMed"}],
        "allergy_transcript_flag": False,
    })
    monkeypatch.setattr(pc.LLMClient, "complete",
                        lambda self, system, user, max_tokens=2000: canned)
    soap, cites, flag = generate_note("el perro vomita", sample_chunks, _patient(), ["pollo"])
    assert soap.subjective == "vómito agudo"
    assert [c.chunk_id for c in cites] == ["c1"]
    assert flag is False


def test_generate_note_backstop_rescata_flag_que_el_modelo_pierde(monkeypatch, sample_chunks):
    """Backstop: aunque el modelo devuelva allergy_transcript_flag=False, si la transcripción
    menciona una alergia (sin fila en `allergies`), generate_note lo marca True (determinístico)."""
    canned = json.dumps({
        "soap": {"assessment": "compatible con gastroenteritis aguda"},
        "citations": [], "allergy_transcript_flag": False,   # el modelo la pierde (flaky)
    })
    monkeypatch.setattr(pc.LLMClient, "complete",
                        lambda self, system, user, max_tokens=2000: canned)
    transcript = "vomito y diarrea; ojo: alergia severa a la penicilina, evitar betalactamicos"
    _, _, flag = generate_note(transcript, sample_chunks, _patient(), [])
    assert flag is True


def test_generate_note_reintenta_cuando_el_modelo_devuelve_basura(monkeypatch, sample_chunks):
    """El fallo es transitorio: si el primer intento sale ilegible, el segundo salva la nota.

    Medido el 2026-07-29: 1 de 16 transcripciones devolvio una nota vacia, y la misma transcripcion
    genero bien en los dos reintentos siguientes.
    """
    buena = json.dumps({
        "soap": {"subjective": "vomito agudo", "assessment": "compatible con Y", "plan": "observar"},
        "citations": [], "allergy_transcript_flag": False,
    })
    respuestas = iter(["lo siento, no puedo", buena])

    monkeypatch.setattr(pc.LLMClient, "complete",
                        lambda self, system, user, max_tokens=2000: next(respuestas))
    soap, _cites, _flag = generate_note("el perro vomita", sample_chunks, _patient(), [])
    assert soap.assessment == "compatible con Y"


def test_generate_note_no_devuelve_nota_vacia_en_silencio(monkeypatch, sample_chunks):
    """La regresion que importa: una respuesta ilegible NO puede volverse una nota en blanco.

    Sin esto, `_extract_json` devuelve {}, el SOAP sale con los cuatro campos vacios y el Fantasma
    inserta la nota en la historia clinica con status='draft'. El veterinario abre la consulta y
    encuentra un borrador en blanco que no distingue entre "Athos fallo" y "no habia nada que decir".
    """
    monkeypatch.setattr(pc.LLMClient, "complete",
                        lambda self, system, user, max_tokens=2000: "no es JSON ni lo sera")
    try:
        generate_note("el perro vomita", sample_chunks, _patient(), [])
    except gen.EmptyNoteError:
        pass
    else:
        raise AssertionError("una respuesta ilegible produjo una nota sin levantar EmptyNoteError")


def test_generate_note_acepta_system_prompt_alternativo(monkeypatch, sample_chunks):
    """El seam del A/B de prompts (`scripts/calidad/phantom_ab.py`) tiene que llegar al modelo."""
    vistos = []
    canned = json.dumps({"soap": {"assessment": "a"}, "citations": [],
                         "allergy_transcript_flag": False})

    def fake(self, system, user, max_tokens=2000):
        vistos.append(system)
        return canned

    monkeypatch.setattr(pc.LLMClient, "complete", fake)
    generate_note("x", sample_chunks, _patient(), [], system_prompt="PROMPT DE PRUEBA")
    assert vistos == ["PROMPT DE PRUEBA"]


def test_el_subjetivo_no_conserva_chunk_id_crudos():
    """Un UUID crudo visible en la S es basura ilegible en la historia clinica.

    El subjetivo no deberia citar literatura —es el relato del dueno— pero el modelo lo hace igual, y
    quedaba fuera del renumerado. Medido el 2026-07-29: una nota llego con el chunk_id completo
    escrito en la S. El que mapea a una cita se vuelve [1]; el que no existe en la literatura se borra.
    """
    presente = "2fa4dac8-2a34-4d03-85d7-f44f93780c34"
    fantasma = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    chunks = [RetrievedChunk(chunk_id=presente, doc_id="PM1", content="x", locator="L",
                             source="PubMed", score=0.9, metadata={"is_current": True})]
    text = json.dumps({
        "soap": {"subjective": f"El dueno refiere vomitos desde el martes [{presente}] "
                               f"y decaimiento [{fantasma}].",
                 "objective": "", "assessment": "compatible con Y", "plan": "observar"},
        "citations": [{"chunk_id": presente, "doc_id": "PM1"}],
        "allergy_transcript_flag": False,
    })
    soap, _cites, _flag = parse_note_response(text, chunks)
    assert presente not in soap.subjective        # el UUID crudo no sobrevive
    assert fantasma not in soap.subjective        # el que no existe se borra, no se deja escrito
    assert "[1]" in soap.subjective               # el que si mapea queda como cita legible
