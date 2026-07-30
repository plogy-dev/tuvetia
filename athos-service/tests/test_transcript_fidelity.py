"""Fidelidad de la NOTA contra el TRANSCRIPT: parseo determinístico + falla abierta. Sin LLM real."""
import json

import app.generation.transcript_fidelity as tf
from app.generation.transcript_fidelity import (
    check_note_fidelity,
    extract_note_claims,
)

TRANSCRIPT = ("Dueño: hace tres días no come bien. Veterinario: al palpar el abdomen está tenso. "
              "Le tomo la temperatura: 39,5.")


def _fake_llm(monkeypatch, respuesta):
    class Fake:
        def __init__(self, *a, **k):
            pass

        def complete(self, *a, **k):
            return respuesta

    monkeypatch.setattr(tf, "LLMClient", Fake)


def test_extract_separa_por_seccion_y_descarta_fragmentos():
    claims = extract_note_claims(
        "El dueño refiere que hace tres días el paciente no come bien.",
        "O:\nAbdomen tenso a la palpación, dolor difuso. Temperatura de 39,5 grados centígrados.",
    )
    assert [c.section for c in claims] == ["S", "O", "O"]
    assert "O:" not in claims[0].text          # "O:" solo no llega a MIN_CHARS: no es auditable
    assert all(len(c.text) >= tf.MIN_CHARS for c in claims)


def test_extract_limpia_vinetas_y_marcadores_de_cita():
    claims = extract_note_claims("", "1. Abdomen tenso a la palpación [2], dolor difuso presente.")
    assert len(claims) == 1
    assert claims[0].text.startswith("Abdomen tenso")
    assert "[2]" not in claims[0].text


def test_el_prompt_lleva_el_transcript_y_las_afirmaciones_de_S_y_O(monkeypatch):
    """Sólo S y O llegan al auditor. El assessment interpreta y el plan propone: inventar ahí es otro
    problema, y lo cubre `citation_fidelity` contra la literatura. Se verifica sobre el prompt real
    para que no sea una promesa del nombre del test."""
    vistos = {}

    class Fake:
        def __init__(self, *a, **k):
            pass

        def complete(self, system, user, **k):
            vistos["user"] = user
            return json.dumps({"veredictos": [{"n": 1, "sostiene": True}]})

    monkeypatch.setattr(tf, "LLMClient", Fake)
    check_note_fidelity("El dueño refiere que no come bien hace tres días ya.",
                        "Abdomen tenso a la palpación, con dolor difuso al examen.", TRANSCRIPT)
    assert "al palpar el abdomen está tenso" in vistos["user"]   # el transcript va completo
    assert "sección S" in vistos["user"] and "sección O" in vistos["user"]
    assert "no come bien hace tres días" in vistos["user"]


def test_senala_la_afirmacion_que_el_transcript_no_respalda(monkeypatch):
    _fake_llm(monkeypatch, json.dumps({"veredictos": [
        {"n": 1, "sostiene": True}, {"n": 2, "sostiene": False}]}))
    rep = check_note_fidelity(
        "El dueño refiere que hace tres días el paciente no come bien.",
        "Reflejo pupilar dentro de parámetros normales, sin alteraciones.",
        TRANSCRIPT,
    )
    assert rep.judged is True
    assert len(rep.unsupported) == 1
    assert rep.unsupported[0].section == "O"
    assert "Reflejo pupilar" in rep.unsupported[0].text
    assert rep.as_payload() == [{"section": "O", "text": rep.unsupported[0].text}]


def test_nota_limpia_no_senala_nada(monkeypatch):
    _fake_llm(monkeypatch, json.dumps({"veredictos": [{"n": 1, "sostiene": True}]}))
    rep = check_note_fidelity("El dueño refiere que el paciente no come bien hace tres días.", "",
                              TRANSCRIPT)
    assert rep.judged is True
    assert rep.unsupported == ()


def test_falla_abierta_si_el_auditor_revienta(monkeypatch):
    """El auditor es control de calidad, no un punto de falla: la nota sale sin señalamientos."""
    class Boom:
        def __init__(self, *a, **k):
            pass

        def complete(self, *a, **k):
            raise RuntimeError("timeout del proveedor")

    monkeypatch.setattr(tf, "LLMClient", Boom)
    rep = check_note_fidelity("El dueño refiere que no come bien hace tres días ya.", "", TRANSCRIPT)
    assert rep.judged is False        # no se verificó, y lo dice
    assert rep.unsupported == ()


def test_json_ilegible_no_finge_una_revision_que_no_ocurrio(monkeypatch):
    """La regresión que ya se cometió con el auditor de citas: devolver `judged=True` sin veredictos
    afirma "revisado, todo bien" cuando nadie revisó nada. Tiene que caer a judged=False."""
    _fake_llm(monkeypatch, "no es JSON ni lo será")
    rep = check_note_fidelity("El dueño refiere que no come bien desde hace tres días.", "",
                              TRANSCRIPT)
    assert rep.judged is False
    assert rep.unsupported == ()


def test_rescata_veredictos_de_un_json_truncado(monkeypatch):
    """Perder los últimos veredictos degrada la auditoría; perder TODOS por una coma la anula."""
    _fake_llm(monkeypatch,
              '{"veredictos": [{"n": 1, "sostiene": false}, {"n": 2, "sostiene": tru')
    rep = check_note_fidelity("El dueño refiere que hace tres días no come bien nada.",
                              "Abdomen tenso a la palpación, con dolor difuso.", TRANSCRIPT)
    assert rep.judged is True
    assert len(rep.unsupported) == 1
    assert rep.unsupported[0].section == "S"


def test_sin_transcript_no_hay_auditoria_posible(monkeypatch):
    """La nota puede armarse desde el motivo de consulta cuando no hay transcripción: no es un fallo,
    pero tampoco hay nada contra qué comparar. No debe llamar al LLM."""
    def no_llamar(*a, **k):
        raise AssertionError("no debe llamar al modelo sin transcripción")

    monkeypatch.setattr(tf, "LLMClient", no_llamar)
    rep = check_note_fidelity("Algo que la nota afirma con largo suficiente para auditarse.", "", "  ")
    assert rep.judged is False
    assert rep.unsupported == ()


def test_interruptor_apaga_el_auditor(monkeypatch):
    def no_llamar(*a, **k):
        raise AssertionError("no debe llamar al modelo con el auditor apagado")

    monkeypatch.setattr(tf, "LLMClient", no_llamar)
    s = tf.get_settings()
    object.__setattr__(s, "transcript_fidelity_enabled", False)
    try:
        rep = check_note_fidelity("Una afirmación con largo suficiente para ser auditada acá.", "",
                                  TRANSCRIPT)
        assert rep.judged is False
        assert rep.unsupported == ()
    finally:
        object.__setattr__(s, "transcript_fidelity_enabled", True)
