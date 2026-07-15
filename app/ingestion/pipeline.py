"""Pipeline de ingesta del corpus (sección 9 del documento final).

El proveedor entrega markdown + frontmatter YAML (validados, en inglés). Aquí:
idempotente por content_hash -> frontmatter a metadata -> normalizar -> chunking con locator
(no partir tablas/dosis) -> embedding (una vez) -> tsvector por idioma -> etiquetar con glosario.
El corpus es GLOBAL: la tabla corpus_chunks no lleva clinic_id.
"""
import hashlib
import re

import yaml
from psycopg.types.json import Json

from app.config import get_settings
from app.db import fetch_all, get_conn

# Chunking determinístico. Aproximamos "tokens" por palabras (barato y estable para tests).
# Objetivo ~500-800 tokens con ~10-15% de solape; se calibra con el golden set.
MAX_TOKENS = 800
OVERLAP_TOKENS = 100

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.DOTALL)

# idioma del documento -> configuración de tsvector de Postgres.
_PG_TS_CONFIG = {"EN": "english", "ES": "spanish", "PT": "portuguese"}


def parse_document(md_text: str) -> tuple[dict, str]:
    """Separa el frontmatter YAML del cuerpo markdown. Devuelve (metadata, body).

    Formato del corpus: '---\\n<yaml>\\n---\\n<cuerpo>'. Sin frontmatter válido -> ({}, texto).
    """
    text = md_text.lstrip("﻿")  # posible BOM al inicio del archivo
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    meta = yaml.safe_load(m.group(1)) or {}
    if not isinstance(meta, dict):
        meta = {}
    return meta, m.group(2).lstrip("\n")


def _estimate_tokens(text: str) -> int:
    return len(text.split())


def _is_table_line(line: str) -> bool:
    return "|" in line


def _segment_blocks(body: str, default_section: str) -> list[dict]:
    """Trocea el cuerpo en bloques atómicos (párrafo/tabla), arrastrando la sección (heading)
    vigente. Las tablas se agrupan enteras y se marcan `atomic` para no partirlas."""
    lines = body.splitlines()
    blocks: list[dict] = []
    section = default_section
    buf: list[str] = []

    def flush() -> None:
        nonlocal buf
        if buf:
            blocks.append({"text": "\n".join(buf), "section": section, "atomic": False})
            buf = []

    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        stripped = line.strip()
        if stripped.startswith("#"):
            flush()
            section = stripped.lstrip("#").strip() or section
            i += 1
        elif not stripped:
            flush()
            i += 1
        elif _is_table_line(line):
            flush()
            tbl = []
            while i < n and _is_table_line(lines[i]):
                tbl.append(lines[i])
                i += 1
            blocks.append({"text": "\n".join(tbl), "section": section, "atomic": True})
        else:
            buf.append(line)
            i += 1
    flush()
    return blocks


