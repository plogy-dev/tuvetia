# -*- coding: utf-8 -*-
"""VERDAD-DE-TERRENO MECÁNICA para la abstención, y medición del juez contra ella.

**El problema que resuelve.** El banco etiqueta cada caso por si el CORPUS contiene el descriptor.
El juez decide otra cosa: si **los pasajes que el retrieval trajo** cubren la consulta. Son preguntas
distintas, y por eso la medición anterior castigaba al juez por aciertos:

  · `neg-hepatitis-viral-animal` estaba marcado como negativo, pero el retrieval trajo hepatitis
    infecciosa canina por adenovirus — que ES hepatitis viral animal. El juez puntuó 9. Tenía razón.
  · `bone-neoplasms` estaba marcado como positivo, pero el retrieval trajo displasia de codo. El
    juez puntuó 2. Tenía razón.

**La verdad que usa este script.** Para cada caso pregunta un HECHO comprobable, sin opinión de
ningún modelo: *¿alguno de los pasajes recuperados está indexado con el descriptor objetivo
(`mesh_target`)?* Los descriptores los trae el corpus en `metadata->mesh`; no los pone una IA ni
nosotros. Cualquiera puede volver a correr esto y obtener lo mismo.

  verdad = CUBIERTO      -> lo correcto es responder
  verdad = NO CUBIERTO   -> lo correcto es abstenerse o declarar evidencia limitada

**Límite honesto, y queda dicho.** El etiquetado MeSH del corpus es incompleto: un documento puede
hablar de la condición sin llevar el descriptor. Por eso "NO CUBIERTO" significa exactamente *"no hay
ningún documento indexado con ese descriptor entre los recuperados"*, ni más ni menos. Los casos donde
el juez y esta verdad discrepan se listan uno por uno al final, para revisarlos a mano.

Uso:
  python scripts/calidad/abstencion_verdad.py --n 0          # banco completo
  python scripts/calidad/abstencion_verdad.py --n 24 --sin-juez   # sólo la verdad (no gasta LLM)
"""
import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

from app.config import get_settings                       # noqa: E402
from app.generation.evidence_judge import judge_evidence  # noqa: E402
from app.retrieval.cascade import retrieve                # noqa: E402
from app.retrieval.query_builder import build_query       # noqa: E402

TOP_K = 8   # los pasajes que de verdad llegan al juez y a la respuesta

# --- El árbol MeSH: lo que convierte la verdad en JERÁRQUICA -----------------------------------
# La primera versión de este script exigía que el descriptor objetivo apareciera EXACTO entre los
# recuperados, y eso resultó demasiado estricto: MeSH es un árbol. Un documento indexado como
# "Mitral Valve Insufficiency" (C14.280.484.048.750) SÍ cubre una consulta sobre "Heart Valve
# Diseases" (C14.280.484), porque es un caso particular de eso. Con la regla exacta, esos casos
# salían "no cubierto" y el juez quedaba castigado por acertar — se vio en las discrepancias:
# heart-valve-diseases, cardiomyopathy-dilated, liver-diseases, renal-insufficiency-chronic.
#
# Los números de árbol salen de `corpus_mesh_clasificado.tsv` (6.145 descriptores del corpus). Es el
# árbol MeSH publicado: cualquiera puede verificar que C14.280.484.048.750 cuelga de C14.280.484.
TSV_MESH = os.path.join(SCRATCH, "corpus_mesh_clasificado.tsv")


def _arbol_mesh() -> dict:
    """{descriptor en minúscula -> [números de árbol]}."""
    arbol = {}
    try:
        with open(TSV_MESH, encoding="utf-8") as f:
            for linea in f:
                partes = linea.rstrip("\n").split("\t")
                if len(partes) >= 4 and partes[3]:
                    arbol[partes[0].strip().lower()] = [t.strip() for t in partes[3].split(",")
                                                        if t.strip()]
    except OSError:
        pass
    return arbol


ARBOL = _arbol_mesh()


def _frases(objetivo: str) -> list[str]:
    """Formas en que el descriptor aparece escrito en el texto.

    MeSH invierte los términos para ordenar alfabéticamente: "Neoplasms, Plasma Cell" se escribe
    "plasma cell neoplasms" en prosa. Se prueban las dos formas y el calificador solo.
    """
    o = objetivo.strip().lower()
    formas = [o]
    if "," in o:
        partes = [p.strip() for p in o.split(",")]
        formas.append(" ".join(reversed(partes)))       # "plasma cell neoplasms"
        if len(partes[-1]) >= 6:
            formas.append(partes[-1])                    # "plasma cell"
    return [f for f in dict.fromkeys(formas) if len(f) >= 6]


