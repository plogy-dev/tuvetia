# -*- coding: utf-8 -*-
"""Glosario paso 2: genera sinónimos ES (técnicos + coloquiales del dueño) para los descriptores
MeSH CLÍNICOS del corpus, con el LLM liviano configurado (nunca hardcodeado).

NO escribe a la DB: deja `glosario_propuesto.jsonl` para que el paso 3 valide y siembre.
Reanudable: saltea los descriptores que ya estén en el jsonl.

Uso: python glosario_generar.py [--limite N] [--min-chunks N]
"""
import argparse, json, os, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))  # datos del banco, junto a estos scripts
BASE = os.path.dirname(os.path.dirname(SCRATCH))  # scripts/calidad -> athos-service
sys.path.insert(0, BASE); os.chdir(BASE)

from app.config import get_settings          # noqa: E402
from app.generation.llm_client import LLMClient  # noqa: E402
from app.retrieval.query_builder import _extract_json  # noqa: E402

CLASES_CLINICAS = {"enfermedad", "procedimiento", "farmaco_quimico", "anatomia"}
PROPUESTO = os.path.join(SCRATCH, "glosario_propuesto.jsonl")
LOTE = 12          # descriptores por llamada
WORKERS = 4        # llamadas en paralelo

SYSTEM = (
    "Eres un veterinario clínico bilingüe (ES-LatAm/EN) construyendo el glosario de búsqueda de un "
    "sistema RAG veterinario. Para cada descriptor MeSH en inglés que te den, devuelve las formas en "
    "que ese concepto se DICE EN ESPAÑOL en una consulta veterinaria real en Latinoamérica.\n"
    "Dos registros:\n"
    "  - `tecnico`: como lo escribe/dice el VETERINARIO (término clínico en español).\n"
    "  - `coloquial`: como lo describe el DUEÑO de la mascota, en lenguaje llano.\n"
    "REGLAS DURAS (el matcher es determinístico por frase completa; un sinónimo malo envenena el "
    "retrieval de todos):\n"
    "  1. NUNCA devuelvas palabras genéricas o ambiguas que aparezcan en consultas de OTRAS "
    "condiciones: 'sangre', 'dolor', 'orina', 'piel', 'come', 'agua', 'ojo', 'pata', 'infeccion'.\n"
    "  2. Cada sinónimo debe identificar ESE concepto de forma inequívoca. Ante la duda, NO lo "
    "incluyas. Es mejor devolver 2 sinónimos excelentes que 8 mediocres.\n"
    "  3. Preferí frases específicas ('orina mucho', 'toma muchisima agua') a palabras sueltas.\n"
    "  4. Español neutro LatAm, minúsculas, SIN tildes ni signos de puntuación.\n"
    "  5. Si el descriptor NO es algo que se mencione en una consulta veterinaria (término de "
    "metodología, geografía, estadística, o un concepto solo de investigación), devolvé listas "
    "VACÍAS para él. Esto es esperado y correcto para muchos descriptores.\n"
    "  6. Si el concepto es de medicina humana sin uso veterinario, devolvé listas vacías.\n"
    "Devolvé EXCLUSIVAMENTE JSON válido, sin texto ni ```, con la forma:\n"
    '{"terminos": [{"en": "<descriptor exacto>", "tecnico": ["..."], "coloquial": ["..."]}]}'
)


def pedir(lote, modelo):
    user = "DESCRIPTORES:\n" + "\n".join(f"- {d}" for d in lote)
    raw = LLMClient(model=modelo).complete(SYSTEM, user, max_tokens=3000)
    data = _extract_json(raw) or {}
    salida = {}
    for t in data.get("terminos") or []:
        en = str(t.get("en") or "").strip()
        if en:
            salida[en] = {
                "tecnico": [str(x).strip() for x in (t.get("tecnico") or []) if str(x).strip()],
                "coloquial": [str(x).strip() for x in (t.get("coloquial") or []) if str(x).strip()],
            }
    return salida


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limite", type=int, default=0, help="máximo de descriptores a procesar")
    ap.add_argument("--min-chunks", type=int, default=10)
    args = ap.parse_args()

    def log(m): print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)

    candidatos = []
    with open(os.path.join(SCRATCH, "corpus_mesh_clasificado.tsv"), encoding="utf-8") as f:
        for line in f:
            term, n, clase = line.rstrip("\n").split("\t")[:3]
            if clase in CLASES_CLINICAS and int(n) >= args.min_chunks:
                candidatos.append((term, int(n)))
    candidatos.sort(key=lambda x: -x[1])

    hechos = set()
    if os.path.exists(PROPUESTO):
        with open(PROPUESTO, encoding="utf-8") as f:
            for line in f:
                try: hechos.add(json.loads(line)["en"])
                except Exception: pass  # noqa: BLE001 — línea a medias de una corrida cortada
    pendientes = [t for t, _ in candidatos if t not in hechos]
    if args.limite:
        pendientes = pendientes[:args.limite]
    modelo = get_settings().llm_light_model
    log(f"{len(candidatos):,} descriptores clínicos (>={args.min_chunks} chunks); "
        f"{len(hechos):,} ya hechos; proceso {len(pendientes):,} con {modelo}")

    lotes = [pendientes[i:i+LOTE] for i in range(0, len(pendientes), LOTE)]
    escritos = vacios = 0
    with open(PROPUESTO, "a", encoding="utf-8") as out, ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(pedir, l, modelo): l for l in lotes}
        for i, fut in enumerate(as_completed(futs), 1):
            lote = futs[fut]
            try:
                res = fut.result()
            except Exception as e:  # noqa: BLE001 — un lote fallido no debe tumbar la corrida
                log(f"  lote falló ({e}); se reintenta en la próxima corrida")
                continue
            for d in lote:
                r = res.get(d, {"tecnico": [], "coloquial": []})
                if not r["tecnico"] and not r["coloquial"]:
                    vacios += 1
                out.write(json.dumps({"en": d, **r}, ensure_ascii=False) + "\n")
                escritos += 1
            out.flush()
            if i % 10 == 0:
                log(f"  {i}/{len(lotes)} lotes — {escritos:,} descriptores ({vacios:,} sin sinónimos)")
    log(f"LISTO: {escritos:,} descriptores escritos ({vacios:,} sin sinónimos, esperado) -> {PROPUESTO}")


if __name__ == "__main__":
    main()
