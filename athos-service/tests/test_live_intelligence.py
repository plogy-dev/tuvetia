"""Notas y sugerencias durante la consulta.

LO QUE ESTOS TESTS PROTEGEN son las reglas duras del producto en un camino nuevo. La inteligencia en
vivo es la superficie donde más presión hay para saltárselas: el veterinario está por decidir, con
el animal delante, y una sugerencia con una cifra de dosis se lee como una indicación.

La regla 4 dice que sin especie, peso Y edad no sale ninguna cifra por peso — y está medido que el
prompt NO alcanza para cumplirla: pedirle al modelo que sea resolutivo lo empuja a dosificar (2/23
-> 9/23). Quien la impone es `dose_guard` sobre el texto. Acá se verifica que en vivo también corra.
"""
import pytest

import app.live_intelligence as vivo
from app.live_intelligence import (
    MAX_TRANSCRIPT_CHARS, SIN_MATERIAL, analizar, build_live_prompt)
from app.models import PatientContext

COMPLETO = PatientContext(patient_id="p-1", species="Gato", weight_kg=4.2, age_years=3.0)
SIN_PESO = PatientContext(patient_id="p-1", species="Gato", age_years=3.0)
CON_ALERGIA = PatientContext(
    patient_id="p-1", species="Perro", weight_kg=12.0, age_years=5.0,
    severe_allergies=["penicilina"],
)

TRANSCRIPT = "Veterinario: ¿desde cuándo vomita? Titular: hace dos semanas, y ya casi no come."


@pytest.fixture
def responde(monkeypatch):
    """Sustituye al LLM por un texto fijo y devuelve lo que se le mandó."""
    visto = {}

    def _montar(texto: str):
        class FakeLLM:
            def __init__(self, *a, **k):
                visto["model"] = k.get("model")

            def complete(self, system, user, max_tokens=2000):
                visto["system"] = system
                visto["user"] = user
                return texto

        monkeypatch.setattr(vivo, "LLMClient", FakeLLM)
        return visto

    return _montar


# ── El prompt (puro: sin red ni base) ───────────────────────────────────────────────────────────

class TestPrompt:
    def test_lleva_la_transcripcion(self):
        p = build_live_prompt(TRANSCRIPT, None, None)
        assert "hace dos semanas" in p

    def test_sin_paciente_no_inventa_ficha(self):
        p = build_live_prompt(TRANSCRIPT, None, None)
        assert "PACIENTE:" not in p
        assert "ALERGIAS" not in p

    def test_con_paciente_lleva_la_ficha(self):
        p = build_live_prompt(TRANSCRIPT, COMPLETO, None)
        assert "especie: Gato" in p
        assert "peso: 4.2 kg" in p

    def test_los_datos_que_faltan_simplemente_no_aparecen(self):
        p = build_live_prompt(TRANSCRIPT, SIN_PESO, None)
        assert "especie: Gato" in p
        assert "peso:" not in p

    # El momento de saber que este paciente no tolera penicilina es ANTES de que el vet la elija.
    def test_las_alergias_severas_van_al_prompt(self):
        p = build_live_prompt(TRANSCRIPT, CON_ALERGIA, None)
        assert "penicilina" in p
        assert "bloqueantes" in p

    def test_el_motivo_declarado_entra_si_lo_hay(self):
        p = build_live_prompt(TRANSCRIPT, None, "vómito crónico")
        assert "vómito crónico" in p
        assert build_live_prompt(TRANSCRIPT, None, "   ").count("MOTIVO") == 0

    # En una consulta larga lo último es lo que el vet está resolviendo; el principio ya lo cubrieron
    # las notas anteriores.
    def test_de_un_transcript_largo_se_manda_la_COLA(self):
        largo = "x" * 500 + "ESTO ES EL FINAL"
        p = build_live_prompt("y" * (MAX_TRANSCRIPT_CHARS * 2) + largo, None, None)
        assert "ESTO ES EL FINAL" in p
        assert len(p) < MAX_TRANSCRIPT_CHARS + 500


