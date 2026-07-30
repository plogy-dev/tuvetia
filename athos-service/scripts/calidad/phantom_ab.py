# -*- coding: utf-8 -*-
"""A/B PAREADO del prompt de la nota SOAP del Fantasma. Solo lectura: no escribe `clinical_notes`.

Pareado y no dos corridas independientes: el retrieval y el juez de evidencia corren UNA vez por
caso, y las dos variantes redactan sobre LA MISMA literatura. Así la diferencia que se mide es del
prompt y no del ruido de recuperación — que en este proyecto ya demostró ser más grande que el
efecto que se busca (ver el README de esta carpeta).

Uso:
  python scripts/calidad/phantom_ab.py --a actual --b soap_atribucion --n 16
"""
import argparse
import json
import os
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

from app.generation import generate as gen  # noqa: E402
from app.generation.citation_fidelity import check_fidelity, drop_and_renumber  # noqa: E402
from app.generation.dose_guard import has_dose, patient_data_complete, redact_doses  # noqa: E402
from app.generation.evidence_judge import judge_evidence  # noqa: E402
from app.generation.transcript_fidelity import check_note_fidelity  # noqa: E402
from app.models import PatientContext  # noqa: E402
from app.retrieval.cascade import build_and_retrieve  # noqa: E402
from scripts.calidad.phantom_eval import RUBRICA_SYSTEM, _rubrica_user  # noqa: E402
from scripts.calidad.generadores_nota import GENERADORES  # noqa: E402
from scripts.calidad.prompts_nota import VARIANTES  # noqa: E402
from scripts.calidad.respuestas_eval import _judge_client, _muestra, _parse_json  # noqa: E402

JUDGE = None
DIMS = ("fidelidad", "estructura", "completitud", "seguridad", "utilidad")


def _guards(soap, citations, chunks, patient):
    """Los mismos guards de producción, en el mismo orden, sobre ambas variantes."""
    dosis_antes = has_dose(f"{soap.assessment}\n{soap.plan}")
    if not patient_data_complete(patient.species, patient.weight_kg, patient.age_years):
        soap = soap.model_copy(update={"plan": redact_doses(soap.plan)[0],
                                       "assessment": redact_doses(soap.assessment)[0]})
    descartadas = []
    if citations:
        por_id = {c.chunk_id: c for c in chunks}
        citados = [por_id[c.chunk_id] for c in citations if c.chunk_id in por_id]
        fid = check_fidelity(f"{soap.assessment}\n{soap.plan}", citados)
        if fid.judged and fid.unfaithful:
            total = len(citations)
            soap = soap.model_copy(update={
                "assessment": drop_and_renumber(soap.assessment, fid.unfaithful, total),
                "plan": drop_and_renumber(soap.plan, fid.unfaithful, total)})
            citations = [c for i, c in enumerate(citations, 1) if i not in fid.unfaithful]
            descartadas = sorted(fid.unfaithful)
    return soap, citations, dosis_antes, descartadas


def evalua_par(caso: dict, nombre_a: str, nombre_b: str) -> dict:
    transcript = caso["query"]
    patient = PatientContext(patient_id="", species=caso.get("especie"))

    # UNA sola vez por caso: las dos variantes redactan sobre la misma literatura.
    _query, chunks, passed = build_and_retrieve(transcript, patient.species)
    verdict = judge_evidence(transcript, chunks if passed else [])
    literature = chunks if passed and not verdict.abstains else []

    fila = {"id": caso["id"], "banda": verdict.band, "n_chunks": len(literature)}
    for etiqueta, nombre in (("a", nombre_a), ("b", nombre_b)):
        t0 = time.monotonic()
        try:
            if nombre in GENERADORES:
                # Variante de ESTRATEGIA: cambia cómo se genera (p. ej. `split` usa dos llamadas).
                soap, citations, _flag = GENERADORES[nombre](transcript, literature, patient, [])
            else:
                # Variante de PROMPT. `system_prompt` como argumento y no mutando el global del
                # módulo: acá corren varias variantes en paralelo y el swap global se pisaría.
                soap, citations, _flag = gen.generate_note(
                    transcript, literature, patient, [], system_prompt=VARIANTES[nombre])
        except gen.EmptyNoteError as e:
            fila[etiqueta] = {"error": str(e), "vacio": True}
            continue
        soap, citations, dosis_antes, descartadas = _guards(soap, citations, chunks, patient)
        # Dos senales INDEPENDIENTES del mismo defecto: el juez de calidad (que lee la nota
        # entera) y el auditor de produccion (que compara frase por frase). Si coinciden, el
        # resultado es mucho mas creible que con una sola.
        fid_nota = check_note_fidelity(soap.subjective, soap.objective, transcript)
        raw = JUDGE.complete(RUBRICA_SYSTEM, _rubrica_user(transcript, soap), max_tokens=800)
        fila[etiqueta] = {
            "rubrica": _parse_json(raw) or {}, "n_citas": len(citations),
            "fid_descartadas": descartadas, "dosis_en_el_borrador": dosis_antes,
            "aud_senaladas": len(fid_nota.unsupported), "aud_claims": fid_nota.n_claims,
            "dosis_visible_al_final": has_dose(f"{soap.assessment}\n{soap.plan}"),
            "soap": {"subjective": soap.subjective, "objective": soap.objective,
                     "assessment": soap.assessment, "plan": soap.plan},
            "seg": round(time.monotonic() - t0, 1),
        }
    return fila


