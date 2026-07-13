"""A->B: la resolución por glosario NO usa IA."""
import pytest


@pytest.mark.skip(reason="implementar tras app/glossary/resolve.py")
def test_resolucion_es_a_conceptos(luna_patient):
    """'mi perro vomita' -> debe resolver el concepto canónico de vómito (EN) vía glosario."""
    ...