# ── El guard de dosis, que es la regla que más importa acá ──────────────────────────────────────

class TestGuardDeDosis:
    def test_con_la_ficha_INCOMPLETA_no_sale_ninguna_cifra(self, responde):
        responde("- Considerar maropitant 1 mg/kg SC cada 24 h")
        r = analizar(TRANSCRIPT, "sugerencias", patient=SIN_PESO)

        assert r["dosis_redactadas"] is True
        assert "1 mg/kg" not in r["texto"]
        # El fármaco y la vía SÍ se conservan: son información clínica útil y verificable. Lo único
        # que se quita es el número que el sistema no puede sostener.
        assert "maropitant" in r["texto"]
        assert "faltan datos del paciente" in r["texto"]

    def test_sin_paciente_tampoco(self, responde):
        responde("- Considerar maropitant 1 mg/kg SC")
        r = analizar(TRANSCRIPT, "sugerencias", patient=None)
        assert r["dosis_redactadas"] is True
        assert "1 mg/kg" not in r["texto"]

    def test_con_la_ficha_completa_la_cifra_pasa(self, responde):
        responde("- Considerar maropitant 1 mg/kg SC cada 24 h")
        r = analizar(TRANSCRIPT, "sugerencias", patient=COMPLETO)
        assert r["dosis_redactadas"] is False
        assert "1 mg/kg" in r["texto"]

    def test_sin_dosis_en_el_texto_no_se_declara_redaccion(self, responde):
        responde("- Preguntar si hubo acceso a hilos o cuerdas")
        r = analizar(TRANSCRIPT, "notas", patient=SIN_PESO)
        assert r["dosis_redactadas"] is False


class TestAlergias:
    def test_viajan_en_la_respuesta_para_poder_pintarlas(self, responde):
        responde("- Revisar oídos")
        r = analizar(TRANSCRIPT, "sugerencias", patient=CON_ALERGIA)
        assert r["alergias_severas"] == ["penicilina"]

    def test_sin_paciente_la_lista_va_vacia_y_no_rompe(self, responde):
        responde("- Revisar oídos")
        r = analizar(TRANSCRIPT, "notas", patient=None)
        assert r["alergias_severas"] == []


class TestSinMaterial:
    def test_el_modelo_puede_decir_que_no_hay_nada(self, responde):
        responde(SIN_MATERIAL)
        r = analizar("eh… mmm", "notas")
        assert r["sin_material"] is True
        assert r["texto"] == ""

    def test_una_respuesta_vacia_es_lo_mismo(self, responde):
        responde("   ")
        assert analizar(TRANSCRIPT, "notas")["sin_material"] is True

    # NUNCA LANZA: esto corre cada pocas decenas de segundos mientras alguien atiende. Un proveedor
    # caído no puede tumbar el panel ni interrumpir la consulta.
    def test_si_el_proveedor_falla_no_lanza(self, monkeypatch):
        class Explota:
            def __init__(self, *a, **k):
                pass

            def complete(self, *a, **k):
                raise RuntimeError("proveedor caído")

        monkeypatch.setattr(vivo, "LLMClient", Explota)
        r = analizar(TRANSCRIPT, "sugerencias", patient=CON_ALERGIA)

        assert r["sin_material"] is True
        assert r["texto"] == ""
        # Y las alergias siguen viajando: es un dato de la base, no del modelo.
        assert r["alergias_severas"] == ["penicilina"]


