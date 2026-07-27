# -*- coding: utf-8 -*-
"""Golden ampliado, paso 1: genera casos ANCLADOS AL CORPUS.

Los 11 casos hechos a mano están saturados (10/11 ya resuelven >=3 conceptos y no distilan), así
que no detectan regresiones. Acá la verdad de terreno no se escribe a mano: por cada condición con
buena cobertura, se genera una transcripción ES realista y el gate objetivo es
**"¿el retrieval trajo chunks cuyo `metadata->mesh` contiene ESE descriptor?"**. Eso lo sabe el
corpus, no una opinión.

Limitación consciente: mide RECUPERACIÓN de la literatura correcta, no si la redacción final es
buena. Es exactamente lo que hace falta para medir el rerank.

Salida: golden_ampliado.json
"""
import argparse, json, os, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))  # datos del banco, junto a estos scripts
BASE = os.path.dirname(os.path.dirname(SCRATCH))  # scripts/calidad -> athos-service
sys.path.insert(0, BASE); os.chdir(BASE)

from app.config import get_settings              # noqa: E402
from app.generation.llm_client import LLMClient  # noqa: E402
from app.retrieval.query_builder import _extract_json  # noqa: E402

SALIDA = os.path.join(BASE, "tests", "golden", "ampliado.json")

# Mismas guardas que el glosario: fuera metodología, outcome y categorías tope.
RAMAS_FUERA = ("E05", "E01.789", "D23")
NO_SON_CONDICION = {
    "Genetic Predisposition to Disease", "Disease Models, Animal", "Coinfection", "Neoplasms",
    "Zoonoses", "Chronic Disease", "Postoperative Complications", "Dog Diseases", "Cat Diseases",
    "Cattle Diseases", "Horse Diseases", "Parasitic Diseases, Animal", "Bites and Stings",
    "Intestinal Diseases, Parasitic", "Tick-Borne Diseases", "Communicable Diseases",
}

SYSTEM = (
    "Eres un veterinario clínico en Latinoamérica. Te doy una condición (en inglés, descriptor "
    "MeSH). Escribí la TRANSCRIPCIÓN de una consulta real donde el paciente TIENE esa condición.\n"
    "REGLAS:\n"
    " - Diálogo natural 'Veterinario:' / 'Dueño:', en español rioplatense/neutro, 6 a 10 turnos.\n"
    " - El dueño describe signos en lenguaje LLANO (como habla un dueño real, no un médico).\n"
    " - El veterinario describe hallazgos del examen físico y plantea el cuadro con lenguaje de "
    "POSIBILIDAD ('compatible con', 'sugestivo de').\n"
    " - NO escribas el descriptor MeSH en inglés en ningún lado.\n"
    " - Elegí la especie más plausible para esa condición.\n"
    "Devolvé EXCLUSIVAMENTE JSON válido, sin texto ni ```:\n"
    '{"especie": "perro|gato|conejo|ave|roedor|huron|reptil", "transcripcion": "Veterinario: ..."}'
)


def generar(cond, modelo):
    raw = LLMClient(model=modelo).complete(SYSTEM, f"CONDICIÓN: {cond}", max_tokens=1200)
    d = _extract_json(raw) or {}
    t = str(d.get("transcripcion") or "").strip()
    esp = str(d.get("especie") or "").strip().lower()
    if len(t) < 200 or esp not in {"perro", "gato", "conejo", "ave", "roedor", "huron", "reptil"}:
        raise ValueError(f"respuesta inutilizable para {cond}")
    return {"id": cond.lower().replace(" ", "-").replace(",", ""), "mesh_target": cond,
            "especie": esp, "query": t}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=150)
    ap.add_argument("--min-chunks", type=int, default=80)
    ap.add_argument("--max-chunks", type=int, default=2000)
    args = ap.parse_args()

    def log(m): print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)

    conds = []
    with open(os.path.join(SCRATCH, "corpus_mesh_clasificado.tsv"), encoding="utf-8") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            term, n, clase = p[0], int(p[1]), p[2]
            tns = [t for t in (p[3].split(",") if len(p) > 3 else []) if t]
            if clase != "enfermedad" or not (args.min_chunks <= n <= args.max_chunks):
                continue
            if term in NO_SON_CONDICION or any(t.startswith(RAMAS_FUERA) for t in tns):
                continue
            if tns and min(t.count(".") for t in tns) == 0:
                continue
            conds.append((term, n))
    conds.sort(key=lambda x: -x[1])
    conds = conds[:args.n]
    log(f"{len(conds)} condiciones elegidas (cobertura {conds[-1][1]}-{conds[0][1]} chunks)")

    modelo = get_settings().llm_light_model
    casos, fallos = [], 0
    with ThreadPoolExecutor(max_workers=5) as ex:
        futs = {ex.submit(generar, c, modelo): c for c, _ in conds}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                casos.append(fut.result())
            except Exception as e:  # noqa: BLE001 — un caso fallido no tumba la generación
                fallos += 1
                if fallos <= 3:
                    log(f"  falló {futs[fut]}: {e}")
            if i % 25 == 0:
                log(f"  {i}/{len(conds)} — {len(casos)} casos ok")
    freq = {c: n for c, n in conds}
    for c in casos:
        c["chunks_corpus"] = freq.get(c["mesh_target"], 0)
    casos.sort(key=lambda c: -c["chunks_corpus"])
    json.dump(casos, open(SALIDA, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log(f"LISTO: {len(casos)} casos ({fallos} fallidos) -> {SALIDA}")


if __name__ == "__main__":
    main()
