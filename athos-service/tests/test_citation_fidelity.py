"""Fidelidad de citas: extracción de afirmaciones (determinística) y falla abierta del auditor."""
import pytest

import app.generation.citation_fidelity as cf
from app.generation.citation_fidelity import (
    EMPTY_REPORT, check_fidelity, drop_and_renumber, extract_claims, strip_markers)
from app.models import RetrievedChunk


def _lit(n: int = 4):
    return [RetrievedChunk(chunk_id=f"c{i}", doc_id=f"D{i}", content=f"contenido {i} " * 30)
            for i in range(1, n + 1)]


@pytest.fixture
def auditor_activo(monkeypatch):
    """El auditor viene APAGADO en producción por estar sin calibrar (ver config). Estos tests
    prueban su lógica, así que lo encienden explícitamente."""
    real = cf.get_settings

    def con_flag():
        s = real()
        return type("S", (), {"fidelity_enabled": True, "llm_light_model": s.llm_light_model})()

    monkeypatch.setattr(cf, "get_settings", con_flag)


# --- extract_claims: determinístico, sin LLM ---

def test_extrae_afirmacion_con_su_fuente():
    claims = extract_claims("El cuadro es compatible con babesiosis canina [2]. Fin.", 4)
    assert len(claims) == 1
    assert claims[0].sources == (2,)
    assert "[2]" not in claims[0].text and "babesiosis" in claims[0].text


def test_cita_multiple_conserva_todas_las_fuentes():
    claims = extract_claims("La anemia hemolítica es un hallazgo constante [1][3], y grave.", 4)
    assert claims[0].sources == (1, 3)


def test_cita_con_comas_dentro_del_corchete():
    claims = extract_claims("Perros con obstrucción presentan este cuadro [1, 3, 4].", 4)
    assert claims[0].sources == (1, 3, 4)


def test_ignora_oraciones_sin_cita():
    """Una afirmación sin cita no finge respaldo: no hay nada que auditar."""
    claims = extract_claims("Hola colega, buen día. El cuadro es sugestivo de anemia [1].", 4)
    assert len(claims) == 1 and claims[0].sources == (1,)


def test_ignora_fuentes_fuera_de_rango():
    """Un [9] cuando sólo hay 4 fuentes no se audita: verify_citations ya lo descarta."""
    assert extract_claims("afirmación clínica suficientemente larga para auditar [9].", 4) == []


def test_ignora_fragmentos_sin_contenido():
    assert extract_claims("Sí [1]. Ok [2].", 4) == []


def test_no_duplica_la_misma_fuente_en_una_afirmacion():
    claims = extract_claims("La fiebre es constante [2] y la anemia también [2].", 4)
    assert claims[0].sources == (2,)


# --- check_fidelity: falla abierta y contrato ---

def test_encendido_por_defecto(monkeypatch):
    """Tras calibrarlo (descarta 18%, ninguna respuesta queda sin fuentes) viene encendido."""
    from app.config import get_settings
    assert get_settings().fidelity_enabled is True


def test_falla_abierta_si_el_llm_revienta(auditor_activo, monkeypatch):
    """Ante cualquier error el reporte queda sin veredicto: las citas se conservan."""
    class Boom:
        def __init__(self, *a, **k):
            pass

        def complete(self, *a, **k):
            raise RuntimeError("proveedor caído")

    monkeypatch.setattr(cf, "LLMClient", Boom)
    rep = check_fidelity("Compatible con babesiosis canina, un hemoparásito [1].", _lit())
    assert rep.judged is False and rep.unfaithful == frozenset()


def test_falla_abierta_si_el_json_es_ilegible(auditor_activo, monkeypatch):
    class Basura:
        def __init__(self, *a, **k):
            pass

        def complete(self, *a, **k):
            return "no soy json"

    monkeypatch.setattr(cf, "LLMClient", Basura)
    rep = check_fidelity("Compatible con babesiosis canina, un hemoparásito [1].", _lit())
    assert rep.judged is False


def test_sin_citas_no_llama_al_llm(auditor_activo, monkeypatch):
    """Una respuesta sin citas no gasta una llamada: se resuelve determinísticamente."""
    def no_llamar(*a, **k):
        raise AssertionError("no debería llamar al LLM")

    monkeypatch.setattr(cf, "LLMClient", no_llamar)
    rep = check_fidelity("No hay evidencia suficiente para responder.", _lit())
    assert rep.judged is True and rep.unfaithful == frozenset()


def test_marca_solo_la_fuente_que_nunca_sostuvo_nada(auditor_activo, monkeypatch):
    """Si [1] sostiene una afirmación y falla en otra, NO es infiel: sólo cae la que nunca sirvió."""
    class Juez:
        def __init__(self, *a, **k):
            pass

        def complete(self, *a, **k):
            return ('{"veredictos": [{"n": 1, "sostiene": true}, '
                    '{"n": 2, "sostiene": false}]}')

    monkeypatch.setattr(cf, "LLMClient", Juez)
    answer = ("La anemia hemolítica es un hallazgo constante en babesiosis [1]. "
              "La respuesta a la doxiciclina suele ser rápida en 24 horas [1][3].")
    rep = check_fidelity(answer, _lit())
    assert rep.judged is True
    assert 1 not in rep.unfaithful        # sostuvo la primera afirmación
    assert 3 in rep.unfaithful            # sólo apareció en la que no sostiene


