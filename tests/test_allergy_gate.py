"""Gate de alergia severa: determinístico, caso Luna."""
from app.generation.allergy_gate import gate_triggered, evaluate_gate


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
