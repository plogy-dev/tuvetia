"""Gate de dosis: determinístico, sin LLM ni DB. Regla no negociable nº4."""
from app.generation.dose_guard import (
    REDACTED, has_dose, patient_data_complete, redact_doses, split_safe_tail)


def test_detecta_las_formas_reales_que_escribio_el_modelo():
    """Casos textuales tomados del banco de respuestas contra producción (2026-07-29)."""
    reales = [
        "doxiciclina (5-10 mg/kg PO c/12-24h por 14-28 días)",
        "dosis única a 5-6.6 mg/kg IM o SC",
        "un ácido graso omega-3 (DHA/EPA) a dosis antiinflamatoria (20-30 mg/kg/día)",
        "pimobendan en dosis de 0.25 mg/kg c/12h",
        "dexametasona a una dosis baja (0.1-0.2 mg/kg)",
        "Ringer Lactato por ejemplo) a 20-30 ml/kg en bolo",
        "doxiciclina 10 mg/kg PO c/12h",
        "La doxiciclina se dosifica a 10 mg/kg cada 24h",
        "5 mg/kg cada 12 horas VO",
    ]
    for t in reales:
        assert has_dose(t), t
        limpio, redactado = redact_doses(t)
        assert redactado and REDACTED in limpio and "mg/kg" not in limpio


def test_variantes_de_formato():
    for t in ("0,25 mg / kg", "10 mcg/kg/min", "2 UI/kg", "5 a 10 mg/kg", "1.5 g/kg"):
        assert has_dose(t), t


def test_no_toca_lo_que_no_es_dosis_por_peso():
    """Concentraciones, pesos y cifras clínicas NO son dosis: taparlas sería censurar información."""
    for t in ("plaquetas < 20.000/µL", "pesa 12 kg", "fiebre de 39,8 °C",
              "hematocrito 25%", "solución al 0,9%", "SpO2 < 95%"):
        assert not has_dose(t), t
        assert redact_doses(t) == (t, False)


def test_conserva_el_farmaco_y_la_via():
    """Se tapa el número, no la frase: fármaco, vía y frecuencia siguen siendo útiles."""
    limpio, _ = redact_doses("Doxiciclina 10 mg/kg PO cada 12 horas durante 21 días")
    assert limpio.startswith("Doxiciclina ")
    assert "PO cada 12 horas durante 21 días" in limpio


def test_patient_data_complete_exige_los_tres():
    assert patient_data_complete("perro", 12.0, 3.0)
    assert not patient_data_complete(None, 12.0, 3.0)
    assert not patient_data_complete("perro", None, 3.0)
    assert not patient_data_complete("perro", 12.0, None)
    assert not patient_data_complete("", 12.0, 3.0)


# --- Streaming: ninguna cifra puede emitirse a medias ---

def test_split_safe_tail_retiene_el_final():
    emitible, cola = split_safe_tail("palabra " * 20)
    assert emitible + cola == "palabra " * 20
    assert len(cola) >= 48 - 8      # la cola retenida cubre el patrón más largo


def test_split_safe_tail_no_emite_buffers_cortos():
    assert split_safe_tail("doxiciclina 10 mg") == ("", "doxiciclina 10 mg")


def test_la_dosis_partida_entre_tokens_no_se_escapa():
    """El caso que motiva el colchón: '10 mg' y '/kg' llegan en tokens distintos."""
    tokens = ["Doxi", "ciclina ", "10", " mg", "/kg", " PO cada 12 horas. ", "Fin " * 30]
    buffer, emitido = "", ""
    for t in tokens:
        buffer += t
        listo, buffer = split_safe_tail(buffer)
        limpio, _ = redact_doses(listo)
        emitido += limpio
    limpio_final, _ = redact_doses(buffer)
    emitido += limpio_final
    assert "mg/kg" not in emitido
    assert REDACTED in emitido
