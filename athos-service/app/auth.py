"""Autenticación: verifica el JWT de Supabase que manda el frontend y resuelve la clínica.

Supabase firma los JWT con claves asimétricas (JWKS, RS256/ES256) en proyectos modernos, o con el
secreto compartido HS256 (legacy). Verificamos por JWKS (endpoint público, sin secreto) y caemos a
HS256 si el token es de ese tipo. La clínica se resuelve por `profiles.clinic_id` (igual que el
front de Santi, `ensure-clinic.ts`).
"""
from functools import lru_cache

import jwt
from fastapi import HTTPException

from app.config import get_settings
from app.db import fetch_all

# La red de dev intercepta TLS (proxy MITM): que urllib (usado por PyJWKClient para bajar el JWKS)
# confíe en la CA del SO. En producción (Vercel) es inocuo.
try:
    import truststore
    truststore.inject_into_ssl()
except Exception:  # noqa: BLE001
    pass

_ASYMMETRIC = {"RS256", "RS384", "RS512", "ES256", "ES384", "ES512"}


@lru_cache
def _jwk_client() -> "jwt.PyJWKClient":
    s = get_settings()
    url = s.supabase_jwks_url or f"{s.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    return jwt.PyJWKClient(url)


def verify_jwt(token: str) -> str:
    """Valida el JWT de Supabase y devuelve el user_id (sub). Enruta por el `alg` del header:
    JWKS para firma asimétrica, secreto compartido para HS256."""
    s = get_settings()
    try:
        alg = jwt.get_unverified_header(token).get("alg", "")
        if alg in _ASYMMETRIC:
            key = _jwk_client().get_signing_key_from_jwt(token).key
            payload = jwt.decode(token, key, algorithms=[alg], audience="authenticated")
        elif alg == "HS256":
            if not s.supabase_jwt_secret:
                raise HTTPException(status_code=401, detail="token HS256 sin secreto configurado")
            payload = jwt.decode(token, s.supabase_jwt_secret, algorithms=["HS256"],
                                 audience="authenticated")
        else:
            raise HTTPException(status_code=401, detail=f"algoritmo de token no soportado: {alg}")
    except HTTPException:
        raise
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail=f"token inválido: {e}") from e
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="token sin sub")
    return sub


def resolve_clinic_id(user_id: str, clinic_id: str) -> str:
    """Confirma que el usuario pertenece a clinic_id (vía profiles.clinic_id). Devuelve clinic_id."""
    rows = fetch_all(
        "select 1 from public.profiles where id = %s and clinic_id = %s and is_active",
        (user_id, clinic_id),
    )
    if not rows:
        raise HTTPException(status_code=403, detail="el usuario no pertenece a esa clínica")
    return clinic_id
