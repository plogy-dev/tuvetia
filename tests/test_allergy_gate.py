"""Gate de alergia severa: determinístico, caso Luna."""
import pytest


@pytest.mark.skip(reason="implementar con DB de test sembrada (allergies)")
def test_luna_alergia_pollo_dispara_gate(two_clinics):
    """severe_allergies(clinic, 'luna') debe devolver ['pollo'] y marcar el gate antes del plan."""
    ...
