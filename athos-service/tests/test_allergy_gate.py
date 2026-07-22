"""Gate de alergia severa: determinístico, caso Luna."""
import pytest

from app.generation.allergy_gate import (
    gate_triggered,
    evaluate_gate,
    transcript_mentions_allergy,
)


def test_luna_alergia_severa_dispara_gate(luna_patient):
    """Con una alergia severa conocida (pollo), el gate se dispara antes del plan."""
    assert luna_patient.severe_allergies == ["pollo"]
    assert gate_triggered(luna_patient.severe_allergies) is True


def test_sin_alergias_no_dispara():
    assert gate_triggered([]) is False


def test_gate_desde_db_aislado(seeded_tenants):
    """evaluate_gate lee `allergies` por clinic_id explícito; la clínica ajena no dispara."""
    a, b, luna = seeded_tenants["clinic_a"], seeded_tenants["clinic_b"], seeded_tenants["luna"]
    triggered, severe = evaluate_gate(a, luna)
    assert triggered is True
    assert severe == ["pollo"]
    triggered_b, severe_b = evaluate_gate(b, luna)   # cross-tenant: no ve la alergia
    assert triggered_b is False
    assert severe_b == []


# --- Backstop determinístico del allergy_transcript_flag (transcript_mentions_allergy) ---

@pytest.mark.parametrize("texto", [
    "el paciente tiene alergia severa a la penicilina, evitar betalactamicos",  # el caso del golden
    "Dueno: es alergico a los mariscos",
    "presenta hipersensibilidad a la amoxicilina",
    "antecedente de anafilaxia por picadura",
    "known allergy to penicillin",                                              # EN
    "sin alergias alimentarias pero alergico a la penicilina",                  # negada + afirmativa
])
def test_menciona_alergia_afirmativa(texto):
    """Una mención afirmativa (aunque conviva con una negada) marca el flag."""
    assert transcript_mentions_allergy(texto) is True


@pytest.mark.parametrize("texto", [
    "sin alergias conocidas",
    "no tiene alergias",
    "no refiere alergias medicamentosas",
    "niega alergias",
    "ninguna alergia conocida",
    "sin antecedentes de alergia",
    "el perro vomita desde hace dos dias y tiene diarrea liquida",              # sin mención
    "",
])
def test_no_marca_negaciones_ni_ausencia(texto):
    """Las negaciones frecuentes y la ausencia de mención NO marcan (evita falsos positivos)."""
    assert transcript_mentions_allergy(texto) is False
