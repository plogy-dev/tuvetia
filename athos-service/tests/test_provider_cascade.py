"""Cascada entre proveedores (clausula 1.4) y routing por tarea (1.5). Sin LLM real."""
import app.generation.provider_cascade as pc
from app.generation.provider_cascade import LIVIANO, REDACCION, ProviderCascade, _parse


def _cascada(monkeypatch, redaccion="", liviano=""):
    s = pc.get_settings()
    monkeypatch.setattr(s, "llm_cascade_redaccion", redaccion, raising=False)
    monkeypatch.setattr(s, "llm_cascade_liviano", liviano, raising=False)
    monkeypatch.setattr(s, "llm_cascade_max_intentos", 3, raising=False)


def _fake_client(monkeypatch, comportamiento):
    """`comportamiento`: {"modelo@proveedor": "texto" | Exception}. Registra a quien se llamo."""
    llamados = []

    class Fake:
        def __init__(self, model=None, provider=None, **k):
            self.clave = f"{model or 'default'}@{provider or 'default'}"

        def complete(self, system, user, max_tokens=2000):
            llamados.append(self.clave)
            r = comportamiento.get(self.clave, RuntimeError(f"sin configurar {self.clave}"))
            if isinstance(r, Exception):
                raise r
            return r

        def stream(self, system, user, max_tokens=1500, history=None):
            llamados.append(self.clave)
            r = comportamiento.get(self.clave, RuntimeError(f"sin configurar {self.clave}"))
            if isinstance(r, Exception):
                raise r
            yield from r

    monkeypatch.setattr(pc, "LLMClient", Fake)
    return llamados


def test_parse_ignora_lo_malformado_en_vez_de_reventar():
    """Una env var mal escrita no puede tumbar el arranque del servicio."""
    assert _parse("a@openai, ,basura, @openai, b@ ,c@google") == [("a", "openai"), ("c", "google")]
    assert _parse("") == []
    assert _parse(None) == []


def test_sin_cascada_configurada_usa_el_cliente_de_siempre(monkeypatch):
    """La garantia que hace seguro desplegar esto: sin configurar, nada cambia."""
    _cascada(monkeypatch)
    llamados = _fake_client(monkeypatch, {"default@default": "respuesta de siempre"})
    assert ProviderCascade(REDACCION).complete("s", "u") == "respuesta de siempre"
    assert llamados == ["default@default"]


def test_el_camino_feliz_no_llama_a_la_alternativa(monkeypatch):
    """Si el primario responde, la alternativa ni se toca: cero costo y cero latencia extra."""
    _cascada(monkeypatch, redaccion="deepseek-v4-flash@openai,gemini-3.6-flash@google")
    llamados = _fake_client(monkeypatch, {"deepseek-v4-flash@openai": "ok"})
    assert ProviderCascade(REDACCION).complete("s", "u") == "ok"
    assert llamados == ["deepseek-v4-flash@openai"]


def test_cae_a_la_alternativa_cuando_el_primario_falla(monkeypatch):
    _cascada(monkeypatch, redaccion="deepseek-v4-flash@openai,gemini-3.6-flash@google")
    llamados = _fake_client(monkeypatch, {
        "deepseek-v4-flash@openai": RuntimeError("HTTP 503 proveedor caido"),
        "gemini-3.6-flash@google": "respuesta de Gemini",
    })
    c = ProviderCascade(REDACCION)
    assert c.complete("s", "u") == "respuesta de Gemini"
    assert llamados == ["deepseek-v4-flash@openai", "gemini-3.6-flash@google"]
    assert c.usado == "gemini-3.6-flash@google"      # queda registrado quien respondio


def test_si_todos_fallan_levanta_el_ultimo_error(monkeypatch):
    """No se traga el fallo: si nadie pudo responder, el error sube como subia antes."""
    _cascada(monkeypatch, redaccion="a@openai,b@google")
    _fake_client(monkeypatch, {"a@openai": RuntimeError("cayo A"),
                               "b@google": RuntimeError("cayo B")})
    try:
        ProviderCascade(REDACCION).complete("s", "u")
    except RuntimeError as e:
        assert "cayo B" in str(e)
    else:
        raise AssertionError("deberia haber levantado el error del ultimo proveedor")


