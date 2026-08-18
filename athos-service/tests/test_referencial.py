"""Preguntas referenciales: las que señalan al paciente en vez de plantear un cuadro.

Lo que estos tests protegen es una FRONTERA, no un comportamiento cosmético: el enriquecimiento
sólo puede tocar la rama que hoy falla. Si empezara a dispararse en consultas clínicas bien
formadas, movería la calibración del juez —187 casos medidos— en todo el producto, y eso no se
puede re-medir desde acá.
"""
import pytest

from app.retrieval.referencial import (
    MAX_RESUMEN_CHARS, consulta_enriquecida, es_referencial)

# La evaluación real de Manchita, de la nota que el propio sistema escribió 55 minutos antes de que
# el chat se abstuviera sobre ella.
CUADRO_MANCHITA = (
    "Cuadro clínico compatible con vómitos crónicos (duración >1 semana) en gato, con posibles "
    "diagnósticos diferenciales que incluyen cuerpo extraño gastrointestinal (antecedente de "
    "cuerda), enfermedad inflamatoria intestinal, enfermedad renal crónica, o trastornos "
    "metabólicos."
)


class TestEsReferencial:
    def test_el_caso_de_manchita(self):
        """Los conceptos exactos que el A->B destiló de la pregunta que falló."""
        assert es_referencial(["cat", "feline", "clinical condition"]) is True

    def test_sin_conceptos_es_referencial(self):
        assert es_referencial([]) is True

    def test_solo_signos_genericos_es_referencial(self):
        """Tres signos no son un diagnóstico — es el mismo criterio que usa el A->B para distilar."""
        assert es_referencial(["Vomiting", "Weight Loss", "Anorexia"]) is True

    def test_una_condicion_concreta_NO_es_referencial(self):
        """LA FRONTERA. Con un descriptor diagnóstico, el vet ya dijo qué busca y no se toca nada.

        Se salta si el árbol MeSH no está en el checkout: sin él `names_a_condition` devuelve False
        para todo y el test mediría el degradado, no la regla.
        """
        from app.glossary.specificity import diagnostic_descriptors

        diag = diagnostic_descriptors()
        if not diag:
            pytest.skip("sin mesh_diagnostic.json no hay descriptores que reconocer")
        alguno = next(iter(diag))
        assert es_referencial([alguno]) is False

    def test_basta_UNO_diagnostico_entre_varios_signos(self):
        from app.glossary.specificity import diagnostic_descriptors

        diag = diagnostic_descriptors()
        if not diag:
            pytest.skip("sin mesh_diagnostic.json no hay descriptores que reconocer")
        alguno = next(iter(diag))
        assert es_referencial(["Vomiting", "Weight Loss", alguno]) is False


class TestConsultaEnriquecida:
    def test_sin_cuadro_devuelve_la_pregunta_tal_cual(self):
        """No hay nada que agregar y no se inventa nada."""
        q = "hola que piensas sobre la ccondiccion de manncchita"
        assert consulta_enriquecida(q, None) == q
        assert consulta_enriquecida(q, "") == q
        assert consulta_enriquecida(q, "   ") == q

    def test_la_pregunta_del_vet_va_primero_y_completa(self):
        """El vector del Tier 2 y el juez la leen como el asunto principal."""
        q = "¿qué piensas sobre la condición de Manchita?"
        out = consulta_enriquecida(q, CUADRO_MANCHITA)
        assert out.startswith(q)

    def test_el_cuadro_aporta_los_terminos_que_la_pregunta_no_tenia(self):
        """Es lo único que importa de todo esto: que la consulta pase a nombrar el cuadro.

        Sin el enriquecimiento, ninguno de estos términos existe en el texto que se busca — por eso
        el retrieval traía chunks genéricos con top_score 0,90 y el juez abstenía.
        """
        q = "hola que piensas sobre la ccondiccion de manncchita"
        out = consulta_enriquecida(q, CUADRO_MANCHITA).lower()
        for termino in ["vómitos crónicos", "cuerpo extraño", "inflamatoria intestinal", "renal crónica"]:
            assert termino in out, f"la consulta enriquecida no nombra «{termino}»"

    def test_el_cuadro_va_rotulado_y_no_se_confunde_con_la_pregunta(self):
        out = consulta_enriquecida("¿qué opinas?", CUADRO_MANCHITA)
        assert "Cuadro clínico registrado de este paciente:" in out

    def test_un_cuadro_desmedido_no_desplaza_a_la_pregunta(self):
        """Una nota anómala no puede sepultar lo que el vet preguntó."""
        q = "¿qué piensas?"
        out = consulta_enriquecida(q, "x" * 5000)
        assert out.startswith(q)
        assert len(out) < len(q) + MAX_RESUMEN_CHARS + 100

    def test_no_se_pierden_espacios_del_borde(self):
        out = consulta_enriquecida("  ¿qué opinas?  ", "  vómito crónico  ")
        assert out.startswith("¿qué opinas?")
        assert out.rstrip().endswith("vómito crónico")
