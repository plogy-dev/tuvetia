"""Guardia de regresion sobre el golden set (tests/golden/cases.json).

SKIP por defecto: necesita DB (corpus/glosario), keys de LLM/embeddings y hace llamadas reales
(costo + no-determinismo). Correr desde un entorno con .env:
    RUN_GOLDEN=1 pytest tests/test_golden.py -s
Para el detalle/scorecard usar el harness: python scripts/eval_golden.py
"""
import json
import os

import pytest

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_GOLDEN") != "1",
    reason="golden set: exporta RUN_GOLDEN=1 (necesita DB + keys + LLM)",
)


def _cases():
    path = os.path.join(os.path.dirname(__file__), "golden", "cases.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)["cases"]


def test_golden_retrieval_surfaces_relevant_literature():
    """El retrieval hace aflorar literatura relevante en los casos con cobertura (no corpus_gap).
    Tolera 1 fallo por variabilidad del A->B liviano / corpus."""
    from scripts.eval_golden import eval_case

    total = ok = 0
    for c in _cases():
        if c["expect"].get("corpus_gap"):
            continue
        total += 1
        ok += int(eval_case(c, {}, retrieval_only=True)["rel_ok"])  # {} -> proveedor/modelo del env
    assert ok >= total - 1, f"relevancia del retrieval por debajo del umbral: {ok}/{total}"


def test_golden_citation_floor_and_allergy_flag():
    """Los casos con cobertura CITAN (>= floor); los corpus_gap pueden abstenerse (no penaliza).
    El allergy_transcript_flag (lectura del transcript por el modelo) debe ser correcto en agregado."""
    from scripts.eval_golden import eval_case

    solid = cite = 0
    flag_ok = flag_total = 0
    for c in _cases():
        r = eval_case(c, {}, retrieval_only=False)
        flag_total += 1
        flag_ok += int(r["flag_ok"])
        if c["expect"].get("min_citations", 0) >= 1:
            solid += 1
            cite += int(r["n_cit"] >= 1)
    assert cite >= solid - 1, f"casos solidos que citan por debajo del umbral: {cite}/{solid}"
    assert flag_ok >= flag_total - 1, f"allergy_transcript_flag incorrecto: {flag_ok}/{flag_total}"