class TestModos:
    def test_notas_y_sugerencias_usan_prompts_distintos(self, responde):
        visto = responde("- algo")
        analizar(TRANSCRIPT, "notas")
        de_notas = visto["system"]
        analizar(TRANSCRIPT, "sugerencias")
        de_sugerencias = visto["system"]
        assert de_notas != de_sugerencias

    # Las dos reglas que separan un cuaderno de una nota clínica, verificadas sobre el prompt real
    # y no sobre lo que el modelo devuelva: es lo único determinístico que se puede afirmar acá.
    def test_las_notas_no_pueden_concluir(self):
        assert "no lo que significa" in vivo.NOTAS_SYSTEM
        assert "Nada de diagnósticos" in vivo.NOTAS_SYSTEM

    def test_las_sugerencias_no_cierran_diagnostico_ni_dosifican(self):
        assert "NO diagnostiques" in vivo.SUGERENCIAS_SYSTEM
        assert "NO escribas cifras de dosis" in vivo.SUGERENCIAS_SYSTEM
        assert "A MEDIAS" in vivo.SUGERENCIAS_SYSTEM

    # El modelo LIVIANO, no el de redacción: esto corre decenas de veces por consulta.
    def test_usa_el_modelo_liviano(self, responde):
        visto = responde("- algo")
        analizar(TRANSCRIPT, "notas")
        from app.config import get_settings

        assert visto["model"] == get_settings().llm_light_model


# ── La luz del notch ────────────────────────────────────────────────────────────────────────────
#
# Del prototipo del cliente, texto literal de su pestaña de sugerencias: "las urgentes prenden la
# luz del notch". Es un buen mecanismo — avisa de algo que no puede esperar SIN abrir el panel solo
# encima de lo que el vet está haciendo.
#
# La marca la pone el modelo y la LEE EL CÓDIGO, que es la regla de la casa: el prompt pide, el
# sistema decide. Y se borra del texto antes de mostrarlo: un "URGENTE" suelto arriba de una lista
# grita sin decir cuál.

class TestUrgencia:
    def test_la_marca_enciende_la_luz_y_no_se_ve(self, responde):
        responde("URGENTE\n- Mucosas pálidas: descartar hemorragia antes de sedar")
        r = analizar(TRANSCRIPT, "sugerencias", patient=COMPLETO)

        assert r["urgente"] is True
        assert "URGENTE" not in r["texto"]
        assert "Mucosas pálidas" in r["texto"]

    def test_sin_marca_no_hay_luz(self, responde):
        responde("- Preguntar si hubo acceso a hilos o cuerdas")
        assert analizar(TRANSCRIPT, "sugerencias")["urgente"] is False

    # El separador que el modelo ponga entre la marca y la primera viñeta no puede quedar colgando.
    def test_limpia_lo_que_quede_entre_la_marca_y_el_texto(self, responde):
        for separador in ["\n- ", ": ", " — ", "\n"]:
            responde(f"URGENTE{separador}Revisar perfusión")
            r = analizar(TRANSCRIPT, "sugerencias")
            assert r["urgente"] is True
            assert r["texto"].startswith("Revisar perfusión"), r["texto"]

    def test_la_marca_sola_no_deja_sugerencia(self, responde):
        # Sin nada detrás no hay qué mostrar: se trata como "sin material", no como una urgencia
        # vacía que encienda la luz y no diga nada al abrirla.
        responde("URGENTE")
        r = analizar(TRANSCRIPT, "sugerencias")
        assert r["sin_material"] is True

    # Que el prompt la pida no alcanza; que se reserve de verdad es lo que la hace útil.
    def test_el_prompt_pide_reservarla(self):
        assert "URGENTE" in vivo.SUGERENCIAS_SYSTEM
        assert "si todo es urgente, nada lo es" in vivo.SUGERENCIAS_SYSTEM

    def test_las_notas_no_encienden_la_luz(self, responde):
        # Las notas son lo que SE DIJO. Nada de eso es una alarma, y el prompt no la ofrece.
        responde("- El titular refiere vómito desde hace dos semanas")
        assert analizar(TRANSCRIPT, "notas")["urgente"] is False

    def test_si_el_proveedor_falla_no_hay_luz(self, monkeypatch):
        class Explota:
            def __init__(self, *a, **k):
                pass

            def complete(self, *a, **k):
                raise RuntimeError("caído")

        monkeypatch.setattr(vivo, "LLMClient", Explota)
        assert analizar(TRANSCRIPT, "sugerencias")["urgente"] is False