def test_rescata_veredictos_de_un_json_truncado(auditor_activo, monkeypatch):
    """Con 12 afirmaciones el JSON se truncaba y se perdía la auditoría ENTERA de la respuesta.
    Ahora se rescatan los veredictos que quedaron completos."""
    class Truncado:
        def __init__(self, *a, **k):
            pass

        def complete(self, *a, **k):
            # se corta a mitad del tercer veredicto, sin cerrar el objeto
            return ('{"veredictos": [{"n": 1, "sostiene": true}, {"n": 2, "sostiene": false}, '
                    '{"n": 3, "sost')

    monkeypatch.setattr(cf, "LLMClient", Truncado)
    answer = ("La anemia hemolítica es un hallazgo constante en la babesiosis canina [1]. "
              "La respuesta al tratamiento suele darse en 24 horas según la literatura [3]. "
              "El pronóstico a largo plazo es reservado en casos crónicos [4].")
    rep = check_fidelity(answer, _lit())
    assert rep.judged is True          # no se pierde la auditoría por el truncamiento
    assert 3 in rep.unfaithful         # el veredicto negativo rescatado se aplicó
    assert 1 not in rep.unfaithful     # el positivo también se respetó


def test_ignora_veredictos_con_forma_invalida(auditor_activo, monkeypatch):
    class Raro:
        def __init__(self, *a, **k):
            pass

        def complete(self, *a, **k):
            return '{"veredictos": [{"n": "x", "sostiene": "quizas"}, {"n": 2, "sostiene": false}]}'

    monkeypatch.setattr(cf, "LLMClient", Raro)
    answer = ("La anemia hemolítica es un hallazgo constante en la babesiosis [1]. "
              "La respuesta al tratamiento es rápida en casi todos los casos [3].")
    rep = check_fidelity(answer, _lit())
    assert rep.judged is True and 3 in rep.unfaithful


# --- strip_markers: coherencia entre el texto y la lista de referencias ---

def test_quita_el_marcador_de_la_fuente_descartada():
    """Si la fuente cae de las referencias, su [n] no puede quedarse en el texto: el vet vería una
    cita que no puede abrir."""
    t = "La anemia es constante [1]. La respuesta es rápida en 24h [3]."
    assert strip_markers(t, {3}) == "La anemia es constante [1]. La respuesta es rápida en 24h."


def test_conserva_las_fuentes_que_siguen_validas_en_una_cita_multiple():
    t = "Perros con obstrucción presentan este cuadro [1][3][4]."
    assert strip_markers(t, {3}) == "Perros con obstrucción presentan este cuadro [1][4]."


def test_cita_multiple_con_comas():
    t = "Este cuadro se ha descrito [1, 3, 4] en la literatura."
    assert strip_markers(t, {1, 4}) == "Este cuadro se ha descrito [3] en la literatura."


def test_no_toca_nada_si_no_hay_descartes():
    t = "La anemia hemolítica es constante [1][2]."
    assert strip_markers(t, set()) == t
    assert strip_markers(t, frozenset()) == t


def test_limpia_el_espacio_que_queda_antes_de_la_puntuacion():
    assert strip_markers("es sugestivo de babesiosis [2] .", {2}) == "es sugestivo de babesiosis."


def test_texto_vacio():
    assert strip_markers("", {1}) == ""
    assert strip_markers(None, {1}) == ""


# --- drop_and_renumber: el Fantasma numera por posición en la lista de citas ---

def test_renumera_sin_huecos_al_caer_una_cita():
    """Si cae la 2 de 5, las siguientes se corren: [3]->[2], [4]->[3], [5]->[4]."""
    t = "Uno [1]. Dos [2]. Tres [3]. Cuatro [4]. Cinco [5]."
    assert drop_and_renumber(t, {2}, 5) == "Uno [1]. Dos. Tres [2]. Cuatro [3]. Cinco [4]."


def test_renumera_con_varias_caidas():
    t = "A [1] B [2] C [3] D [4]"
    assert drop_and_renumber(t, {1, 3}, 4) == "A B [1] C D [2]"


def test_renumera_cita_multiple():
    t = "Se ha descrito [1][2][3] en perros."
    assert drop_and_renumber(t, {2}, 3) == "Se ha descrito [1][2] en perros."


def test_renumerar_sin_descartes_no_cambia_nada():
    t = "Uno [1]. Dos [2]."
    assert drop_and_renumber(t, set(), 2) == t


def test_el_flag_lo_apaga(auditor_activo, monkeypatch):
    """Con el auditor encendido por el fixture, volver a apagarlo debe cortocircuitar."""
    monkeypatch.setattr(cf, "get_settings", lambda: type("S", (), {
        "fidelity_enabled": False, "llm_light_model": "x"})())
    assert check_fidelity("algo compatible con lo que sea [1].", _lit()) is EMPTY_REPORT
