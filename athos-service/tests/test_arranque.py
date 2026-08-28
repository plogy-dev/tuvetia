"""Lo que el servicio dice de sí mismo al arrancar.

POR QUÉ IMPORTA. El 2026-08-22 hubo que GENERAR UNA NOTA para averiguar qué modelo redactaba en
producción: una llamada al modelo para saber cuál es el modelo. Y detrás hay una trampa peor —los
defaults de `config.py` son `claude-sonnet-5@anthropic`, que `provider_cascade.py` excluye
explícitamente mientras esa cuenta no tenga crédito—. Si Railway pierde sus variables, el servicio
arranca, pasa el healthcheck y muere en la primera generación, en verde.

El test que más cuida es el último: esto se escribe en un log, así que no puede llevar una key.
"""
from types import SimpleNamespace

from app.arranque import advertencias, resumen

SECRETO = "sk-ESTO-NO-PUEDE-APARECER-EN-EL-LOG"


def _config(**cambios):
    base = dict(
        llm_model="deepseek-v4-flash", llm_provider="openai", llm_light_model="deepseek-v4-flash",
        judge_model_name="deepseek-v4-flash",
        llm_cascade_redaccion="deepseek-v4-flash@openai,gemini-3.6-flash@google",
        llm_cascade_liviano="", llm_cascade_dificil="",
        llm_api_key=SECRETO, anthropic_api_key="", gemini_api_key=SECRETO,
        embedding_api_key=SECRETO, deepgram_api_key=SECRETO,
    )
    base.update(cambios)
    return SimpleNamespace(**base)


def test_produccion_bien_configurada_no_grita():
    # Lo que hay hoy en Railway: el primario validado contra el golden set, con su key.
    assert advertencias(_config()) == []


def test_dice_que_modelo_redacta_sin_tener_que_generar_una_nota():
    linea = resumen(_config())[0]
    assert "deepseek-v4-flash@openai" in linea
    assert "juez" in linea


def test_si_railway_pierde_las_variables_lo_dice():
    # El default de `config.py`, tal cual: proveedor anthropic y ninguna key.
    perdidas = _config(llm_model="claude-sonnet-5", llm_provider="anthropic", llm_api_key="",
                       gemini_api_key="", embedding_api_key="", deepgram_api_key="")
    avisos = " | ".join(advertencias(perdidas))

    # Las dos mitades: que no puede autenticarse, y que ese proveedor está excluido a propósito.
    assert "NO tiene key" in avisos
    assert "provider_cascade" in avisos
    # Y lo que hace que el aviso sirva: dice cuál es el bueno.
    assert "deepseek-v4-flash@openai" in avisos
    # El healthcheck no lo va a delatar, y eso es justo lo que hay que decir.
    assert "verde" in avisos


def test_avisa_si_falta_la_key_de_embeddings():
    assert any("Tier 2" in a for a in advertencias(_config(embedding_api_key="")))


def test_con_anthropic_credenciado_sigue_avisando_que_esta_excluido():
    # Tener key no lo vuelve buena idea: la exclusión es por saldo, no por credencial.
    avisos = advertencias(_config(llm_provider="anthropic", anthropic_api_key=SECRETO))
    assert len(avisos) == 1 and "excluye" in avisos[0]


def test_NUNCA_escribe_una_key():
    # EL TEST QUE CUIDA DE VERDAD. Esto va a un log de Railway, que es más fácil de compartir que
    # una variable de entorno: una key acá se filtra en la primera captura de pantalla.
    for texto in resumen(_config()) + advertencias(_config(llm_provider="anthropic")):
        assert SECRETO not in texto, f"se filtró una credencial: {texto}"
    # Y sí dice si hay o no hay, que es lo único que se necesita saber.
    # En CUALQUIER línea, no en la última: la línea de STT (auditoría 26-ago) va después de la
    # de credenciales y el índice posicional se volvió frágil.
    assert any("llm=sí" in linea for linea in resumen(_config()))
    assert any("llm=NO" in linea for linea in resumen(_config(llm_api_key="")))
