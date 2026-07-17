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
