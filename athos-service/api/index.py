"""Entrypoint para desplegar Athos como funcion Python en VERCEL (predisposicion).

NO se usa en Railway (ahi corre `uvicorn app.main:app` via Procfile/railway.json). Queda listo
para cuando se migre el backend a Vercel: Vercel detecta `api/*.py` y sirve la app ASGI exportada
como `app`. Requiere `vercel.json` (rewrites de todas las rutas a /api/index + maxDuration).

Config de Vercel al migrar:
  - Root Directory = athos-service/
  - Install: pip install -r requirements.txt  (bundle liviano, sin llama-index)
  - Las mismas env vars que en Railway (DATABASE_URL, CORPUS_DATABASE_URL, SUPABASE_JWKS_URL,
    LLM_*, EMBEDDING_*, CORS_ORIGINS).
  - maxDuration alto (300s) -> requiere plan Pro por el Modo Fantasma (~60-90s).
"""
from app.main import app  # noqa: F401  (Vercel sirve este objeto ASGI)
