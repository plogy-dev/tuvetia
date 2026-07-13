"""Cascada determinística (sin LLM): filtros, léxico+glosario, umbral."""
import pytest


@pytest.mark.skip(reason="implementar tras app/retrieval/cascade.py")
def test_especie_es_preferencia_no_exclusion(sample_chunks):
    """Para un gato, el chunk felino debe rankear por encima del de ave, sin excluir 'mixto'."""
    ...


@pytest.mark.skip(reason="implementar tras app/retrieval/cascade.py")
def test_umbral_se_abstiene_sin_evidencia(sample_chunks):
    """Si el mejor score no supera el umbral, passes_threshold debe ser False."""
    ...
