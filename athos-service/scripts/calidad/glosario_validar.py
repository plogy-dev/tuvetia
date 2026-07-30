# -*- coding: utf-8 -*-
"""Glosario paso 3: VALIDA lo propuesto y lo deja listo para sembrar. Solo lectura por defecto.

Guardas determinísticas (cada una nace de un riesgo real del retrieval):
 1. Frecuencia alta -> el mesh no discrimina. 'Dog Diseases' está en el 8% del corpus: si entra
    como concepto, `mesh_hit` se enciende en 41k chunks y el TIER1_LIMIT=40 se llena de ruido.
 2. Palabra genérica/ambigua -> falso positivo en consultas de otra condición (el match es por
    frase completa, pero 'sangre' es frase completa).
 3. Sinónimo demasiado corto -> mismo problema.
 4. Colisión: el mismo sinónimo apuntando a dos canonical_en distintos mete conceptos
    contradictorios en la misma query.
 5. Choque con lo ya approved (curado a mano): gana lo curado, siempre.

Uso: python glosario_validar.py [--max-chunks N] [--out archivo.json]
"""
import argparse
import json
import os
import sys
from collections import Counter, defaultdict

SCRATCH = os.path.dirname(os.path.abspath(__file__))  # datos del banco, junto a estos scripts
BASE = os.path.dirname(os.path.dirname(SCRATCH))  # scripts/calidad -> athos-service
sys.path.insert(0, BASE)
os.chdir(BASE)

import psycopg  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.glossary.resolve import _normalize  # noqa: E402

