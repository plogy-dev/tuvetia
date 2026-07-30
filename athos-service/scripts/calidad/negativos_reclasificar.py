# -*- coding: utf-8 -*-
"""Convierte los FALSOS negativos en positivos del banco. Solo lectura de la DB; escribe JSON.

Los 24 casos que el árbitro marcó como "la literatura SÍ alcanza" (ver `negativos_validar.py`) no son
basura: son consultas clínicas realistas **cuyo tema el corpus cubre**, o sea exactamente lo que un
positivo debe ser. Tirarlos sería desperdiciar 24 casos ya validados por un árbitro fuerte.

El problema es que un positivo del banco necesita un `mesh_target` que el corpus realmente tenga: el
descriptor original **no está** (por eso se eligieron como negativos). Así que se re-ancla el caso al
descriptor MeSH **más frecuente entre los chunks que el retrieval trae de verdad**, que es el criterio
con el que se construyó el banco de positivos original: la etiqueta sale del corpus, no de una
opinión.

Los casos donde no se puede anclar con confianza se dejan fuera y se informan: es mejor un banco más
chico y correcto que uno grande y sucio — la lección de esta misma sesión.

Uso:  python scripts/calidad/negativos_reclasificar.py [--min-chunks 40]
"""
import argparse
import json
import os
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

from app.chat import CHAT_LIT_LIMIT  # noqa: E402
from app.db import fetch_all_corpus  # noqa: E402
from app.retrieval.cascade import TIER1_MESH_STOPLIST, build_and_retrieve  # noqa: E402

# Descriptores que NO pueden ser el target de un caso clínico. La primera corrida re-ancló
# `lacrimal-apparatus-diseases` a **Retrospective Studies** y `spina-bifida` a **Magnetic Resonance
# Imaging**: el retrieval trae esos descriptores porque casi todo paper veterinario los lleva, no
# porque describan el cuadro. Un target así haría que el banco midiera "¿trajo un paper?" en vez de
# "¿trajo literatura de esta condición?".
_NO_CLINICOS = {
    # Paraguas y procesos (ya conocidos: ver README §El recall ciego)
    "Inflammation", "Disease Progression", "Recurrence", "Disease Susceptibility", "Syndrome",
    "Bacterial Infections", "Joint Diseases", "Heart Diseases", "Communicable Diseases, Emerging",
    "Protozoan Infections, Animal", "Ectoparasitic Infestations", "Neoplasm Metastasis",
    "Disease", "Animals", "Pets", "Chronic Disease", "Acute Disease", "Comorbidity",
    # Diseño de estudio y estadística
    "Retrospective Studies", "Prospective Studies", "Cohort Studies", "Case-Control Studies",
    "Cross-Sectional Studies", "Treatment Outcome", "Prognosis", "Reproducibility of Results",
    "Sensitivity and Specificity", "Risk Factors", "Prevalence", "Incidence", "Follow-Up Studies",
    "Breeding", "Genetic Predisposition to Disease", "Phylogeny", "Fatal Outcome",
    # Técnicas de imagen y laboratorio
    "Magnetic Resonance Imaging", "Tomography, X-Ray Computed", "Ultrasonography",
    "Radiography", "Echocardiography", "Electrocardiography", "Immunohistochemistry",
    "Polymerase Chain Reaction", "Biopsy", "Endoscopy", "Blood Cell Count",
    # Clases de fármaco y vías (no son diagnósticos)
    "Anti-Bacterial Agents", "Anti-Inflammatory Agents", "Antifungal Agents", "Analgesics",
    "Glucocorticoids", "Administration, Oral", "Injections",
    # Procedimientos
    "Ovariectomy", "Ovariohysterectomy", "Castration", "Anesthesia", "Surgical Procedures, Operative",
}

# Cuántos de los 12 pasajes recuperados deben llevar el descriptor para creer que representa el caso.
# La primera corrida usaba 3 y dejaba entrar descriptores incidentales; los re-anclajes buenos
# aparecen en 6 o más (`Impetigo -> Pyoderma` aparece en 12/12).
MIN_APARICIONES = 6


def chunks_de(descriptor: str) -> int:
    r = fetch_all_corpus(
        "select count(*) as n from public.corpus_chunks where metadata->'mesh' ? %s",
        (descriptor,))
    return r[0]["n"] if r else 0


