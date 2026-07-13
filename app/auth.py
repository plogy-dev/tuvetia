"""Autenticación: verifica el JWT de Supabase que manda el frontend y resuelve la clínica."""
import jwt
from fastapi import HTTPException
from app.config import get_settings
from app.db import fetch_all


def verify_jwt(token: str) -> str:
    """Valida el JWT de Supabase (HS256 con SUPABASE_JWT_SECRET) y devuelve el user_id (sub)."""
    try:
        payload = jwt.decode(
            token,
            get_settings().supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail=f"token inválido: {e}")
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="token sin sub")
    return sub


def resolve_clinic_id(user_id: str, clinic_id: str) -> str:
    """Confirma que el usuario pertenece a clinic_id (tabla memberships). Devuelve clinic_id."""
    rows = fetch_all(
        "select 1 from public.memberships where user_id = %s and clinic_id = %s",
        (user_id, clinic_id),
    )
    if not rows:
        raise HTTPException(status_code=403, detail="el usuario no pertenece a esa clínica")
    return clinic_id
