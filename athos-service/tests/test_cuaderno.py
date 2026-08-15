"""La lectura del cuaderno tiene que degradar, no tumbar la generación de la nota."""
from unittest.mock import patch
import app.phantom as ph


def test_sin_la_columna_no_revienta_la_nota():
    # Es el caso real: este servicio despliega por su lado, así que el código puede salir ANTES
    # que la migración 0058. Sin captura, el Fantasma entero dejaría de funcionar.
    with patch.object(ph, "fetch_all", side_effect=Exception('column "notebook" does not exist')):
        assert ph._load_notebook("c1", "x1") == ""


def test_consulta_sin_cuaderno_devuelve_cadena_vacia_no_none():
    with patch.object(ph, "fetch_all", return_value=[{"notebook": None}]):
        assert ph._load_notebook("c1", "x1") == ""


def test_devuelve_el_cuaderno_cuando_existe():
    with patch.object(ph, "fetch_all", return_value=[{"notebook": "Peso real 12,4 kg"}]):
        assert ph._load_notebook("c1", "x1") == "Peso real 12,4 kg"


def test_consulta_inexistente_no_lanza():
    with patch.object(ph, "fetch_all", return_value=[]):
        assert ph._load_notebook("c1", "x1") == ""