def cubre_por_texto(objetivo: str, textos: list) -> tuple[bool, str]:
    """¿El texto recuperado NOMBRA la condición aunque no lleve la etiqueta MeSH?

    Hace falta porque el etiquetado MeSH del corpus es INCOMPLETO, y eso sesga la verdad hacia "no
    cubierto". Ejemplo real: los pasajes de `neg-impetigo` describen impétigo canino con ese nombre,
    pero ningún chunk recuperado lleva el descriptor `Impetigo`. Castigar al juez ahí es medir mal
    el etiquetado, no la abstención.

    Sigue siendo determinístico y verificable: es buscar una frase en un texto.
    """
    blob = " ".join(textos).lower()
    for f in _frases(objetivo):
        if f in blob:
            return True, f"el texto dice '{f}' (sin etiqueta MeSH)"
    return False, ""


def cubre(objetivo: str, recuperados: set) -> tuple[bool, str]:
    """¿Alguno de los descriptores recuperados ES el objetivo o cuelga de él?

    Devuelve (cubre, por_qué) para que cada decisión quede justificada y auditable.
    """
    if not objetivo:
        return False, "sin descriptor objetivo"
    if objetivo in recuperados:
        return True, "descriptor exacto"
    ramas = ARBOL.get(objetivo) or []
    if not ramas:
        return False, "el objetivo no está en el árbol"
    for d in recuperados:
        for t in ARBOL.get(d) or []:
            for raiz in ramas:
                if t.startswith(raiz + "."):
                    return True, f"{d} ({t}) cuelga de {raiz}"
    return False, "ningún descriptor recuperado cuelga del objetivo"


def _mesh_de(chunk) -> set:
    md = getattr(chunk, "metadata", None) or {}
    valores = md.get("mesh") or []
    if isinstance(valores, str):
        valores = [valores]
    return {str(v).strip().lower() for v in valores if v}


# Descriptores de especie: aparecen en decenas de miles de chunks y coinciden con cualquier consulta
# del mismo animal, así que como señal de cobertura no valen nada. Ya mordió antes: el score
# determinístico estaba saturado justamente porque "Dogs" contaba como evidencia temática.
ESPECIE_MESH = {"dogs", "cats", "cattle", "horses", "swine", "sheep", "goats", "rabbits",
                "birds", "ferrets", "animals", "animals, domestic", "pets"}


def medir(caso: dict, con_juez: bool) -> dict:
    objetivo = (caso.get("mesh_target") or "").strip().lower()
    q = build_query(caso["query"], caso.get("especie"))
    chunks, passed = retrieve(q)
    top = chunks[:TOP_K]

    mesh_recuperado = set()
    for c in top:
        mesh_recuperado |= _mesh_de(c)
    cubierto, porque = cubre(objetivo, mesh_recuperado)
    if not cubierto:
        cubierto, porque_txt = cubre_por_texto(objetivo, [(c.content or "") for c in top])
        porque = porque_txt or porque

    # SEÑAL DISPONIBLE EN TIEMPO DE CONSULTA: en producción no se conoce `mesh_target` (es la
    # respuesta). Lo que sí se tiene son los descriptores a los que destiló la consulta (A->B).
    # ¿Alguno de ellos está indexado en la literatura recuperada?
    q_mesh = {str(m).strip().lower() for m in (getattr(q, "mesh", None) or [])} - ESPECIE_MESH
    solape = q_mesh & (mesh_recuperado - ESPECIE_MESH)

    fila = {
        "id": caso["id"],
        "mesh_target": caso.get("mesh_target"),
        "etiqueta_banco": "negativo" if caso.get("negativo") else "positivo",
        "VERDAD_cubierto": cubierto,
        "VERDAD_porque": porque,
        "mesh_recuperado": sorted(mesh_recuperado)[:40],
        "SENAL_solape": sorted(solape)[:5],
        "SENAL_hay_solape": bool(solape),
        "q_mesh": sorted(q_mesh)[:8],
        "passed": passed,
        "n_chunks": len(top),
        "descriptores_distintos": len(mesh_recuperado),
    }
    if con_juez:
        v = judge_evidence(caso["query"], chunks)
        fila.update(banda=v.band, puntaje=v.score, juzgado=v.judged,
                    seg=v.seconds, motivo=v.reason)
    return fila


