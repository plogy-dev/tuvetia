"""Afirmaciones ejecutables sin cita y sin declarar. Determinístico, sin LLM."""
from app.generation.undeclared import find_undeclared


def _tipos(texto):
    return [x["tipo"] for x in find_undeclared(texto)]


def test_marca_un_farmaco_afirmado_sin_cita_ni_declaracion():
    t = "El fármaco de elección para este cuadro es la doxiciclina, iniciada de forma temprana."
    r = find_undeclared(t)
    assert len(r) == 1
    assert r[0]["tipo"] == "fármaco"
    assert "doxiciclina" in r[0]["texto"]


def test_no_marca_lo_que_esta_citado():
    """Con cita la audita `citation_fidelity`: verifica que el pasaje sostenga lo afirmado."""
    t = "El fármaco de elección para este cuadro es la doxiciclina, iniciada temprano [2]."
    assert find_undeclared(t) == []


def test_no_marca_lo_que_el_modelo_declaro_como_criterio_clinico():
    """Es exactamente lo que la regla 2 del prompt pide: si lo declara, cumplió."""
    t = ("Criterio clínico (no está en la literatura recuperada): el fármaco de elección para este "
         "cuadro es la doxiciclina, iniciada de forma temprana.")
    assert find_undeclared(t) == []


def test_la_declaracion_encabeza_el_bloque_y_alcanza_a_lo_que_sigue():
    """El modelo escribe la marca una vez y despues enumera. Exigirla por oracion daria falsos
    positivos en cada viñeta."""
    t = ("Criterio clínico (no está en la literatura recuperada):\n"
         "- La doxiciclina es el tratamiento empírico habitual en este cuadro clínico.\n"
         "- Se sostiene durante 28 días según la práctica establecida por consenso.")
    assert find_undeclared(t) == []


def test_marca_una_cifra_ejecutable_sin_respaldo():
    t = "Se mantiene el tratamiento durante 28 días y se reevalúa el hemograma al terminar."
    assert _tipos(t) == ["cifra"]


def test_no_marca_las_cifras_que_solo_reformulan_el_caso():
    """'hace 3 días' y 'de 5 años' describen lo que el vet contó: no son algo que él pueda ejecutar
    ni algo que el modelo pueda estar inventando."""
    t = "El cuadro lleva 3 días de evolución en un paciente de 5 años sin antecedentes relevantes."
    assert find_undeclared(t) == []


def test_marca_un_porcentaje_afirmado_sin_fuente():
    """El caso real que motivó esto: 'más del 50% de las piometras por E. coli', sin cita."""
    t = "Más del 50% de las piometras en la perra están causadas por Escherichia coli."
    assert _tipos(t) == ["cifra"]


def test_ignora_las_frases_demasiado_cortas_para_afirmar_algo():
    assert find_undeclared("Doxiciclina.") == []


def test_no_se_pasa_del_tope_para_no_inundar_el_front():
    from app.generation.undeclared import MAX_MARCAS
    t = "\n\n".join(
        f"El tratamiento indicado en este escenario clínico número {i} es con enrofloxacina oral."
        for i in range(MAX_MARCAS + 8))
    assert len(find_undeclared(t)) == MAX_MARCAS


def test_texto_vacio_no_rompe():
    assert find_undeclared("") == []
    assert find_undeclared(None) == []
