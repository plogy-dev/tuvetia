# -*- coding: utf-8 -*-
"""Re-etiqueta los roles de las transcripciones YA emitidas. **Dry-run por defecto.**

Por qué hace falta: hasta el 2026-07-29 el rol se asignaba por convención ("hablante 0 = veterinario")
y el dueño suele abrir la consulta, así que **el diálogo quedó invertido** en las transcripciones
existentes. Peor: la etiqueta se escribe DENTRO de `transcripts.full_text`, así que no se puede
corregir al mostrarla. El dato crudo sí se conservó en `transcripts.segments` (con el `speaker`
original de Deepgram), así que la corrección es posible.

Qué hace: recalcula el rol con `app.speaker_roles` (determinístico, sin LLM) y reescribe `full_text`
y las etiquetas de `segments`. **Sólo toca las transcripciones donde la inferencia es confiable y el
resultado CAMBIA** — si no hay señal clara, se deja como está.

Uso:
  python scripts/calidad/transcripts_reetiquetar.py             # dry-run: informa, no escribe
  python scripts/calidad/transcripts_reetiquetar.py --aplicar   # escribe (pedir autorización)
"""
import argparse
import json
import os
import sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

from psycopg.types.json import Json  # noqa: E402

from app.db import fetch_all, get_conn  # noqa: E402
from app.speaker_roles import infer_vet_speaker, label_for  # noqa: E402
from app.transcription import render_full_text  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true", help="escribe los cambios (por defecto no)")
    args = ap.parse_args()

    filas = fetch_all(
        "select id, clinic_id, consultation_id, full_text, segments from public.transcripts "
        "where segments is not null order by created_at"
    )
    print(f"{len(filas)} transcripciones con segments\n")

    cambios, sin_señal, iguales = [], 0, 0
    for r in filas:
        segs = r["segments"]
        if isinstance(segs, str):
            segs = json.loads(segs)
        if not isinstance(segs, list) or not segs:
            continue
        vet, confiable = infer_vet_speaker(segs)
        if not confiable:
            sin_señal += 1
            continue
        hablantes = len({s.get("speaker", 0) for s in segs})
        nuevos = [{**s, "label": label_for(s.get("speaker", 0), vet, hablantes),
                   "role_inferred": True} for s in segs]
        nuevo_texto = render_full_text(nuevos, r["full_text"] or "")
        if nuevo_texto == (r["full_text"] or ""):
            iguales += 1
            continue
        cambios.append((r["id"], nuevos, nuevo_texto, r["full_text"] or ""))

    print(f"  a corregir (roles invertidos) : {len(cambios)}")
    print(f"  ya correctas                  : {iguales}")
    print(f"  sin señal (se dejan como están): {sin_señal}")

    for tid, _n, nuevo, viejo in cambios[:5]:
        print(f"\n  --- {tid} ---")
        print(f"    ANTES : {viejo[:150]}")
        print(f"    DESPUÉS: {nuevo[:150]}")

    if not args.aplicar:
        print("\n  DRY-RUN: no se escribió nada. Usá --aplicar para corregir "
              "(requiere autorización: modifica datos clínicos existentes).")
        return

    with get_conn() as conn, conn.cursor() as cur:
        for tid, nuevos, nuevo_texto, _v in cambios:
            cur.execute(
                "update public.transcripts set full_text = %s, segments = %s where id = %s",
                (nuevo_texto, Json(nuevos), tid),
            )
        conn.commit()
    print(f"\n  {len(cambios)} transcripciones corregidas.")


if __name__ == "__main__":
    main()
