"""Verificación de citas: solo sobreviven las que mapean a un chunk recuperado."""
import pytest


@pytest.mark.skip(reason="implementar tras app/generation/citations.py")
def test_descarta_cita_inventada(sample_chunks):
    """Una cita a un chunk_id inexistente debe descartarse."""
    ...