def chunk_document(body: str, metadata: dict) -> list[dict]:
    """Trocea el cuerpo (~MAX_TOKENS con ~OVERLAP_TOKENS de solape) SIN partir tablas ni dosis.

    Cada chunk hereda la metadata del documento + un `locator` (sección) + `ordinal`.
    """
    default_section = str(metadata.get("titulo") or metadata.get("title") or "").strip() or "intro"
    blocks = _segment_blocks(body, default_section)

    chunks: list[dict] = []
    cur: list[dict] = []
    cur_tokens = 0

    def emit() -> None:
        if not cur:
            return
        chunks.append({
            "content": "\n\n".join(b["text"] for b in cur),
            "locator": cur[0]["section"],
            "ordinal": len(chunks),
            "metadata": dict(metadata),
        })

    for b in blocks:
        bt = _estimate_tokens(b["text"])
        if cur and cur_tokens + bt > MAX_TOKENS:
            emit()
            # solape: arrastra los últimos bloques NO atómicos hasta ~OVERLAP_TOKENS
            overlap: list[dict] = []
            ot = 0
            for pb in reversed(cur):
                if pb["atomic"]:
                    continue
                overlap.insert(0, pb)
                ot += _estimate_tokens(pb["text"])
                if ot >= OVERLAP_TOKENS:
                    break
            cur = overlap
            cur_tokens = sum(_estimate_tokens(x["text"]) for x in cur)
        cur.append(b)
        cur_tokens += bt
    emit()
    return chunks


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embeddiza textos con Cohere embed-v4 (dim = EMBEDDING_DIM) vía el cliente compartido
    (acumula los tokens facturados para el guard de presupuesto de la ingesta)."""
    from app.embeddings import get_client
    return get_client().embed(texts, input_type="search_document")


def tag_with_glossary(chunk: dict) -> list[str]:
    """Devuelve los glossary_term ids presentes en el chunk (solo sinónimos `approved`) + su mesh."""
    raise NotImplementedError("etiquetado con glosario")


def _doc_hash(metadata: dict, body: str) -> str:
    """content_hash del frontmatter si existe; si no, hash estable del cuerpo."""
    h = metadata.get("content_hash")
    if h:
        return str(h)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:16]


def _already_ingested(content_hash: str) -> bool:
    rows = fetch_all(
        "select 1 from public.corpus_chunks where metadata->>'content_hash' = %s limit 1",
        (content_hash,),
    )
    return bool(rows)


def _ts_config(idioma) -> str:
    return _PG_TS_CONFIG.get(str(idioma or "").upper(), "simple")


def _insert_chunk_rows(cur, chunks: list[dict], model: str) -> None:
    """Inserta filas de chunk en un cursor abierto (el llamador maneja conexión/commit)."""
    for ch in chunks:
        md = dict(ch["metadata"])
        md["locator"] = ch.get("locator")
        md["ordinal"] = ch.get("ordinal")
        md["embedding_model"] = model
        md.setdefault("is_current", True)
        emb_str = "[" + ",".join(f"{x:.7f}" for x in ch["embedding"]) + "]"
        cur.execute(
            "insert into public.corpus_chunks (source, title, content, embedding, metadata, tsv) "
            "values (%s, %s, %s, %s::vector, %s, to_tsvector(%s::regconfig, %s))",
            (
                str(md.get("source") or md.get("fuente") or "corpus"),
                md.get("titulo") or md.get("title"),
                ch["content"],
                emb_str,
                Json(md),
                _ts_config(md.get("idioma")),
                ch["content"],
            ),
        )


def upsert_chunks(chunks: list[dict]) -> None:
    """Inserta en corpus_chunks (content, embedding, tsv, metadata). GLOBAL, sin clinic_id.

    Cada chunk debe traer ya su `embedding` (lista de floats). El tsvector se calcula con la
    config del idioma del documento. locator/ordinal/embedding_model se guardan en metadata.
    """
    if not chunks:
        return
    with get_conn() as conn, conn.cursor() as cur:
        _insert_chunk_rows(cur, chunks, get_settings().embedding_model)
        conn.commit()


def prepare_document(md_text: str) -> tuple[str | None, list[dict]]:
    """Parsea + chunkea SIN embeddizar (para ingesta por lotes). Devuelve (content_hash, chunks);
    content_hash None si el cuerpo está vacío. La idempotencia (skip si ya está) la decide el
    llamador comparando content_hash contra los ya ingeridos."""
    metadata, body = parse_document(md_text)
    if not body.strip():
        return None, []
    content_hash = _doc_hash(metadata, body)
    metadata.setdefault("content_hash", content_hash)
    return content_hash, chunk_document(body, metadata)


def ingest_document(md_text: str) -> int:
    """Ingesta un documento completo. Idempotente por content_hash. Devuelve nº de chunks nuevos.

    Orquesta: parse -> hash -> (skip si ya está) -> chunk -> embed -> upsert. Un documento es
    todo-o-nada (una transacción de upsert), así que su content_hash presente = ya ingerido.
    """
    metadata, body = parse_document(md_text)
    if not body.strip():
        return 0
    content_hash = _doc_hash(metadata, body)
    metadata.setdefault("content_hash", content_hash)
    if _already_ingested(content_hash):
        return 0
    chunks = chunk_document(body, metadata)
    if not chunks:
        return 0
    vectors = embed_texts([c["content"] for c in chunks])
    for c, v in zip(chunks, vectors):
        c["embedding"] = v
    upsert_chunks(chunks)
    return len(chunks)
