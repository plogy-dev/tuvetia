# -*- coding: utf-8 -*-
"""Latencia END-TO-END del chat, medida como la vive el veterinario. Solo lectura.

Existe porque el cliente reportó "latencias cercanas a 5 minutos" (auditoría del Milestone 2) y
`latencia_db.py` sólo mide el tiempo de SERVIDOR de las dos consultas al corpus. Lo que hay que
poder afirmar o desmentir es otra cosa: cuánto tarda el vet en ver el PRIMER TOKEN y cuánto en
tener la respuesta completa.

Mide el pipeline real (`stream_answer`) por etapas, con el mismo código que corre en producción:
  t_primer_token : lo único que el vet percibe como espera
  t_completo     : hasta el último token
y desglosa retrieval / juez / redacción.

Uso:  python scripts/calidad/latencia_e2e.py [--n 8]
"""
import argparse
import json
import os
import statistics
import sys
import time

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

from app.chat import CHAT_LIT_LIMIT, CHAT_MAX_TOKENS, CHAT_SYSTEM, _chat_prompt  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.generation.evidence_judge import judge_evidence  # noqa: E402
from app.generation.llm_client import LLMClient  # noqa: E402
from app.models import PatientContext  # noqa: E402
from app.retrieval.cascade import build_and_retrieve  # noqa: E402


def medir(caso: dict) -> dict:
    """Cronometra las etapas tal como las encadena `stream_answer` para el chat."""
    t0 = time.monotonic()
    _q, chunks, passed = build_and_retrieve(caso["query"], caso.get("especie"))
    t_retrieval = time.monotonic() - t0
    literature = chunks[:CHAT_LIT_LIMIT]

    # En producción el juez corre EN PARALELO con la redacción y sólo retiene tokens hasta su
    # veredicto: el costo real es max(juez, primer token), no la suma. Acá se miden por separado
    # para poder informar el desglose, y se reporta el paralelo como corresponde.
    tj = time.monotonic()
    verdict = judge_evidence(caso["query"], literature if passed else [])
    t_juez = time.monotonic() - tj

    paciente = PatientContext(patient_id="", species=caso.get("especie"))
    user = _chat_prompt(caso["query"], literature, paciente, [])
    tg = time.monotonic()
    primer = None
    n_tokens = 0
    texto = []
    for tok in LLMClient().stream(CHAT_SYSTEM, user, max_tokens=CHAT_MAX_TOKENS):
        if primer is None:
            primer = time.monotonic() - tg
        n_tokens += 1
        texto.append(tok)
    t_generacion = time.monotonic() - tg

    # Lo que el vet espera realmente antes de ver texto: retrieval + max(juez, primer token).
    espera_real = t_retrieval + max(t_juez, primer or 0.0)
    return {
        "id": caso["id"],
        "t_retrieval": round(t_retrieval, 2),
        "t_juez": round(t_juez, 2),
        "t_primer_token_llm": round(primer or 0.0, 2),
        "t_generacion_total": round(t_generacion, 2),
        "espera_hasta_primer_token": round(espera_real, 2),
        "t_completo": round(t_retrieval + max(t_juez, t_generacion), 2),
        "chars": len("".join(texto)),
        "banda": verdict.band,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=8)
    args = ap.parse_args()

    casos = json.load(open(os.path.join(BASE, "tests", "golden", "ampliado.json"),
                           encoding="utf-8"))[:args.n]
    s = get_settings()
    mismo = s.corpus_db_url == s.database_url
    print(f"redactor={s.llm_model}  juez={s.judge_model_name}  "
          f"corpus={'el mismo que la DB de paciente' if mismo else 'separado'}")
    print(f"midiendo {len(casos)} consultas (secuencial, para no falsear con concurrencia)\n")

    filas = []
    for i, c in enumerate(casos, 1):
        try:
            f = medir(c)
        except Exception as e:  # noqa: BLE001
            print(f"  {c['id']}: falló ({e})")
            continue
        filas.append(f)
        print(f"  {i}/{len(casos)} {f['id']:28} primer token {f['espera_hasta_primer_token']:6.1f}s"
              f"   completo {f['t_completo']:6.1f}s   ({f['chars']} chars)")

    if not filas:
        print("sin mediciones")
        return

    def stat(k):
        v = sorted(f[k] for f in filas)
        p95 = v[min(len(v) - 1, int(len(v) * 0.95))]
        return statistics.median(v), v[-1], p95

    print("\n" + "=" * 78)
    print("LATENCIA END-TO-END (lo que percibe el veterinario)")
    print("=" * 78)
    for etiqueta, clave in (("HASTA EL PRIMER TOKEN", "espera_hasta_primer_token"),
                            ("RESPUESTA COMPLETA", "t_completo"),
                            ("  desglose: retrieval", "t_retrieval"),
                            ("  desglose: juez", "t_juez"),
                            ("  desglose: generación", "t_generacion_total")):
        med, mx, p95 = stat(clave)
        print(f"  {etiqueta:26} mediana {med:6.1f}s   p95 {p95:6.1f}s   máx {mx:6.1f}s")
    print(f"\n  largo de respuesta (mediana): "
          f"{statistics.median(f['chars'] for f in filas):.0f} chars")
    print("\n  NOTA: medido desde una notebook; el backend en Railway está junto a la DB, así que "
          "el retrieval real en producción es MENOR que este número.")

    out = os.path.join(SCRATCH, "latencia_e2e.json")
    json.dump(filas, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"  -> {out}")


if __name__ == "__main__":
    main()
