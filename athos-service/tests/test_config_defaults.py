"""Que el default del proveedor de IA sea COHERENTE y no el que se sabe roto.

DOS COSAS DISTINTAS SE FIJAN ACÁ.

1. QUE LOS TRES SE MUEVAN JUNTOS. `llm_provider`, `llm_base_url` y `llm_model` son un solo hecho
   partido en tres campos. Con `openai` y la URL vacía, `LLMClient` arma "/chat/completions" —una
   URL relativa, inválida— y el fallo deja de entenderse. Cambiar uno solo es la forma natural de
   romper esto, y no la ve ningún otro test.

2. QUE EL DEFAULT NO SEA ANTHROPIC. Hasta el 2026-08-22 lo era, mientras `provider_cascade.py`
   documentaba que esa cuenta no tiene crédito. "Sin variables de entorno" era exactamente la
   configuración rota: el servicio arrancaba, pasaba el healthcheck de Railway y moría en la primera
   generación, con el tablero en verde. Anthropic SIGUE soportado —como proveedor y como alternativa
   de la cascada—; lo que no puede volver a ser es lo que se asume cuando nadie dijo nada.

SE LEEN LOS DEFAULTS DECLARADOS, no `Settings()`: instanciarla lee el `.env` de la máquina y el test
mediría la configuración de quien lo corre en vez de la del repo.
"""
from app.config import Settings

DEFAULTS = {nombre: campo.default for nombre, campo in Settings.model_fields.items()}


def test_los_tres_campos_del_proveedor_son_coherentes():
    proveedor, url = DEFAULTS["llm_provider"], DEFAULTS["llm_base_url"]
    if proveedor == "openai":
        assert url, (
            "con provider=openai y base_url vacía, LLMClient arma la URL relativa "
            "'/chat/completions' y la petición ni sale. Los tres se mueven juntos."
        )
        assert url.startswith("http"), f"base_url no es una URL: {url!r}"
    if proveedor == "anthropic":
        # La rama de Anthropic no usa base_url: si hay una puesta, alguien movió medio default.
        assert not url, "provider=anthropic no usa base_url; quedó una de otro proveedor"


def test_el_default_no_es_el_proveedor_excluido():
    assert DEFAULTS["llm_provider"] != "anthropic", (
        "provider_cascade.py excluye a Anthropic mientras su cuenta no tenga crédito. Como default, "
        "eso convierte 'sin configurar' en 'roto en silencio con el healthcheck en verde'."
    )


def test_el_modelo_por_defecto_es_el_validado():
    # El que `provider_cascade.py` llama "el modelo validado contra el golden set", y el que corre en
    # producción. Si se valida otro, este test es el lugar donde consta el cambio.
    assert DEFAULTS["llm_model"] == "deepseek-v4-flash"
    assert DEFAULTS["llm_light_model"] == "deepseek-v4-flash"


def test_anthropic_sigue_siendo_posible():
    # Cambiar el default no es sacar el proveedor: su key propia tiene que seguir existiendo, o la
    # cascada no puede usar Claude como alternativa.
    assert "anthropic_api_key" in DEFAULTS
    assert DEFAULTS["anthropic_api_key"] == ""


def test_ninguna_credencial_viene_con_valor_de_fabrica():
    # Un default no vacío en una key sería un secreto en el repo.
    for nombre, valor in DEFAULTS.items():
        if nombre.endswith("_key") or nombre.endswith("_secret"):
            assert valor == "", f"{nombre} trae un valor por defecto: posible secreto en el código"
