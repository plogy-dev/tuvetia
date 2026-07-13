# Athos — RAG veterinario (microservicio)

Microservicio FastAPI que responde consultas clínicas del veterinario (chat de Athos) y genera
sugerencias al cerrar una consulta (Modo Fantasma), citando literatura veterinaria verificable.

- Diseño y decisiones: `tuvetia_rag_documento_final.md`
- Reglas para Claude Code: `CLAUDE.md`
- Montaje paso a paso: `SETUP.md`

## Arrancar en local
    uv venv
    uv sync
    cp .env.example .env      # y completar
    uv run uvicorn app.main:app --reload --port 8000
    curl http://localhost:8000/health

## Estructura
    app/ingestion   -> indexar el corpus (idempotente por content_hash)
    app/glossary    -> siembra MeSH/DeCS + resolución de conceptos (puente ES->EN)
    app/retrieval   -> cascada A->B, Tier 0/1/2, umbral, fusión (determinístico, sin IA)
    app/generation  -> gate de alergia, B->A (una sola llamada), verificación de citas
    app/trace       -> athos_messages / rag_retrieval_log / rag_answer_log

Los cuerpos marcados con `raise NotImplementedError(...)` son los que Claude Code debe llenar,
siguiendo la sección indicada en cada docstring.
