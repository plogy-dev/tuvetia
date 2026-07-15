"""CLI de ingesta del corpus (por lotes, con guard de presupuesto).

Modos:
  - balanceado:  uv run python -m app.ingestion.run --manifest data/corpus/manifest.csv \
                     --token-budget 30000000
  - por carpeta: uv run python -m app.ingestion.run --path data/corpus/documentos [--limit N]

El modo balanceado recorre los documentos **proporcional a la especie** (subconjunto parcial
representativo). Embeddiza en lotes (una llamada Cohere cada ~90 fragmentos) y se detiene al
alcanzar el tope de tokens facturados. Idempotente por content_hash (los ya ingeridos se saltan
sin gasto y sin chunkear -> reanuda barato). Cada lote usa su propia conexión con
`statement_timeout=0` (los INSERT sobre el índice HNSW pueden tardar al crecer el corpus).
"""
import argparse
import csv
import pathlib
import time

import psycopg
from psycopg.rows import dict_row

from app.config import get_settings
from app.db import fetch_all
from app.embeddings import EmbeddingError, get_client
from app.ingestion.pipeline import (
    _doc_hash, _insert_chunk_rows, chunk_document, embed_texts, parse_document,
)

BATCH = 90            # textos por llamada a Cohere (máx. 96)
THROTTLE_S = 0.05     # pausa entre lotes


def _connect():
    """Conexión con statement_timeout desactivado (INSERT en HNSW puede tardar al crecer)."""
    conn = psycopg.connect(get_settings().database_url, row_factory=dict_row)
    with conn.cursor() as cur:
        cur.execute("set statement_timeout = 0")
    conn.commit()
    return conn


def _manifest_order(manifest: str) -> list[tuple[str, pathlib.Path]]:
    """Orden proporcional por especie: cada documento recibe una posición i/n dentro de su especie
    y luego se intercalan todas. Un prefijo de esta lista es representativo del corpus."""
    by: dict[str, list[str]] = {}
    with open(manifest, encoding="utf-8", errors="replace", newline="") as f:
        for row in csv.DictReader(f):
            docid = (row.get("id") or "").strip()
            esp = (row.get("especie") or "?").strip()
            if docid:
                by.setdefault(esp, []).append(docid)
    ranked: list[tuple[float, str, str]] = []
    for esp, ids in by.items():
        ids.sort()
        n = len(ids)
        for i, docid in enumerate(ids):
            ranked.append(((i + 0.5) / n, esp, docid))
    ranked.sort(key=lambda x: x[0])
    base = pathlib.Path(manifest).parent / "documentos"
    return [(esp, base / esp / f"{docid}.md") for _, esp, docid in ranked]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", help="carpeta con los .md (modo por carpeta)")
    ap.add_argument("--manifest", help="manifest.csv (modo balanceado)")
    ap.add_argument("--limit", type=int, default=None, help="procesar solo N documentos")
    ap.add_argument("--throttle", type=float, default=THROTTLE_S, help="pausa entre lotes (s)")
    ap.add_argument("--token-budget", type=int, default=None, help="tope de tokens facturados")
    args = ap.parse_args()

    if args.manifest:
        files = _manifest_order(args.manifest)
    elif args.path:
        files = [(f.parent.name, f) for f in sorted(pathlib.Path(args.path).rglob("*.md"))]
    else:
        ap.error("usa --manifest o --path")
    if args.limit:
        files = files[: args.limit]
    total = len(files)

    model = get_settings().embedding_model
    done = {r["ch"] for r in fetch_all(
        "select distinct metadata->>'content_hash' ch from public.corpus_chunks") if r["ch"]}
    print(f"ya ingeridos: {len(done):,} documentos (se saltan)", flush=True)
    client = get_client()

    stats = {"docs": 0, "chunks": 0, "skipped": 0}
    by_esp: dict[str, int] = {}
    pending: list[tuple[str, str, list[dict]]] = []  # (content_hash, especie, chunks)
    flat: list[dict] = []

    def flush() -> None:
        if not flat:
            return
        for i in range(0, len(flat), BATCH):
            sub = flat[i:i + BATCH]
            vecs = embed_texts([c["content"] for c in sub])
            for c, v in zip(sub, vecs):
                c["embedding"] = v
            time.sleep(args.throttle)
        for attempt in range(2):  # reintento ante corte de conexión/timeout transitorio
            try:
                conn = _connect()
                with conn.cursor() as cur:
                    for _, _, chunks in pending:
                        _insert_chunk_rows(cur, chunks, model)
                conn.commit()
                conn.close()
                break
            except (psycopg.OperationalError, psycopg.InterfaceError,
                    psycopg.errors.QueryCanceled) as e:
                if attempt == 1:
                    raise
                print(f"[reintento DB] {e}", flush=True)
                time.sleep(3)
        for content_hash, esp, chunks in pending:
            done.add(content_hash)
            stats["docs"] += 1
            stats["chunks"] += len(chunks)
            by_esp[esp] = by_esp.get(esp, 0) + 1
        pending.clear()
        flat.clear()

    stop_reason = "fin de la lista"
    broke = False
    for i, (esp, f) in enumerate(files, 1):
        if not f.exists():
            stats["skipped"] += 1
            continue
        try:
            meta, body = parse_document(f.read_text(encoding="utf-8", errors="replace"))
        except Exception as e:  # noqa: BLE001
            stats["skipped"] += 1
            print(f"[skip] {f.name}: {e}", flush=True)
            continue
        if not body.strip():
            stats["skipped"] += 1
            continue
        content_hash = str(meta.get("content_hash") or _doc_hash(meta, body))
        if content_hash in done:
            stats["skipped"] += 1
            continue  # ya ingerido -> ni se chunkea (reanudación barata)
        meta.setdefault("content_hash", content_hash)
        pending.append((content_hash, esp, chunk_document(body, meta)))
        flat.extend(pending[-1][2])
        if len(flat) >= BATCH:
            try:
                flush()
            except EmbeddingError as e:
                stop_reason = f"límite de Cohere: {e}"
                broke = True
                break
            if args.token_budget and client.total_billed_tokens >= args.token_budget:
                stop_reason = f"tope de presupuesto ({client.total_billed_tokens:,} tokens)"
                broke = True
                break
        if i % 500 == 0:
            print(f"[{i}/{total}] docs={stats['docs']} chunks={stats['chunks']} "
                  f"skip={stats['skipped']} tokens={client.total_billed_tokens:,} {by_esp}", flush=True)
    if not broke:
        try:
            flush()
        except EmbeddingError as e:
            stop_reason = f"límite de Cohere (lote final): {e}"

    tok = client.total_billed_tokens
    print(f"STOP: {stop_reason}", flush=True)
    print(f"Listo: {stats['docs']} documentos nuevos, {stats['chunks']} chunks, "
          f"{stats['skipped']} saltados.", flush=True)
    print(f"Tokens facturados por Cohere (esta corrida): {tok:,}", flush=True)
    for rate in (0.10, 0.12, 0.15):
        print(f"  costo aprox @ US${rate}/1M = US${tok/1e6*rate:.2f}  (~{tok/1e6*rate*4050:,.0f} COP)",
              flush=True)
    print(f"Cobertura por especie (nuevos): {by_esp}", flush=True)


if __name__ == "__main__":
    main()
