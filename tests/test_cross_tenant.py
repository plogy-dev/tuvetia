"""Aislamiento por clínica: un usuario de B no puede ver/escribir filas de A.

Cubre athos_messages, rag_retrieval_log, rag_answer_log, patient_embeddings.
Requiere DB de test con RLS y 2 clínicas sembradas.
"""
import pytest


@pytest.mark.skip(reason="implementar con DB de test + JWT por clínica")
def test_usuario_b_no_ve_datos_de_a(two_clinics):
    ...
