# -*- coding: utf-8 -*-
"""¿El chat DECLARA lo que no está en la literatura? Análisis determinístico, sin gastar un token.

La regla 2 de `CHAT_SYSTEM` exige que toda afirmación clínica que no venga de la literatura lleve el
prefijo "Criterio clínico (no está en la literatura recuperada):". Es una **regla dura confiada al
prompt**, y en este proyecto eso ya falló de forma medida: con la regla de dosis escrita en el prompt
las cifras pasaron de 2/23 a 9/23 (`app/generation/dose_guard.py`). Así que hay que medirla, no
suponerla.

Por qué importa más de lo que parece: `citation_fidelity` audita las frases CON cita — verifica que el
pasaje sostenga lo afirmado — y **por diseño ignora las frases sin cita** ("no fingen respaldo, así que
no hay nada que auditar"). Eso es cierto para una frase que declara ser criterio clínico. Pero una
afirmación clínica sin cita y **sin declarar** cae en un hueco: el veterinario no puede distinguir "esto
lo dice la literatura" de "esto lo cree el modelo". No finge respaldo — simplemente no dice nada, y se
lee como establecido.

Reutiliza respuestas YA generadas (`respuestas_*.json`), así que no cuesta nada correrlo.

Uso:
  python scripts/calidad/chat_declaracion.py --archivo respuestas_final.json
"""
import argparse
import json
import os
import re
import sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

from app.glossary.resolve import (  # noqa: E402
    _load_approved_synonyms,
    match_concepts,
)

# ⚠️ La PRIMERA versión de este script medía otra cosa y daba 57 %, un número que no significaba nada.
# Contaba como "afirmación sin respaldo" toda oración clínica sin cita, y al mirar la muestra a mano
# resultó que la mayoría eran: (a) reformulaciones del caso que el propio veterinario acababa de
# contar, (b) razonamiento clínico —priorizar diferenciales es el trabajo, no una afirmación de
# hecho—, y (c) andamiaje ("mis diferenciales, ordenados por probabilidad, son:"). Exigir "Criterio
# clínico:" delante de cada frase de razonamiento haría la respuesta ilegible, y no es lo que pide la
# regla 2: la regla apunta a lo que el veterinario puede EJECUTAR y que puede estar flatamente mal —
# "sobre todo fármacos, dosis, tiempos o cifras".
#
# Así que se mide eso y sólo eso: FÁRMACOS y CIFRAS afirmados sin cita y sin declarar. Es un número
# más chico y accionable, en vez de uno grande que mezcla el defecto con el comportamiento correcto.
_CITA_RE = re.compile(r"\[\d{1,2}(?:\s*,\s*\d{1,2})*\]")

# Cifras que un veterinario podría ejecutar: dosis, duración, frecuencia, porcentaje, valor de
# laboratorio. Se excluyen las que sólo reformulan el caso ("hace 2 días", "de 3 años").
_CIFRA_ACCIONABLE_RE = re.compile(
    r"\d+(?:[.,]\d+)?\s*(?:%|mg|mcg|µg|ug|\bg\b|ml|l\b|ui\b|u\b|meq|"
    r"mg\s*/\s*kg|/\s*kg|"                                     # dosis
    r"(?:veces|vez)\s+(?:al|por)\s+(?:día|dia|hora)|"           # frecuencia
    r"(?:cada)\s+\d+\s*(?:h|horas|días|dias)|"
    r"(?:durante|por)\s+\d+\s*(?:días|dias|semanas|meses))",
    re.IGNORECASE)
_CADA_N_RE = re.compile(r"\bcada\s+\d+\s*(?:h\b|horas|días|dias)", re.IGNORECASE)
_DURANTE_N_RE = re.compile(r"\b(?:durante|por)\s+\d+\s*(?:días|dias|semanas|meses)", re.IGNORECASE)