def test_respeta_el_tope_de_intentos(monkeypatch):
    """Acota la latencia del peor caso aunque alguien configure una lista larga."""
    _cascada(monkeypatch, redaccion="a@openai,b@google,c@openai,d@google,e@openai")
    monkeypatch.setattr(pc.get_settings(), "llm_cascade_max_intentos", 2, raising=False)
    llamados = _fake_client(monkeypatch, {"a@openai": RuntimeError("no"), "b@google": "ok"})
    assert ProviderCascade(REDACCION).complete("s", "u") == "ok"
    assert llamados == ["a@openai", "b@google"]


def test_cada_tarea_tiene_su_propia_cadena(monkeypatch):
    """El routing (1.5): redaccion y liviano no van al mismo modelo."""
    _cascada(monkeypatch, redaccion="grande@openai", liviano="chico@google")
    llamados = _fake_client(monkeypatch, {"grande@openai": "G", "chico@google": "C"})
    assert ProviderCascade(REDACCION).complete("s", "u") == "G"
    assert ProviderCascade(LIVIANO).complete("s", "u") == "C"
    assert llamados == ["grande@openai", "chico@google"]


def test_un_modelo_forzado_manda_y_la_cascada_queda_detras(monkeypatch):
    """Los auditores eligen su modelo; la cascada sigue cubriendolos si ese modelo falla."""
    _cascada(monkeypatch, liviano="respaldo@google")
    llamados = _fake_client(monkeypatch, {"elegido@default": RuntimeError("cayo"),
                                          "respaldo@google": "ok"})
    assert ProviderCascade(LIVIANO, model="elegido").complete("s", "u") == "ok"
    assert llamados == ["elegido@default", "respaldo@google"]


def test_stream_cae_a_la_alternativa_si_falla_antes_del_primer_token(monkeypatch):
    _cascada(monkeypatch, redaccion="a@openai,b@google")
    _fake_client(monkeypatch, {"a@openai": RuntimeError("cayo antes de emitir"),
                               "b@google": ["Hola", " colega"]})
    assert "".join(ProviderCascade(REDACCION).stream("s", "u")) == "Hola colega"


def test_stream_NO_reintenta_si_ya_emitio_texto(monkeypatch):
    """La decision que evita el peor resultado posible: una respuesta cosida de dos modelos.

    Si el proveedor se cae a mitad, el veterinario veria media recomendacion de uno y media de otro,
    sin coherencia clinica. Se prefiere cortar, que es como corta hoy.
    """
    _cascada(monkeypatch, redaccion="a@openai,b@google")

    def a_medias():
        yield "El diagnostico probable es"
        raise RuntimeError("se corto la conexion")

    llamados = _fake_client(monkeypatch, {"a@openai": a_medias(), "b@google": ["OTRA RESPUESTA"]})
    recibido = []
    try:
        for t in ProviderCascade(REDACCION).stream("s", "u"):
            recibido.append(t)
    except RuntimeError:
        pass
    else:
        raise AssertionError("deberia propagar el corte en vez de coser dos respuestas")
    assert recibido == ["El diagnostico probable es"]
    assert llamados == ["a@openai"]           # la alternativa NO se llamo


def test_el_cuerpo_del_proveedor_de_siempre_no_cambio(monkeypatch):
    """La garantia que hace seguro desplegar esto con demos en vivo: para el proveedor primario el
    cuerpo de la peticion es EXACTAMENTE el de antes.

    `thinking: {"type": "disabled"}` se movio a `_extra_body()` para poder omitirlo en Gemini, que lo
    rechaza con HTTP 400. Este test fija que ese movimiento no alterio lo que se le manda a DeepSeek.
    """
    from app.generation.llm_client import LLMClient

    assert LLMClient(provider="openai")._extra_body() == {"thinking": {"type": "disabled"}}
    assert LLMClient(provider="google")._extra_body() == {}       # Gemini lo rechazaria con 400