def reancla(caso: dict, min_chunks: int) -> dict:
    """Busca el descriptor MeSH que mejor representa lo que el retrieval trae para este caso."""
    _q, chunks, passed = build_and_retrieve(caso["query"], caso.get("especie"))
    lit = chunks[:CHAT_LIT_LIMIT]
    # Se cuentan los descriptores de los chunks que EL RETRIEVAL TRAJO: si el caso se re-ancla a uno
    # de ellos, el target es alcanzable por construcción (y el banco mide ruido, no imposibles).
    cont = Counter()
    for c in lit:
        for m in (c.metadata or {}).get("mesh") or []:
            if m not in TIER1_MESH_STOPLIST and m not in _NO_CLINICOS:
                cont[m] += 1
    candidatos = [(m, n) for m, n in cont.most_common(8) if n >= MIN_APARICIONES]
    for descriptor, apariciones in candidatos:
        total = chunks_de(descriptor)
        if total >= min_chunks:
            return {"id": caso["id"], "nuevo_target": descriptor, "apariciones": apariciones,
                    "chunks_corpus": total, "target_viejo": caso.get("mesh_target"),
                    "passed": passed, "ok": True}
    return {"id": caso["id"], "ok": False, "target_viejo": caso.get("mesh_target"),
            "top": cont.most_common(4)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-chunks", type=int, default=40,
                    help="mínimo de chunks del corpus para aceptar el nuevo target")
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()

    informe = os.path.join(SCRATCH, "negativos_validacion.json")
    if not os.path.exists(informe):
        print("falta negativos_validacion.json: corré primero negativos_validar.py")
        return
    validacion = json.load(open(informe, encoding="utf-8"))
    falsos = {f["id"] for f in validacion if f.get("arbitro_alcanza") is True}

    originales = {c["id"]: c for c in json.load(
        open(os.path.join(BASE, "tests", "golden", "ampliado_negativos.json"), encoding="utf-8"))}
    casos = [originales[i] for i in falsos if i in originales]
    print(f"re-anclando {len(casos)} falsos negativos a un descriptor que el corpus SÍ tiene\n")

    filas = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(reancla, c, args.min_chunks): c for c in casos}
        for fut in as_completed(futs):
            try:
                filas.append(fut.result())
            except Exception as e:  # noqa: BLE001
                print(f"  {futs[fut]['id']} falló: {e}")

    buenos = [f for f in filas if f["ok"]]
    malos = [f for f in filas if not f["ok"]]
    print("=" * 92)
    print(f"RE-ANCLADOS: {len(buenos)}   sin ancla confiable: {len(malos)}")
    print("=" * 92)
    for f in sorted(buenos, key=lambda x: -x["chunks_corpus"]):
        print(f"  {f['id']:44} {f['target_viejo']:34} -> {f['nuevo_target']} "
              f"({f['chunks_corpus']:,} chunks, en {f['apariciones']}/12 pasajes)")
    if malos:
        print("\n  SIN ANCLA (se quedan fuera; mejor un banco chico y correcto):")
        for f in malos:
            print(f"    {f['id']:44} top del retrieval: {f['top']}")

    # Banco ampliado: positivos originales + los re-anclados, con la misma forma.
    pos_ruta = os.path.join(BASE, "tests", "golden", "ampliado.json")
    positivos = json.load(open(pos_ruta, encoding="utf-8"))
    nuevos = []
    for f in buenos:
        c = dict(originales[f["id"]])
        c["mesh_target"] = f["nuevo_target"]
        c["chunks_corpus"] = f["chunks_corpus"]
        c["reanclado_de"] = f["target_viejo"]
        c["origen"] = "negativo reclasificado 2026-07-29"
        nuevos.append(c)
    salida = os.path.join(BASE, "tests", "golden", "ampliado_v2.json")
    json.dump(positivos + nuevos, open(salida, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"\n  banco de positivos: {len(positivos)} + {len(nuevos)} = "
          f"{len(positivos) + len(nuevos)}  -> {salida}")
    json.dump(filas, open(os.path.join(SCRATCH, "negativos_reclasificacion.json"), "w",
                          encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