# Nombres de fármaco por terminación: en español los principios activos son muy regulares y esto es
# mucho más fiable que una lista cerrada, que envejece.
_FARMACO_RE = re.compile(
    r"\b\w{4,}(?:azol|azoles|micina|micinas|ciclina|ciclinas|cilina|cilinas|profeno|oxacino|"
    r"oxacina|pramida|prazol|tidina|dipropionato|sulfona|sulfamid|quantel|antel|ivermectina|"
    r"prednisolona|prednisona|dexametasona|meloxicam|carprofeno|tramadol|gabapentina|furosemida|"
    r"pimobendan|benazepril|enalapril|omeprazol|maropitant|ondansetron|imidocarb|doxiciclina|"
    r"fluralaner|afoxolaner|sarolaner|milbemicina|praziquantel|fenbendazol|metronidazol)\w*\b",
    re.IGNORECASE)
_SPLIT_RE = re.compile(r"(?<=[.!?;])\s+|\n+")
# La marca que pide la regla 2. Se acepta cualquier variante razonable: lo que importa es que el
# veterinario vea que eso NO viene de la literatura, no la puntuación exacta.
_MARCA_RE = re.compile(
    r"criterio\s+cl[ií]nico|no\s+est[áa]\s+en\s+la\s+literatura|"
    r"sin\s+respaldo\s+en\s+la\s+literatura|no\s+aparece\s+en\s+la\s+literatura",
    re.IGNORECASE)
# Frases que no afirman un hecho clínico: preguntas, pedidos y andamiaje de la respuesta.
_NO_AFIRMA_RE = re.compile(
    r"^\s*[-*•\d.]*\s*(¿|pedí|pedile|solicit|confirm|preguntá|necesito saber|indicá|"
    r"si\s+(el|la|hay)|cuando|en\s+cuanto)", re.IGNORECASE)
MIN_CHARS = 30


def _es_accionable(frase: str) -> str | None:
    """¿La oración afirma algo EJECUTABLE — un fármaco o una cifra clínica? Devuelve qué, o None."""
    if _FARMACO_RE.search(frase):
        return "fármaco"
    if _CIFRA_ACCIONABLE_RE.search(frase) or _CADA_N_RE.search(frase) or _DURANTE_N_RE.search(frase):
        return "cifra"
    return None