def muestra(casos: list, n: int) -> list:
    if n <= 0 or n >= len(casos):
        return casos
    paso = len(casos) / n
    return [casos[int(i * paso)] for i in range(n)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=0, help="casos por grupo (0 = todos)")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--sin-juez", action="store_true", help="sólo la verdad mecánica (gratis)")
    ap.add_argument("--salida", default="abstencion_verdad.json")
    ap.add_argument("--reusar-juez", default="", metavar="JSON",
                    help="toma los puntajes de una corrida previa en vez de volver a pagar el juez")
    args = ap.parse_args()

    def log(m):
        print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)

    g = os.path.join(BASE, "tests", "golden")
    pos = muestra(json.load(open(os.path.join(g, "ampliado.json"), encoding="utf-8")), args.n)
    neg = muestra(json.load(open(os.path.join(g, "ampliado_negativos.json"), encoding="utf-8")),
                  args.n)
    for c in neg:
        c["negativo"] = True

    s = get_settings()
    log(f"{len(pos)} positivos + {len(neg)} negativos | cortes none<={s.judge_abstain_max} "
        f"limited<={s.judge_limited_max} | juez={'no' if args.sin_juez else s.judge_model_name}")

    filas = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(medir, c, not args.sin_juez): c for c in pos + neg}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                filas.append(fut.result())
            except Exception as e:  # noqa: BLE001
                log(f"  {futs[fut]['id']} falló: {e}")
            if i % 20 == 0:
                log(f"  {i}/{len(pos) + len(neg)}")

    if args.reusar_juez:
        previos = {f["id"]: f for f in json.load(
            open(os.path.join(SCRATCH, args.reusar_juez), encoding="utf-8"))}
        reusados = 0
        for f in filas:
            p = previos.get(f["id"])
            if p and p.get("puntaje") is not None:
                f.update(banda=p.get("banda"), puntaje=p["puntaje"], juzgado=p.get("juzgado"),
                         seg=p.get("seg"), motivo=p.get("motivo"))
                reusados += 1
        log(f"puntajes del juez reusados: {reusados}/{len(filas)}")

    ruta = os.path.join(SCRATCH, args.salida)
    json.dump(filas, open(ruta, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    reportar(filas, con_juez=(not args.sin_juez) or bool(args.reusar_juez))
    print(f"\ndetalle -> scripts/calidad/{args.salida}")


def reportar(filas: list, con_juez: bool) -> None:
    cub = [f for f in filas if f["VERDAD_cubierto"]]
    nocub = [f for f in filas if not f["VERDAD_cubierto"]]
    print("\n" + "=" * 78)
    print("LA VERDAD MECÁNICA (¿hay un documento con el descriptor objetivo entre los recuperados?)")
    print("=" * 78)
    print(f"  CUBIERTO     : {len(cub):3}   -> lo correcto es responder")
    print(f"  NO CUBIERTO  : {len(nocub):3}   -> lo correcto es abstenerse o declarar limitada")

    print("\n  Cuánto se parece la etiqueta del banco a la verdad:")
    for etiqueta in ("positivo", "negativo"):
        grupo = [f for f in filas if f["etiqueta_banco"] == etiqueta]
        if not grupo:
            continue
        de_acuerdo = sum(1 for f in grupo
                         if f["VERDAD_cubierto"] == (etiqueta == "positivo"))
        print(f"    banco dice {etiqueta:9}: coincide en {de_acuerdo}/{len(grupo)} "
              f"({100 * de_acuerdo / len(grupo):.0f}%)")

    # ---- la señal que SÍ se puede calcular en producción ----
    con_solape = [f for f in filas if f.get("SENAL_hay_solape")]
    ok_solape = sum(1 for f in filas if f.get("SENAL_hay_solape") == f["VERDAD_cubierto"])
    print("\n  Señal determinística disponible en tiempo de consulta")
    print("  (¿algún descriptor al que destiló la consulta está indexado en lo recuperado?):")
    print(f"    dispara en            : {len(con_solape)}/{len(filas)}")
    print(f"    coincide con la verdad: {ok_solape}/{len(filas)} "
          f"({100 * ok_solape / max(len(filas), 1):.0f}%)")
    vp = sum(1 for f in filas if f.get("SENAL_hay_solape") and f["VERDAD_cubierto"])
    fp = sum(1 for f in filas if f.get("SENAL_hay_solape") and not f["VERDAD_cubierto"])
    fn = sum(1 for f in filas if not f.get("SENAL_hay_solape") and f["VERDAD_cubierto"])
    print(f"    precisión             : {vp}/{vp + fp} = {100 * vp / max(vp + fp, 1):.0f}%")
    print(f"    cobertura             : {vp}/{vp + fn} = {100 * vp / max(vp + fn, 1):.0f}%")

    if not con_juez:
        return

    s = get_settings()
    A, L = s.judge_abstain_max, s.judge_limited_max
    aciertos = duros = suaves = 0
    discrepancias = []
    for f in filas:
        p = f.get("puntaje")
        if p is None:
            continue
        banda = "none" if p <= A else ("limited" if p <= L else "sufficient")
        if f["VERDAD_cubierto"]:
            bien = banda != "none"          # responder (con o sin aviso) es correcto
            if not bien:
                duros += 1
        else:
            bien = banda != "sufficient"    # abstenerse o avisar es correcto
            if not bien:
                suaves += 1
        aciertos += bien
        if not bien:
            discrepancias.append((f, banda))

    total = sum(1 for f in filas if f.get("puntaje") is not None)
    print("\n" + "=" * 78)
    print("EL JUEZ, MEDIDO CONTRA ESA VERDAD")
    print("=" * 78)
    print(f"  ACIERTO                                   : {aciertos}/{total} = "
          f"{100 * aciertos / max(total, 1):.1f}%")
    print(f"  se abstuvo teniendo literatura (grave)    : {duros}")
    print(f"  respondió sin tener literatura (grave)    : {suaves}")

    # ---- ¿mejora combinando el juez con la señal determinística? ----
    def evaluar(regla) -> tuple[int, int, int]:
        ok = duro = suave = 0
        for f in filas:
            p = f.get("puntaje")
            if p is None:
                continue
            banda = regla(p, bool(f.get("SENAL_hay_solape")))
            if f["VERDAD_cubierto"]:
                bien = banda != "none"
                duro += not bien
            else:
                bien = banda != "sufficient"
                suave += not bien
            ok += bien
        return ok, duro, suave

    def base(p, _s):
        return "none" if p <= A else ("limited" if p <= L else "sufficient")

    def con_freno(p, hay):
        """Sin descriptor coincidente no se responde con plena confianza: baja a `limited`."""
        b = base(p, hay)
        return "limited" if (b == "sufficient" and not hay) else b

    def con_rescate(p, hay):
        """Con descriptor coincidente no se calla del todo: sube de `none` a `limited`."""
        b = base(p, hay)
        return "limited" if (b == "none" and hay) else b

    def con_ambos(p, hay):
        return con_freno(p, hay) if not hay else con_rescate(p, hay)

    print("\n" + "=" * 78)
    print("¿MEJORA COMBINAR EL JUEZ CON LA SEÑAL DETERMINÍSTICA?")
    print("=" * 78)
    print(f"  {'regla':34} {'acierto':>16}  {'calla de más':>12}  {'responde de más':>15}")
    for nombre, regla in (("juez solo (hoy)", base),
                          ("+ freno (sin descriptor -> limited)", con_freno),
                          ("+ rescate (con descriptor -> limited)", con_rescate),
                          ("+ freno y rescate", con_ambos)):
        ok, duro, suave = evaluar(regla)
        print(f"  {nombre:34} {ok:6}/{total} = {100 * ok / max(total, 1):5.1f}%  "
              f"{duro:12}  {suave:15}")

    if discrepancias:
        print("\n  DISCREPANCIAS del juez solo — para revisar a mano:")
        for f, banda in sorted(discrepancias, key=lambda x: x[0]["id"])[:40]:
            verdad = "CUBIERTO" if f["VERDAD_cubierto"] else "no cubierto"
            print(f"    {f['id'][:34]:34} verdad={verdad:12} juez={banda:10} "
                  f"({f['puntaje']}) {str(f.get('motivo') or '')[:58]}")


if __name__ == "__main__":
    main()
