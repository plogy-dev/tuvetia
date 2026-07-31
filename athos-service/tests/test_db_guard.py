"""El cortafuegos que impide que una prueba abra la DB de paciente del proyecto PRINCIPAL.

Contexto (2026-07-30): el proyecto de dev `tuvetia-athos-dev` se borró. Sin base de desarrollo, la
única salida para trabajar era apuntar el `.env` al principal — y ahí la suite empezó a escribir en
producción. En los logs del principal aparecieron `invalid input syntax for type uuid: "clinic-a"`,
que es literalmente el `clinic_id` que pasan `test_chat.py` y `test_phantom.py`.

Esas dos NO usan `require_db` ni `seeded_tenants`: llegan a la base por mocks. Por eso el guard de
`conftest.py` no alcanzaba y el cortafuegos tuvo que bajar a `app/db.py`, al único punto por el que
pasa todo: abrir la conexión. Un mock que deja de aplicar no avisa.
"""
import pytest

from app.db import ESCOTILLA, REF_PRINCIPAL, _vetar_principal_en_tests

DEV = "postgresql://postgres.ghmpjyuchwkrvnjvdeum:x@aws-1-us-west-2.pooler.supabase.com:5432/postgres"
PRINCIPAL = f"postgresql://postgres.{REF_PRINCIPAL}:x@aws-1-us-west-2.pooler.supabase.com:5432/postgres"
LOCAL = "postgresql://postgres:postgres@localhost:5432/athos"


def test_bloquea_el_principal():
    with pytest.raises(RuntimeError, match="BLOQUEADO"):
        _vetar_principal_en_tests(PRINCIPAL)


def test_el_mensaje_dice_qué_hacer():
    """Un cortafuegos que no explica el arreglo se termina desactivando a la brava."""
    with pytest.raises(RuntimeError) as e:
        _vetar_principal_en_tests(PRINCIPAL)
    msg = str(e.value)
    assert "tuvetia-athos-dev" in msg
    assert "DATABASE_URL" in msg
    assert ESCOTILLA in msg


@pytest.mark.parametrize("url", [DEV, LOCAL, "", None])
def test_deja_pasar_lo_que_no_es_el_principal(url):
    _vetar_principal_en_tests(url)      # no debe lanzar


def test_la_escotilla_funciona_pero_hay_que_escribirla_entera(monkeypatch):
    # Que sea incómoda es a propósito: no se activa por accidente ni con un `=1`.
    monkeypatch.setenv(ESCOTILLA, "1")
    with pytest.raises(RuntimeError):
        _vetar_principal_en_tests(PRINCIPAL)
    monkeypatch.setenv(ESCOTILLA, "si-se-lo-que-hago")
    _vetar_principal_en_tests(PRINCIPAL)


def test_fuera_de_pytest_no_estorba(monkeypatch):
    """En producción el servicio SÍ debe conectarse al principal: el veto es sólo para las pruebas."""
    import app.db as db
    monkeypatch.setattr(db, "_bajo_pytest", lambda: False)
    db._vetar_principal_en_tests(PRINCIPAL)   # no debe lanzar


def test_el_corpus_no_queda_vetado():
    """El corpus es de LECTURA y sus 520k fragmentos sólo viven en el principal.

    Vetarlo también dejaría sin poder medir nada: `get_corpus_conn` y `_get_corpus_pool` no llaman
    al cortafuegos a propósito. Esta prueba fija esa decisión para que no se “arregle” por error.
    """
    import inspect

    import app.db as db
    for fn in (db.get_corpus_conn, db._get_corpus_pool):
        assert "_vetar_principal_en_tests" not in inspect.getsource(fn)
    for fn in (db.get_conn, db._get_pool):
        assert "_vetar_principal_en_tests" in inspect.getsource(fn)
