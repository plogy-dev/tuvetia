# -*- coding: utf-8 -*-
"""¿El enlace del correo de invitación deja al invitado CON SESIÓN?

Reproduce el camino del invitado que **no tiene cuenta**, que es el único que no se puede probar
con una invitación normal si el destinatario ya está registrado.

Cómo lo hace sin mandar correos: `POST /auth/v1/admin/generate_link` devuelve el enlace EXACTO que
iría en el correo **sin enviarlo**. Después lo sigue paso a paso y muestra qué devuelve Supabase al
aterrizar en nuestro dominio. Al terminar borra el usuario de prueba.

La dirección de prueba es de `example.com` (RFC 2606): no existe buzón, y aunque existiera no se
manda nada.

    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python scripts/verificar_enlace_invitacion.py

HISTORIA — este script encontró el defecto y después verificó el arreglo:

    ANTES (2026-07-30)                          DESPUÉS (mismo día, commit ac8fb8d)
    [0] 303 supabase -> /auth/callback#access_token=...   igual
    [1] 307 tuvetia  -> /login?reason=missing_code        -> /auth/sesion?next=...  <-- arreglado
    [2] 200 (login, el invitado no entra)                 200 (abre la sesión y sigue)

Supabase devuelve la sesión en el **fragmento** (`#`), y el fragmento **no viaja al servidor**: es
parte de la URL que el navegador se guarda para sí. `/auth/callback` es una ruta de servidor, así
que ve la petición sin `?code=`, concluye que falta el código y manda al login.

ARREGLADO con la opción (b): `/auth/sesion` es una página CLIENTE que lee el fragmento, llama a
setSession y sigue al destino; `/auth/callback` deriva ahí cuando no hay `?code=`. El detalle de por
qué son dos caminos distintos:
  · `/auth/callback` (server) sirve para PKCE con `?code=` — el login con Google, donde el flujo lo
    inició el navegador y existe el `code_verifier`.
  · un enlace de correo lo inicia el SERVIDOR: no hay `code_verifier`, y Supabase responde con
    tokens en el fragmento o con `token_hash` según la plantilla.
Se descartó la alternativa de cambiar la plantilla de correo en el panel de Supabase
(`/auth/confirm?token_hash={{ .TokenHash }}&...`): funciona, pero deja el arreglo fuera del repo y
sin pruebas.

OJO al usarlo para verificar: `curl` no ejecuta JavaScript. Este script llega hasta /auth/sesion y
ahí se detiene; que el navegador abra la sesión lo cubren las pruebas de `src/lib/auth-fragment.ts`
y, definitivamente, un clic real.
"""
import os
import sys

import httpx

URL = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
KEY = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
DESTINO = os.environ.get(
    "INVITE_REDIRECT", "https://tuvetia.vercel.app/auth/callback?next=%2Finvitar%2Ftok-de-prueba")
CORREO = os.environ.get("INVITE_EMAIL", "tuvetia-prueba-enlace@example.com")

if not URL or not KEY:
    print(__doc__)
    print("faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno")
    sys.exit(2)

H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def _ocultar(u: str) -> str:
    for marca in ("access_token=", "refresh_token=", "token=", "code="):
        while marca in u:
            i = u.index(marca) + len(marca)
            fin = min([p for p in (u.find("&", i), u.find("#", i), len(u)) if p > 0] or [len(u)])
            if u[i:fin] == "<oculto>":
                break
            u = u[:i] + "<oculto>" + u[fin:]
    return u


def main() -> int:
    user_id = None
    try:
        with httpx.Client(timeout=60, follow_redirects=False) as c:
            r = c.post(f"{URL}/auth/v1/admin/generate_link", headers=H,
                       json={"type": "invite", "email": CORREO, "redirect_to": DESTINO})
            if r.status_code >= 300:
                print("no se pudo generar el enlace:", r.status_code, r.text[:300])
                return 1
            d = r.json()
            user_id = d.get("id") or (d.get("user") or {}).get("id")
            enlace = d.get("action_link") or (d.get("properties") or {}).get("action_link")
            print("ENLACE GENERADO (el mismo que iría en el correo, sin enviarlo):")
            print("  ", _ocultar(enlace))

            print("\nQUÉ PASA AL HACER CLIC:")
            actual, saltos, sesion_en_fragmento = enlace, 0, False
            while actual and saltos < 5:
                resp = c.get(actual, headers={"User-Agent": "Mozilla/5.0"})
                host = actual.split("/")[2] if "//" in actual else actual
                print(f"   [{saltos}] {resp.status_code}  {host}")
                destino = resp.headers.get("location", "")
                if not destino:
                    break
                print(f"        -> {_ocultar(destino)[:220]}")
                if "access_token=" in destino.split("#", 1)[-1] and "#" in destino:
                    sesion_en_fragmento = True
                actual, saltos = destino, saltos + 1

            print("\nVEREDICTO:")
            if sesion_en_fragmento:
                print("   Supabase devuelve la sesión en el FRAGMENTO (#). Una ruta de SERVIDOR no")
                print("   puede leerlo. Si el aterrizaje es /auth/callback, el invitado sin cuenta")
                print("   termina en /login?reason=missing_code. Ver el encabezado de este archivo.")
            else:
                print("   No hubo sesión en el fragmento: revisar la traza de arriba.")
        return 0
    finally:
        if user_id:
            with httpx.Client(timeout=60) as c:
                r = c.delete(f"{URL}/auth/v1/admin/users/{user_id}", headers=H)
                print(f"\nlimpieza: usuario de prueba borrado ({r.status_code})")


if __name__ == "__main__":
    raise SystemExit(main())