def _resumen(filas, etiqueta, nombre):
    lado = [f[etiqueta] for f in filas if etiqueta in f]
    rubs = [d.get("rubrica", {}) for d in lado]
    out = {"nombre": nombre, "n": len(lado)}
    for d in DIMS:
        vals = [r[d] for r in rubs if isinstance(r.get(d), (int, float))]
        out[d] = round(statistics.mean(vals), 1) if vals else None
    out["firmaria"] = sum(1 for r in rubs if r.get("firmaria") is True)
    out["inventan"] = sum(1 for r in rubs if r.get("inventado"))
    out["vacias"] = sum(1 for d in lado if d.get("vacio"))
    out["dosis_final"] = sum(1 for d in lado if d.get("dosis_visible_al_final"))
    out["citas_mediana"] = statistics.median([d.get("n_citas", 0) for d in lado]) if lado else 0
    out["aud_notas_senaladas"] = sum(1 for d in lado if d.get("aud_senaladas"))
    out["aud_afirmaciones"] = sum(d.get("aud_senaladas", 0) for d in lado)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ramas = sorted(set(VARIANTES) | set(GENERADORES))
    ap.add_argument("--a", default="actual", choices=ramas)
    ap.add_argument("--b", required=True, choices=ramas)
    ap.add_argument("--n", type=int, default=16)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--juez-modelo", default="deepseek-v4-pro")
    ap.add_argument("--juez-proveedor", default="openai", choices=("anthropic", "openai"))
    args = ap.parse_args()

    global JUDGE
    JUDGE = _judge_client(args.juez_modelo, args.juez_proveedor)

    def log(m):
        print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)

    casos = _muestra(json.load(open(os.path.join(BASE, "tests", "golden", "ampliado.json"),
                                    encoding="utf-8")), args.n)
    log(f"{len(casos)} transcripciones pareadas · {args.a} vs {args.b} · juez={JUDGE.model}")

    filas = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(evalua_par, c, args.a, args.b): c for c in casos}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                filas.append(fut.result())
            except Exception as e:  # noqa: BLE001
                log(f"  {futs[fut]['id']} falló: {e}")
            if i % 4 == 0:
                log(f"  {i}/{len(casos)}")

    ra, rb = _resumen(filas, "a", args.a), _resumen(filas, "b", args.b)
    print("\n" + "=" * 82)
    print(f"A/B PAREADO DE LA NOTA DEL FANTASMA   ({len(filas)} transcripciones)")
    print("=" * 82)
    print(f"  {'':22} {args.a:>16} {args.b:>16}   delta")
    for k in (*DIMS, "firmaria", "inventan", "aud_notas_senaladas", "aud_afirmaciones",
              "vacias", "dosis_final", "citas_mediana"):
        va, vb = ra.get(k), rb.get(k)
        if va is None or vb is None:
            continue
        marca = ""
        if k in DIMS or k == "firmaria":
            marca = "  <-- mejor" if vb > va else ("  <-- PEOR" if vb < va else "")
        elif k.startswith("aud_"):
            marca = "  <-- mejor" if vb < va else ("  <-- PEOR" if vb > va else "")
        elif vb != va:
            marca = "  <-- mejor" if vb < va else "  <-- PEOR"
        print(f"  {k:22} {va:>16} {vb:>16}   {round(vb - va, 1):+}{marca}")

    # Pareado caso a caso: cuántos casos mejoran y cuántos empeoran en la dimensión que más importa.
    mejor = peor = igual = 0
    for f in filas:
        fa, fb = f.get("a", {}).get("rubrica", {}), f.get("b", {}).get("rubrica", {})
        if not isinstance(fa.get("fidelidad"), (int, float)) or \
           not isinstance(fb.get("fidelidad"), (int, float)):
            continue
        if fb["fidelidad"] > fa["fidelidad"]:
            mejor += 1
        elif fb["fidelidad"] < fa["fidelidad"]:
            peor += 1
        else:
            igual += 1
    print(f"\n  FIDELIDAD caso a caso: {mejor} mejoran · {peor} empeoran · {igual} empatan")

    print("\n  CASOS QUE EMPEORAN (revisar a mano antes de adoptar):")
    for f in filas:
        fa, fb = f.get("a", {}).get("rubrica", {}), f.get("b", {}).get("rubrica", {})
        if isinstance(fa.get("fidelidad"), (int, float)) and \
           isinstance(fb.get("fidelidad"), (int, float)) and fb["fidelidad"] < fa["fidelidad"]:
            print(f"    {f['id']:28} F {fa['fidelidad']} -> {fb['fidelidad']}")
            for inv in (fb.get("inventado") or [])[:2]:
                print(f"        inventado: {str(inv)[:110]}")

    destino = os.path.join(SCRATCH, f"phantom_ab_{args.a}_vs_{args.b}.json")
    with open(destino, "w", encoding="utf-8") as fh:
        json.dump({"a": ra, "b": rb, "casos": filas}, fh, ensure_ascii=False, indent=1)
    print(f"\n  -> {destino}")


if __name__ == "__main__":
    main()
