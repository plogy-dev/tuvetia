"""Gate de alergia severa: determinístico, caso Luna."""
import pytest

from app.generation.allergy_gate import gate_triggered


def test_luna_alergia_severa_dispara_gate(luna_patient):
    """Con una alergia severa conocida (pollo), el gate se dispara antes del plan."""
    assert luna_patient.severe_allergies == ["pollo"]
    assert gate_triggered(luna_patient.severe_allergies) is True


def test_sin_alergias_no_dispara():
    assert gate_triggered([]) is False


@pytest.mark.skip(reason="implementar con DB de test sembrada (allergies)")
def test_luna_alergia_pollo_dispara_gate(two_clinics):
    """severe_allergies(clinic, 'luna') debe devolver ['pollo'] y marcar el gate antes del plan."""
    ...
