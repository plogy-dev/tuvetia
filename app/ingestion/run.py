"""CLI de ingesta:  uv run python -m app.ingestion.run --path data/corpus [--limit N]

Recorre los .md, los ingesta (idempotente por content_hash) y throttlea para no pasar el rate
limit de Cohere. Se detiene solo si Cohere alcanza su límite (p.ej. cuota trial) y reporta el total.
"""
import argparse
import pathlib
import time

from app.embeddings import EmbeddingError
from app.ingestion.pipeline import ingest_document

THROTTLE_S = 0.7  # ~85 req/min, por debajo del límite trial de Cohere (100/min)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", required=True, help="carpeta con los .md del corpus")
    ap.add_argument("--limit", type=int, default=None, help="procesar solo N archivos (prueba)")
    ap.add_argument("--throttle", type=float, default=THROTTLE_S, help="pausa entre llamadas (s)")
    args = ap.parse_args()

    md_files = sorted(pathlib.Path(args.path).rglob("*.md"))
    if args.limit:
        md_files = md_files[: args.limit]
    total = len(md_files)

    docs = chunks = skipped = 0
    stop_reason = "fin del corpus"
    for i, f in enumerate(md_files, 1):
        try:
            n = ingest_document(f.read_text(encoding="utf-8", errors="replace"))
        except EmbeddingError as e:
            stop_reason = f"límite de Cohere alcanzado: {e}"
            break
        except NotImplementedError:
            raise
        except Exception as e:  # noqa: BLE001
            skipped += 1
            print(f"[skip] {f.name}: {e}", flush=True)
            continue
        if n == 0:
            skipped += 1  # ya ingerido o vacío -> sin llamada a Cohere, sin throttle
        else:
            docs += 1
            chunks += n
            time.sleep(args.throttle)
        if i % 25 == 0:
            print(f"[{i}/{total}] docs={docs} chunks={chunks} skip={skipped}", flush=True)

    print(f"STOP: {stop_reason}", flush=True)
    print(f"Listo: {docs} documentos nuevos, {chunks} chunks, {skipped} saltados.", flush=True)


if __name__ == "__main__":
    main()
