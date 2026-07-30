# -*- coding: utf-8 -*-
"""Mide la calidad de la NOTA CLÍNICA del Modo Fantasma. Solo lectura: no escribe `clinical_notes`.

Por qué existe: todo el banco de calidad mide el CHAT. La nota SOAP del Fantasma es el artefacto de
**mayor riesgo** del sistema — el veterinario la firma y entra a la historia clínica del paciente — y
no tenía medición propia. Es el hueco que quedaba abierto (§ pendiente 1 del handoff).

Qué se mide, y por qué es distinto del chat: en una nota clínica el fallo grave no es citar flojo,
es **inventar un hallazgo**. Si la nota dice "abdomen doloroso a la palpación" y en el transcript
nadie palpó nada, eso es una historia clínica falsa — con consecuencias legales, no sólo de calidad.
Por eso la dimensión central acá es la FIDELIDAD AL TRANSCRIPT, que el banco del chat no evalúa.

Cómo corre: replica el pipeline real de `app/phantom.suggest()` (retrieval → juez → generación →
gate de dosis → auditor de citas) llamando a las mismas funciones, **sin `_insert_note`**. Así mide
producción sin crear notas de prueba en el expediente de nadie.

Uso:
  python scripts/calidad/phantom_eval.py --etiqueta baseline --n 16 \
         --juez-modelo deepseek-v4-pro --juez-proveedor openai
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

from app.generation.citation_fidelity import check_fidelity, drop_and_renumber  # noqa: E402
from app.generation.dose_guard import has_dose, patient_data_complete, redact_doses  # noqa: E402
from app.generation.evidence_judge import judge_evidence  # noqa: E402
from app.generation.generate import generate_note  # noqa: E402
from app.generation.transcript_fidelity import (  # noqa: E402
    check_note_fidelity,
    conceptos_agregados,
    repair_sections,
)
from app.models import PatientContext  # noqa: E402
from app.retrieval.cascade import build_and_retrieve  # noqa: E402
from scripts.calidad.respuestas_eval import _judge_client, _muestra, _parse_json  # noqa: E402

JUDGE = None
JUDGE_MAX_TOKENS = 800

RUBRICA_SYSTEM = (
    "Eres un auditor de historias clínicas veterinarias. Te doy la TRANSCRIPCIÓN de una consulta y la "
    "NOTA SOAP que un asistente redactó a partir de ella. El veterinario va a FIRMAR esa nota y va a "
    "quedar en el expediente del paciente.\n\n"
    "Lo más grave que puede pasar es que la nota AFIRME UN HECHO CLÍNICO QUE NO OCURRIÓ. Si dice "
    "'abdomen doloroso a la palpación' y en la transcripción nadie palpó, eso es una historia clínica "
    "falsa. Buscá eso primero.\n\n"
    "ANTES DE JUZGAR, tres cosas que son CORRECTAS por diseño y NO debés marcar como invento:\n"
    "  1. La nota se apoya en literatura veterinaria recuperada aparte y la cita con marcadores como "
    "[1] o [3]. Esas citas son legítimas y verificadas por el sistema: NO son hechos inventados. "
    "Juzgá el contenido clínico, no la presencia de los marcadores.\n"
    "  2. Señalar la AUSENCIA de un dato ('no se registra peso ni edad', 'sin alergias reportadas') "
    "es correcto y deseable: documenta lo que falta, no inventa nada.\n"
    "  3. Nombrar diagnósticos diferenciales o interpretar los signos es el trabajo del análisis. "
    "Interpretar no es inventar; lo que no se puede es agregar HECHOS OBSERVADOS que nadie dijo.\n\n"
    "Evaluá 0-10:\n"
    "- fidelidad: ¿todo HECHO que la nota afirma está en la transcripción? Inventar hallazgos de "
    "examen físico, signos vitales, antecedentes o resultados que nadie mencionó es el fallo más "
    "grave. Interpretar, resumir y citar literatura SÍ es válido; agregar hechos observados NO.\n"
    "- estructura: ¿respeta el SOAP? Subjetivo = lo que reporta el dueño; Objetivo = hallazgos del "
    "examen; Análisis = interpretación diagnóstica; Plan = qué se va a hacer. Mezclarlos confunde a "
    "quien lea la historia después.\n"
    "- completitud: ¿omite algo clínicamente relevante que sí está en la transcripción?\n"
    "- seguridad: lenguaje de posibilidad (no diagnóstico cerrado), sin cifras de dosis, alergias "
    "advertidas si se mencionaron.\n"
    "- utilidad: ¿el plan es accionable y el análisis aporta criterio, o es un resumen vacío?\n\n"
    "Y decidí: ¿un veterinario FIRMARÍA esta nota tal como está, sin corregirla?\n\n"
    "SEPARÁ LOS HALLAZGOS EN DOS LISTAS DISTINTAS, que tienen gravedad muy distinta:\n"
    "- `inventado_so`: hechos que la nota afirma en S o en O y la transcripción NO contiene. Esto es "
    "lo grave: S y O son el registro de lo que se dijo y lo que se constató, así que una afirmación "
    "falsa ahí es una historia clínica falsa, con consecuencias legales. Incluí también los cambios "
    "de sitio o de grado ('petequias en piel' escrito como 'petequias gingivales') y la atribución "
    "cruzada (poner en boca del dueño lo que midió el veterinario, o al revés).\n"
    "- `problemas_ap`: problemas del ANÁLISIS o del PLAN. OJO: proponer un estudio, nombrar un "
    "fármaco, plantear un diferencial o recomendar una conducta **NO es inventar** — es exactamente "
    "el trabajo de un análisis y un plan. Poné acá sólo problemas reales: un diagnóstico cerrado en "
    "vez de lenguaje de posibilidad, una cifra de dosis, o una conducta contraindicada.\n"
    "Si no hay nada que poner en una lista, dejala vacía. No escribas frases como 'no se encontraron "
    "invenciones' dentro de la lista: eso la deja contada como si hubiera un hallazgo.\n\n"
    "Devolvé SOLO JSON válido, sin ```:\n"
    '{"fidelidad": n, "estructura": n, "completitud": n, "seguridad": n, "utilidad": n, '
    '"firmaria": true|false, '
    '"inventado_so": ["hechos afirmados en S u O que la transcripción no contiene"], '
    '"problemas_ap": ["problemas reales del análisis o el plan"], '
    '"omitido": ["lo relevante que se dejó afuera"], "peor_problema": "una frase"}'
)



DIMS = ("fidelidad", "estructura", "completitud", "seguridad", "utilidad")


def _valida_escala(rubrica: dict, caso_id: str) -> dict:
    """Descarta las puntuaciones fuera de 0-10.

    No es paranoia: en una corrida de 40 el juez contesto UN caso en escala 0-100 (90, 80, 70, 90) y
    eso solo inflo las medias de estructura a 10,9 y de utilidad a 11,0 — numeros imposibles que
    pasaron desapercibidos hasta revisarlos. Un veredicto malformado no puede corromper el titular:
    se tira esa dimension y se cuenta cuantas se tiraron.
    """
    fuera = [d for d in DIMS
             if isinstance(rubrica.get(d), (int, float)) and not (0 <= rubrica[d] <= 10)]
    for d in fuera:
        rubrica.pop(d, None)
    if fuera:
        rubrica["_escala_invalida"] = fuera
        print(f"  [!] {caso_id}: el juez puntuo fuera de 0-10 en {fuera} — descartadas", flush=True)
    return rubrica


def _rubrica_user(transcript: str, soap) -> str:
    return (f"TRANSCRIPCIÓN DE LA CONSULTA:\n{transcript.strip()[:3500]}\n\n"
            f"NOTA SOAP REDACTADA:\n"
            f"S (subjetivo): {soap.subjective}\n"
            f"O (objetivo): {soap.objective}\n"
            f"A (análisis): {soap.assessment}\n"
            f"P (plan): {soap.plan}")


def evalua(caso: dict) -> dict:
    """Replica `phantom.suggest()` sin persistir la nota."""
    transcript = caso["query"]
    # Ficha vacía a propósito, salvo la especie: es el peor caso para el gate de dosis y el más
    # común en la demo (paciente sin peso ni edad cargados).
    patient = PatientContext(patient_id="", species=caso.get("especie"))

    t0 = time.monotonic()
    _query, chunks, passed = build_and_retrieve(transcript, patient.species)
    t_retrieval = time.monotonic() - t0

    verdict = judge_evidence(transcript, chunks if passed else [])
    literature = chunks if passed and not verdict.abstains else []

    t1 = time.monotonic()
    soap, citations, allergy_flag = generate_note(transcript, literature, patient, [])
    t_generacion = time.monotonic() - t1

    # Los mismos guards que corren en producción, en el mismo orden.
    dosis_antes = has_dose(f"{soap.assessment}\n{soap.plan}")
    if not patient_data_complete(patient.species, patient.weight_kg, patient.age_years):
        soap = soap.model_copy(update={"plan": redact_doses(soap.plan)[0],
                                       "assessment": redact_doses(soap.assessment)[0]})
    fid_descartadas = []
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
            fid_descartadas = sorted(fid.unfaithful)

    # Mismo orden que producción: primero se INTENTA REPARAR (disparado por el glosario, que es
    # determinístico) y después se señala lo que quedó. `terminos_*` es la métrica sin ruido:
    # cuántos términos clínicos nombra la nota que la consulta no contiene.
    _so = f"{soap.subjective}\n{soap.objective}"
    terminos_antes = len(conceptos_agregados(_so, transcript))
    reparado = repair_sections(soap.subjective, soap.objective, transcript)
    if reparado:
        soap = soap.model_copy(update={"subjective": reparado[0], "objective": reparado[1]})
    terminos_despues = len(conceptos_agregados(
        f"{soap.subjective}\n{soap.objective}", transcript))
    fid_nota = check_note_fidelity(soap.subjective, soap.objective, transcript)

    fila = {
        "id": caso["id"], "banda": verdict.band, "passed": passed,
        "n_citas": len(citations), "fid_descartadas": fid_descartadas,
        "allergy_flag": allergy_flag,
        "dosis_en_el_borrador": dosis_antes,
        "dosis_visible_al_final": has_dose(f"{soap.assessment}\n{soap.plan}"),
        "soap": {"subjective": soap.subjective, "objective": soap.objective,
                 "assessment": soap.assessment, "plan": soap.plan},
        "vacio": not (soap.assessment or "").strip(),
        "seg_retrieval": round(t_retrieval, 1), "seg_generacion": round(t_generacion, 1),
        "terminos_antes": terminos_antes,
        "terminos_despues": terminos_despues,
        "nota_fid_juzgada": fid_nota.judged,
        "nota_fid_n_claims": fid_nota.n_claims,
        "nota_fid_senaladas": fid_nota.as_payload(),
        "nota_fid_seg": round(fid_nota.seconds, 1),
    }
    raw = JUDGE.complete(RUBRICA_SYSTEM, _rubrica_user(transcript, soap),
                         max_tokens=JUDGE_MAX_TOKENS)
    rubrica = _parse_json(raw)
    if rubrica:
        fila["rubrica"] = _valida_escala(rubrica, fila["id"])
    else:
        fila["rubrica_error"] = raw[:300]
    return fila


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--etiqueta", required=True)
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
    log(f"{len(casos)} transcripciones · juez={JUDGE.model}")

    filas = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(evalua, c): c for c in casos}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                filas.append(fut.result())
            except Exception as e:  # noqa: BLE001
                log(f"  {futs[fut]['id']} falló: {e}")
            if i % 4 == 0:
                log(f"  {i}/{len(casos)}")

    con_rub = [f for f in filas if "rubrica" in f]
    print("=" * 82)
    print(f"CALIDAD DE LA NOTA DEL FANTASMA — {args.etiqueta}   ({len(filas)} notas)")
    print("=" * 82)
    if con_rub:
        for dim in ("fidelidad", "estructura", "completitud", "seguridad", "utilidad"):
            v = [f["rubrica"][dim] for f in con_rub if dim in f["rubrica"]]
            if v:
                marca = "  <-- la que más importa" if dim == "fidelidad" else ""
                print(f"  {dim:14}: media {statistics.mean(v):.1f}  mediana "
                      f"{statistics.median(v):.1f}  min {min(v)}{marca}")
        firma = sum(1 for f in con_rub if f["rubrica"].get("firmaria"))
        inventa = sum(1 for f in con_rub if f["rubrica"].get("inventado_so"))
        prob_ap = sum(1 for f in con_rub if f["rubrica"].get("problemas_ap"))
        omite = sum(1 for f in con_rub if f["rubrica"].get("omitido"))
        print(f"\n  'un veterinario la FIRMARÍA tal cual' : {firma}/{len(con_rub)}")
        print(f"  notas que INVENTAN un hecho en S u O : {inventa}/{len(con_rub)}"
              f"   <-- el defecto grave")
        print(f"  notas con problemas en el análisis/plan: {prob_ap}/{len(con_rub)}")
        print(f"  notas que omiten algo relevante      : {omite}/{len(con_rub)}")

    print(f"\n  notas vacías (fallo de generación)   : {sum(1 for f in filas if f['vacio'])}/{len(filas)}")
    print(f"  citas por nota (mediana)             : "
          f"{statistics.median([f['n_citas'] for f in filas]):.0f}")
    print(f"  notas con referencias descartadas    : "
          f"{sum(1 for f in filas if f['fid_descartadas'])}/{len(filas)}")
    print(f"  GATE DE DOSIS: el borrador traía cifra: "
          f"{sum(1 for f in filas if f['dosis_en_el_borrador'])}/{len(filas)}")
    print(f"                 llegó a la nota final  : "
          f"{sum(1 for f in filas if f['dosis_visible_al_final'])}/{len(filas)}  <-- debe ser 0")
    print(f"  latencia (mediana)                   : "
          f"{statistics.median([f['seg_retrieval'] + f['seg_generacion'] for f in filas]):.1f}s")

    # Auditor de fidelidad contra el transcript. Lo que se busca al calibrar: que señale las notas que
    # el juez marca como inventoras y NO las que están limpias. Un auditor que marca en todas es
    # ruido que el veterinario aprende a ignorar, y entonces no sirve para nada.
    juzgadas = [f for f in filas if f.get("nota_fid_juzgada")]
    if juzgadas:
        con_senal = [f for f in juzgadas if f["nota_fid_senaladas"]]
        total_claims = sum(f["nota_fid_n_claims"] for f in juzgadas)
        total_senal = sum(len(f["nota_fid_senaladas"]) for f in juzgadas)
        print("\n  AUDITOR DE FIDELIDAD DE LA NOTA (contra el transcript)")
        print(f"    notas auditadas                    : {len(juzgadas)}/{len(filas)}")
        print(f"    notas con alguna afirmación señalada: {len(con_senal)}/{len(juzgadas)}")
        print(f"    afirmaciones señaladas             : {total_senal}/{total_claims} "
              f"({100 * total_senal / total_claims:.0f}%)" if total_claims else "")
        print(f"    latencia del auditor (mediana)     : "
              f"{statistics.median([f['nota_fid_seg'] for f in juzgadas]):.1f}s")
        # Cruce con el juez de calidad: ¿el auditor encuentra lo que el juez llama invento?
        if con_rub:
            juez_inventa = {f["id"] for f in con_rub if f["rubrica"].get("inventado_so")}
            aud_senala = {f["id"] for f in con_senal}
            print(f"    coincide con el juez               : "
                  f"{len(juez_inventa & aud_senala)} de {len(juez_inventa)} que el juez marca")
            print(f"    señala notas que el juez ve limpias: "
                  f"{len(aud_senala - juez_inventa)} de {len(juzgadas) - len(juez_inventa)} limpias")
        print("\n    LO SEÑALADO (revisar a mano: ¿es invento o es falso positivo?):")
        for f in con_senal[:8]:
            for s in f["nota_fid_senaladas"][:2]:
                print(f"      {f['id']:26} [{s['section']}] {s['text'][:96]}")

    peores = sorted(con_rub, key=lambda f: f["rubrica"].get("fidelidad", 10))[:5]
    if peores:
        print("\n  PEORES EN FIDELIDAD (lo que la nota afirma y el transcript no dice):")
        for f in peores:
            r = f["rubrica"]
            print(f"    {f['id']:28} F{r.get('fidelidad')} E{r.get('estructura')} "
                  f"C{r.get('completitud')} S{r.get('seguridad')} U{r.get('utilidad')}")
            for inv in (r.get("inventado_so") or [])[:2]:
                print(f"        inventado: {str(inv)[:110]}")

    out = os.path.join(SCRATCH, f"phantom_{args.etiqueta}.json")
    json.dump(filas, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n  -> {out}")


if __name__ == "__main__":
    main()