def clasifica(respuesta: str, sinonimos: list[dict]) -> dict:
    """Clasifica cada oración de la respuesta. Determinístico."""
    citadas, declaradas, sin_declarar, no_clinicas = [], [], [], []
    accionables_sin_respaldo: list[str] = []
    # La marca puede encabezar un bloque y aplicar a lo que sigue (el modelo escribe
    # "Criterio clínico (...): a, b y c"), así que se arrastra hasta el próximo salto de párrafo.
    for parrafo in re.split(r"\n\s*\n", respuesta or ""):
        marca_activa = bool(_MARCA_RE.search(parrafo))
        for frase in _SPLIT_RE.split(parrafo):
            limpia = frase.strip()
            if len(limpia) < MIN_CHARS:
                continue
            if _CITA_RE.search(limpia):
                citadas.append(limpia)
            elif marca_activa or _MARCA_RE.search(limpia):
                declaradas.append(limpia)
            elif _NO_AFIRMA_RE.match(limpia):
                no_clinicas.append(limpia)
            else:
                # ¿Nombra algún concepto clínico del glosario? Si no, es andamiaje y no una
                # afirmación clínica: no tiene sentido exigirle declaración.
                sin_cita = _CITA_RE.sub("", limpia)
                if match_concepts(sin_cita, None, sinonimos).concepts:
                    sin_declarar.append(limpia)
                    # El subconjunto que de verdad importa: sin cita, sin declarar, y EJECUTABLE.
                    tipo = _es_accionable(limpia)
                    if tipo:
                        accionables_sin_respaldo.append(f"[{tipo}] {limpia}")
                else:
                    no_clinicas.append(limpia)
    return {"citadas": citadas, "declaradas": declaradas,
            "sin_declarar": sin_declarar, "no_clinicas": no_clinicas,
            "accionables_sin_respaldo": accionables_sin_respaldo}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--archivo", default="respuestas_final.json")
    ap.add_argument("--mostrar", type=int, default=10)
    args = ap.parse_args()

    d = json.load(open(os.path.join(SCRATCH, args.archivo), encoding="utf-8"))
    casos = d["casos"] if isinstance(d, dict) else d
    sinonimos = _load_approved_synonyms()
    print(f"{len(casos)} respuestas de {args.archivo} · glosario: {len(sinonimos)} sinónimos approved\n")

    filas = []
    for c in casos:
        texto = c.get("respuesta") or c.get("answer") or c.get("texto") or ""
        if not texto.strip():
            continue
        r = clasifica(texto, sinonimos)
        filas.append({"id": c.get("id"), "abstuvo": c.get("abstuvo"),
                      **{k: len(v) for k, v in r.items()},
                      "ejemplos_sin_declarar": r["sin_declarar"][:3],
                      "ejemplos_accionables": r["accionables_sin_respaldo"][:3]})

    activas = [f for f in filas if not f["abstuvo"]]
    tot_cit = sum(f["citadas"] for f in activas)
    tot_dec = sum(f["declaradas"] for f in activas)
    tot_sin = sum(f["sin_declarar"] for f in activas)
    con_sin = sum(1 for f in activas if f["sin_declarar"])

    print("=" * 84)
    print("¿EL CHAT DECLARA LO QUE NO ESTÁ EN LA LITERATURA?")
    print("=" * 84)
    print(f"  respuestas analizadas (sin las que se abstuvieron): {len(activas)}")
    print(f"\n  afirmaciones clínicas CON cita  (las audita citation_fidelity) : {tot_cit}")
    print(f"  afirmaciones DECLARADAS como criterio clínico                  : {tot_dec}")
    print(f"  afirmaciones clínicas SIN cita y SIN declarar                  : {tot_sin}"
          f"   <-- el hueco")
    base = tot_cit + tot_dec + tot_sin
    if base:
        print(f"\n  proporción del hueco sobre el total de afirmaciones clínicas   : "
              f"{100 * tot_sin / base:.0f}%")
    print(f"  respuestas con AL MENOS UNA sin declarar                       : "
          f"{con_sin}/{len(activas)}")
    print(f"  respuestas que usan la marca alguna vez                        : "
          f"{sum(1 for f in activas if f['declaradas'])}/{len(activas)}")

    print("  (⚠️ ese 'hueco' NO es una tasa de defecto: en su mayoría son razonamiento clínico y")
    print("   reformulación del caso que el vet contó. Ver el comentario al inicio del archivo.)")

    tot_acc = sum(f["accionables_sin_respaldo"] for f in activas)
    con_acc = sum(1 for f in activas if f["accionables_sin_respaldo"])
    print("\n  " + "-" * 78)
    print("  EL NÚMERO QUE IMPORTA — afirmaciones EJECUTABLES (fármaco o cifra) sin cita y sin")
    print("  declarar: lo que el veterinario puede administrar y que puede estar flatamente mal.")
    print("  " + "-" * 78)
    print(f"    afirmaciones ejecutables sin respaldo ni declaración : {tot_acc}")
    print(f"    respuestas con al menos una                         : {con_acc}/{len(activas)}")

    print("\n  LAS EJECUTABLES SIN RESPALDO (revisar a mano una por una):")
    for f in sorted(activas, key=lambda x: -x["accionables_sin_respaldo"])[:args.mostrar]:
        if not f["ejemplos_accionables"]:
            continue
        print(f"    {f['id']}  ({f['accionables_sin_respaldo']})")
        for e in f["ejemplos_accionables"]:
            print(f"       - {e[:150]}")

    destino = os.path.join(SCRATCH, "chat_declaracion.json")
    json.dump(filas, open(destino, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n  -> {destino}")


if __name__ == "__main__":
    main()
