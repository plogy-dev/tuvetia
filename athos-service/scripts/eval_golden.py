"""Evaluador del golden set (calibracion del RAG). READ-ONLY, NO escribe a la DB.

Corre, por cada caso de tests/golden/cases.json, el pipeline real de retrieval + generacion citada
(build_query -> retrieve -> generate note) y compara contra las etiquetas esperadas. Imprime un
scorecard y un agregado. Sirve para: calibrar umbrales (THRESHOLD, MIN_CONFIDENT_CONCEPTS,
TIER*_KEEP), medir regresiones antes/despues de tocar retrieval o prompts, y comparar modelos.

Uso (desde un entorno con .env, p.ej. el checkout con credenciales):
  python scripts/eval_golden.py                 # modelo de LLM_MODEL, pipeline completo
  python scripts/eval_golden.py --model claude-opus-4-8   # compara otro redactor
  python scripts/eval_golden.py --retrieval-only          # solo retrieval (sin la llamada de redaccion)
  python scripts/eval_golden.py --case ckd-feline         # un solo caso
"""
import argparse
import json
import os
import sys

# Permite ejecutar el script directamente (python scripts/eval_golden.py) resolviendo el paquete app.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.generation.generate import build_note_prompt, parse_note_response  # noqa: E402
from app.generation.llm_client import LLMClient  # noqa: E402
from app.glossary.resolve import _normalize  # noqa: E402
from app.models import PatientContext  # noqa: E402
from app.retrieval.cascade import retrieve  # noqa: E402
from app.retrieval.query_builder import build_query  # noqa: E402

CASES_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          "tests", "golden", "cases.json")


def _has_terms(chunks, terms) -> int:
    """Cuenta chunks recuperados cuyo content/mesh contiene ALGUNO de los terminos (normalizados)."""
    norm_terms = [_normalize(t) for t in terms]
    n = 0
    for c in chunks:
        hay = _normalize((c.content or "") + " " + " ".join(c.metadata.get("mesh") or []))
        if any(t in hay for t in norm_terms):
            n += 1
    return n


def _gen_note(transcript, literature, species, model):
    """Replica generate_note pero permite fijar el modelo (para comparar redactores)."""
    patient = PatientContext(patient_id="golden", species=species)
    system, user = build_note_prompt(transcript, literature, patient, [])
    raw = LLMClient(model=model).complete(system, user, max_tokens=4000)
    return parse_note_response(raw, literature)


def eval_case(case, model, retrieval_only):
    exp = case["expect"]
    q = build_query(case["query"], case["species"])
    chunks, passed = retrieve(q)
    n_rel = _has_terms(chunks, exp.get("relevant_terms", []))
    row = {
        "id": case["id"], "distilled": q.distilled, "nconcepts": len(q.concepts),
        "passed": passed, "n_rel": n_rel, "min_rel": exp.get("min_relevant_chunks", 0),
        "n_cit": None, "min_cit": exp.get("min_citations", 0), "assess": None,
        "flag": None, "flag_exp": exp.get("allergy_transcript_flag", False),
        "corpus_gap": exp.get("corpus_gap", False),
    }
    row["rel_ok"] = n_rel >= row["min_rel"]
    if retrieval_only:
        row["ok"] = row["rel_ok"]
        return row

    literature = chunks if passed else []
    soap, citations, flag = _gen_note(case["query"], literature, case["species"], model)
    row["n_cit"] = len(citations)
    row["flag"] = flag
    assess_norm = _normalize(soap.assessment or "")
    row["assess"] = any(_normalize(t) in assess_norm for t in exp.get("assessment_mentions", []))
    cit_ok = row["n_cit"] >= row["min_cit"]
    flag_ok = flag == row["flag_exp"]
    # el assessment solo se exige cuando la nota SI se apoyo en literatura (no en abstencion honesta)
    assess_ok = row["assess"] if (row["n_cit"] > 0 and row["min_cit"] > 0) else True
    row["cit_ok"], row["flag_ok"], row["assess_ok"] = cit_ok, flag_ok, assess_ok
    row["ok"] = row["rel_ok"] and cit_ok and flag_ok and assess_ok
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=None, help="modelo redactor (default: LLM_MODEL del env)")
    ap.add_argument("--retrieval-only", action="store_true", help="omite la redaccion (barato)")
    ap.add_argument("--case", default=None, help="corre solo un caso por id")
    args = ap.parse_args()

    from app.config import get_settings
    model = args.model or get_settings().llm_model
    data = json.load(open(CASES_PATH, encoding="utf-8"))
    cases = [c for c in data["cases"] if not args.case or c["id"] == args.case]

    mode = "retrieval-only" if args.retrieval_only else f"model={model}"
    print(f"GOLDEN SET  ({len(cases)} casos, {mode})\n" + "=" * 78)
    agg = {"ok": 0, "rel": 0, "cit": 0, "flag": 0}
    for c in cases:
        r = eval_case(c, model, args.retrieval_only)
        agg["ok"] += int(r["ok"])
        agg["rel"] += int(r["rel_ok"])
        tag = "PASS" if r["ok"] else "FAIL"
        gap = " [corpus_gap]" if r["corpus_gap"] else ""
        base = (f"{tag}  {r['id']:28} distil={int(r['distilled'])} nc={r['nconcepts']:2} "
                f"pass={int(r['passed'])} rel={r['n_rel']}/{r['min_rel']}")
        if args.retrieval_only:
            print(base + gap)
        else:
            agg["cit"] += int(r["cit_ok"])
            agg["flag"] += int(r["flag_ok"])
            print(base + f" cit={r['n_cit']}/{r['min_cit']} assess={int(bool(r['assess']))} "
                         f"flag={int(bool(r['flag']))}(exp {int(r['flag_exp'])}){gap}")
    print("=" * 78)
    n = len(cases)
    if args.retrieval_only:
        print(f"AGREGADO  PASS={agg['ok']}/{n}  relevancia_ok={agg['rel']}/{n}")
    else:
        print(f"AGREGADO  PASS={agg['ok']}/{n}  relevancia_ok={agg['rel']}/{n}  "
              f"citas_ok={agg['cit']}/{n}  flag_alergia_ok={agg['flag']}/{n}")


if __name__ == "__main__":
    main()
