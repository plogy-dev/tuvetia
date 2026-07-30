"""B->A (generación): armado de prompt y parseo/verificación de citas. Sin LLM (mockeado)."""
import json

import app.generation.generate as gen
from app.generation.generate import build_note_prompt, parse_note_response, generate_note
from app.models import PatientContext


def _patient():
    return PatientContext(patient_id="luna", species="perro", weight_kg=12.0, age_years=4.0,
                          severe_allergies=["pollo"])


def test_build_note_prompt_incluye_contexto(sample_chunks):
    system, user = build_note_prompt("el perro vomita", sample_chunks, _patient(), ["pollo"])
    assert "JSON" in system                      # instruye salida estructurada
    assert "el perro vomita" in user             # transcripción
    assert "perro" in user and "pollo" in user   # ficha + alergia severa
    assert "c1" in user and "c2" in user          # chunk_id de la literatura


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
    monkeypatch.setattr(gen.LLMClient, "complete",
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
    monkeypatch.setattr(gen.LLMClient, "complete",
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

    monkeypatch.setattr(gen.LLMClient, "complete",
                        lambda self, system, user, max_tokens=2000: next(respuestas))
    soap, _cites, _flag = generate_note("el perro vomita", sample_chunks, _patient(), [])
    assert soap.assessment == "compatible con Y"


def test_generate_note_no_devuelve_nota_vacia_en_silencio(monkeypatch, sample_chunks):
    """La regresion que importa: una respuesta ilegible NO puede volverse una nota en blanco.

    Sin esto, `_extract_json` devuelve {}, el SOAP sale con los cuatro campos vacios y el Fantasma
    inserta la nota en la historia clinica con status='draft'. El veterinario abre la consulta y
    encuentra un borrador en blanco que no distingue entre "Athos fallo" y "no habia nada que decir".
    """
    monkeypatch.setattr(gen.LLMClient, "complete",
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

    monkeypatch.setattr(gen.LLMClient, "complete", fake)
    generate_note("x", sample_chunks, _patient(), [], system_prompt="PROMPT DE PRUEBA")
    assert vistos == ["PROMPT DE PRUEBA"]
