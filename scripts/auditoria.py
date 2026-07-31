# -*- coding: utf-8 -*-
"""Corre TODAS las verificaciones del proyecto y da un veredicto único.

Pensado para el día de la entrega: un solo comando, una sola respuesta.

    python scripts/auditoria.py            # todo
    python scripts/auditoria.py --rapido   # sin el build de Next (lo más lento)

Lo primero que revisa NO es código: es a qué base apunta el `.env`. Esa comprobación va primera a
propósito — el 30-jul la suite corrió contra producción durante horas porque nadie la miraba, y
ninguna de las demás verificaciones lo habría detectado.
"""
import argparse
import os
import re
import subprocess
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ATHOS = RAIZ / "athos-service"
PY = ATHOS / ".venv" / "Scripts" / "python.exe"
if not PY.exists():
    PY = ATHOS / ".venv" / "bin" / "python"
if not PY.exists():
    PY = Path(sys.executable)

REF_PRINCIPAL = "auxlnexhkmtoedrzfsnz"

VERDE, ROJO, AMARILLO, GRIS, FIN = "\033[92m", "\033[91m", "\033[93m", "\033[90m", "\033[0m"


def _pinta(estado: str) -> str:
    return {"OK": f"{VERDE}OK{FIN}", "FALLA": f"{ROJO}FALLA{FIN}",
            "AVISO": f"{AMARILLO}AVISO{FIN}", "SALTADO": f"{GRIS}saltado{FIN}"}[estado]


def revisar_entorno() -> tuple[str, str]:
    """¿A qué base apunta el `.env`? Es lo que decide si es seguro correr las pruebas."""
    env = ATHOS / ".env"
    if not env.exists():
        return "AVISO", "no hay athos-service/.env (normal en CI)"
    texto = env.read_text(encoding="utf-8", errors="replace")
    linea = next((ln for ln in texto.splitlines()
                  if ln.strip().startswith("DATABASE_URL")), "")
    ref = re.search(r"(?:postgres\.|//)([a-z]{20})", linea)
    ref = ref.group(1) if ref else "(no se pudo leer)"
    if ref == REF_PRINCIPAL:
        return "FALLA", (f"DATABASE_URL apunta al PRINCIPAL ({ref}). Las pruebas siembran y BORRAN "
                         "clínicas: apuntalo a la base de desarrollo antes de seguir.")
    return "OK", f"DATABASE_URL -> {ref} (no es el principal)"


def correr(nombre: str, cmd: list, cwd: Path, tolera_fallo=False) -> dict:
    t0 = time.monotonic()
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=1800)
        salida = (p.stdout or "") + (p.stderr or "")
        estado = "OK" if p.returncode == 0 else ("AVISO" if tolera_fallo else "FALLA")
    except FileNotFoundError as e:
        salida, estado = str(e), "SALTADO"
    except subprocess.TimeoutExpired:
        salida, estado = "se pasó de 30 min", "FALLA"
    return {"nombre": nombre, "estado": estado, "seg": time.monotonic() - t0,
            "resumen": _resumir(salida), "salida": salida}


def _resumir(s: str) -> str:
    """La línea que de verdad dice cómo fue."""
    for patron in (r"\d+ passed[^\n]*", r"Tests\s+\d+ passed[^\n]*", r"\d+ problems?[^\n]*",
                   r"Compiled successfully[^\n]*", r"All checks passed[^\n]*"):
        m = re.findall(patron, s)
        if m:
            return m[-1].strip()
    lineas = [ln.strip() for ln in s.splitlines() if ln.strip()]
    return lineas[-1][:110] if lineas else "(sin salida)"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rapido", action="store_true", help="omite el build de Next")
    args = ap.parse_args()

    print("=" * 78)
    print("  AUDITORÍA COMPLETA DEL PROYECTO")
    print("=" * 78)

    estado_env, detalle_env = revisar_entorno()
    print(f"\n  [{_pinta(estado_env)}] Entorno · {detalle_env}\n")
    if estado_env == "FALLA":
        print(f"{ROJO}  Se corta acá: correr las pruebas así escribe en producción.{FIN}\n")
        return 2

    npm = "npm.cmd" if os.name == "nt" else "npm"
    npx = "npx.cmd" if os.name == "nt" else "npx"
    tareas = [
        ("backend · ruff", [str(PY), "-m", "ruff", "check", "."], ATHOS, False),
        ("backend · pytest", [str(PY), "-m", "pytest", "-q", "-p", "no:warnings"], ATHOS, False),
        ("front · typecheck", [npx, "tsc", "--noEmit"], RAIZ, False),
        ("front · lint", [npm, "run", "lint"], RAIZ, True),
        ("front · vitest", [npm, "test"], RAIZ, False),
    ]
    if not args.rapido:
        tareas.append(("front · build", [npm, "run", "build"], RAIZ, False))

    resultados = []
    for nombre, cmd, cwd, tolera in tareas:
        print(f"  … {nombre}", end="", flush=True)
        r = correr(nombre, cmd, cwd, tolera)
        resultados.append(r)
        print(f"\r  [{_pinta(r['estado'])}] {nombre:22} {r['seg']:5.1f}s  {r['resumen'][:56]}")

    print("\n" + "=" * 78)
    fallas = [r for r in resultados if r["estado"] == "FALLA"]
    if fallas:
        print(f"  {ROJO}VEREDICTO: {len(fallas)} verificación(es) en rojo{FIN}")
        for r in fallas:
            print(f"\n  ---- {r['nombre']} ----")
            print("\n".join(r["salida"].splitlines()[-25:]))
        return 1
    avisos = [r for r in resultados if r["estado"] in ("AVISO", "SALTADO")]
    print(f"  {VERDE}VEREDICTO: TODO EN VERDE{FIN}"
          + (f"  ({len(avisos)} con aviso)" if avisos else ""))
    print("=" * 78)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