# Palabras que NUNCA pueden ser un sinónimo por sí solas: aparecen en consultas de cualquier
# condición. (Como frase dentro de algo más específico sí valen: 'sangre en las heces'.)
GENERICAS = {
    "sangre", "dolor", "orina", "piel", "come", "agua", "ojo", "ojos", "pata", "patas", "boca",
    "oreja", "orejas", "cabeza", "pelo", "peso", "fiebre", "infeccion", "inflamacion", "herida",
    "tumor", "tumores", "cancer", "masa", "bulto", "diagnostico", "tratamiento", "pronostico",
    "enfermedad", "enfermedades", "sintomas", "signos", "animal", "animales", "perro", "perros",
    "gato", "gatos", "mascota", "mascotas", "cachorro", "paciente", "consulta", "examen",
    "analisis", "estudio", "prueba", "muestra", "vacuna", "vacunas", "medicamento", "medicamentos",
    "farmaco", "farmacos", "dosis", "terapia", "cirugia", "control", "revision", "cronico",
    "aguda", "agudo", "cronica", "grave", "leve", "severo", "severa",
}
MIN_LEN = 4


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-chunks", type=int, default=5000,
                    help="descriptores con más chunks que esto no discriminan; se descartan")
    ap.add_argument("--out", default=os.path.join(SCRATCH, "glosario_validado.json"))
    args = ap.parse_args()

    freq, clase, arbol = {}, {}, {}
    with open(os.path.join(SCRATCH, "corpus_mesh_clasificado.tsv"), encoding="utf-8") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            freq[p[0]] = int(p[1])
            clase[p[0]] = p[2]
            arbol[p[0]] = [t for t in (p[3].split(",") if len(p) > 3 else []) if t]

    # Ramas que NO son "algo que el vet busca" aunque cuelguen de C: metodología de investigación
    # (E05, modelos animales), pronóstico/outcome (E01.789), factores biológicos abstractos (D23).
    RAMAS_FUERA = ("E05", "E01.789", "D23")

    def descartar_descriptor(en):
        tns = arbol.get(en, [])
        if freq.get(en, 0) > args.max_chunks:
            return "descriptor_no_discrimina"
        if clase.get(en) == "anatomia":
            # 'Feces' -> 'caca'/'popo' dispararía en casi cualquier consulta. La anatomía es
            # modificador, no concepto de búsqueda: queda fuera de esta primera pasada.
            return "anatomia_fuera_de_pasada"
        if any(t.startswith(RAMAS_FUERA) for t in tns):
            return "rama_metodologica"
        if tns and min(t.count(".") for t in tns) == 0:
            return "categoria_tope"  # p.ej. 'Neoplasms' (C04): encabezado de árbol, no un concepto
        return None

    propuesto = []
    with open(os.path.join(SCRATCH, "glosario_propuesto.jsonl"), encoding="utf-8") as f:
        for line in f:
            try:
                propuesto.append(json.loads(line))
            except Exception:  # noqa: BLE001 — línea a medias de una corrida cortada
                pass

    # Lo ya approved manda: nunca lo pisamos.
    conn = psycopg.connect(get_settings().database_url)
    with conn.cursor() as cur:
        cur.execute("select s.text, t.canonical_en from public.glossary_synonym s "
                    "join public.glossary_term t on t.id = s.term_id where s.review_status='approved'")
        ya_approved = {_normalize(t): c for t, c in cur.fetchall()}
    conn.close()

    rechazos = Counter()
    por_syn = defaultdict(set)      # sinónimo normalizado -> {canonical_en}
    limpio = defaultdict(list)      # canonical_en -> [(syn, registro)]

    for r in propuesto:
        en = r["en"]
        motivo = descartar_descriptor(en)
        if motivo:
            rechazos[motivo] += 1
            continue
        for registro in ("tecnico", "coloquial"):
            for syn in r.get(registro) or []:
                n = _normalize(syn)
                if not n:
                    rechazos["vacio"] += 1
                    continue
                if len(n) < MIN_LEN:
                    rechazos["muy_corto"] += 1
                    continue
                if n in GENERICAS:
                    rechazos["generica"] += 1
                    continue
                if n in ya_approved:
                    if ya_approved[n] != en:
                        rechazos["choca_con_curado"] += 1
                    else:
                        rechazos["ya_existe"] += 1
                    continue
                if any(prev == n for prev, _ in limpio[en]):
                    rechazos["duplicado"] += 1
                    continue
                por_syn[n].add(en)
                limpio[en].append((n, registro))

    # Colisiones: el mismo sinónimo apuntando a >1 concepto. Tirarlo de TODOS pierde el sinónimo
    # obvio ('leishmaniasis' colisiona entre Leishmaniasis y Leishmaniasis, Visceral y se perdía
    # el bueno). Se ADJUDICA a un dueño: (1) el descriptor cuyo nombre EN normalizado coincide con
    # el sinónimo (cognado exacto), (2) si no, el de mayor cobertura en el corpus.
    dueno = {}
    for n, ens in por_syn.items():
        if len(ens) == 1:
            dueno[n] = next(iter(ens))
            continue
        exactos = [e for e in ens if _normalize(e) == n]
        dueno[n] = exactos[0] if exactos else max(ens, key=lambda e: freq.get(e, 0))

    final = defaultdict(list)
    for en, syns in limpio.items():
        for n, registro in syns:
            if dueno.get(n) != en:
                rechazos["colision_adjudicada_a_otro"] += 1
                continue
            final[en].append({"syn": n, "registro": registro})
    colisiones = {n for n, ens in por_syn.items() if len(ens) > 1}
    final = {en: s for en, s in final.items() if s}

    total_syn = sum(len(s) for s in final.values())
    print(f"propuestos       : {len(propuesto):,} descriptores")
    print(f"ACEPTADOS        : {len(final):,} descriptores / {total_syn:,} sinónimos")
    print("rechazos:")
    for k, v in rechazos.most_common():
        print(f"   {k:26s} {v:,}")
    print(f"colisiones distintas: {len(colisiones):,}  ej: {sorted(colisiones)[:8]}")

    salida = [{"canonical_en": en, "mesh": en, "chunks": freq.get(en, 0),
               "sinonimos": s} for en, s in
              sorted(final.items(), key=lambda kv: -freq.get(kv[0], 0))]
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, indent=1)
    print(f"\n-> {args.out}")
    print("\nmuestra (top 10 por cobertura):")
    for item in salida[:10]:
        print(f"  {item['chunks']:6,}  {item['canonical_en']}: "
              f"{[s['syn'] for s in item['sinonimos']][:6]}")


if __name__ == "__main__":
    main()
