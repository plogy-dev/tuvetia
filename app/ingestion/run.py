"""CLI de ingesta:  uv run python -m app.ingestion.run --path data/corpus [--limit N]"""
import argparse
import pathlib
from app.ingestion.pipeline import ingest_document


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", required=True, help="carpeta con los .md del corpus")
    ap.add_argument("--limit", type=int, default=None, help="procesar solo N documentos (prueba)")
    args = ap.parse_args()

    md_files = sorted(pathlib.Path(args.path).rglob("*.md"))
    if args.limit:
        md_files = md_files[: args.limit]

    total_docs = total_chunks = 0
    for f in md_files:
        try:
            n = ingest_document(f.read_text(encoding="utf-8", errors="replace"))
            total_docs += 1
            total_chunks += n
        except NotImplementedError:
            raise
        except Exception as e:  # noqa: BLE001
            print(f"[skip] {f.name}: {e}")
    print(f"Listo: {total_docs} documentos, {total_chunks} chunks.")


if __name__ == "__main__":
    main()
