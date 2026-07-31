"""Cascada entre proveedores (clausula 1.4) y routing por tarea (1.5). Sin LLM real."""
import app.generation.provider_cascade as pc
from app.generation.provider_cascade import LIVIANO, REDACCION, ProviderCascade, _parse


def _cascada(monkeypatch, redaccion="", liviano="", con_keys=True):
    s = pc.get_settings()
    monkeypatch.setattr(s, "llm_cascade_redaccion", redaccion, raising=False)
    monkeypatch.setattr(s, "llm_cascade_liviano", liviano, raising=False)
    monkeypatch.setattr(s, "llm_cascade_max_intentos", 3, raising=False)
    if con_keys:
        # Un candidato sin key se descarta de la cadena (no es una alternativa, es un 401
        # garantizado). Los tests que ejercitan la cadena necesitan keys de mentira; los que
        # ejercitan el DESCARTE pasan con_keys=False y ponen solo las que quieren.
        monkeypatch.setattr(s, "llm_api_key", "k-test", raising=False)
        monkeypatch.setattr(s, "gemini_api_key", "k-test", raising=False)
        monkeypatch.setattr(s, "anthropic_api_key", "k-test", raising=False)


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


def test_parse_descarta_proveedor_desconocido():
    """Un typo en el proveedor ("gemini" en vez de "google") NO puede ejecutarse: el despacho de
    LLMClient cae a Anthropic para nombres desconocidos, y eso mandaría la key del primario a un
    tercero. Se descarta con aviso, como el formato inválido."""
    assert _parse("m@gemini") == []
    assert _parse("m@deepseek,x@google") == [("x", "google")]
    assert _parse("m@ANTHROPIC") == [("m", "anthropic")]  # el case no es un typo


def test_candidato_sin_key_se_descarta_de_la_cadena(monkeypatch):
    """Un candidato sin credencial no es una alternativa: es un 401 garantizado que además tapa el
    error real del primario (la cascada re-levanta el ÚLTIMO fallo)."""
    _cascada(monkeypatch, redaccion="d@openai,g@google", con_keys=False)
    s = pc.get_settings()
    monkeypatch.setattr(s, "llm_api_key", "k-openai", raising=False)
    monkeypatch.setattr(s, "gemini_api_key", "", raising=False)      # Gemini SIN key
    monkeypatch.setattr(s, "anthropic_api_key", "", raising=False)
    assert pc.candidatos(REDACCION) == [("d", "openai")]

    # Y el fallo del primario llega ENTERO al llamador, no tapado por un 401 de Gemini.
    llamados = _fake_client(monkeypatch, {"d@openai": RuntimeError("saldo agotado")})
    try:
        ProviderCascade(REDACCION).complete("s", "u")
        raise AssertionError("debió levantar")
    except RuntimeError as e:
        assert "saldo agotado" in str(e)
    assert llamados == ["d@openai"]


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


def test_routing_por_consulta_manda_lo_dificil_a_su_propia_cadena(monkeypatch):
    """Clausula 1.5: no solo routing por TAREA, sino por CONSULTA.

    La banda `limited` significa que la literatura cubre el cuadro a medias — el caso donde el modelo
    tiende a rellenar el hueco con su propio conocimiento, que es el fallo mas caro en una historia
    clinica. Ahi se escala al modelo que mide mejor en fidelidad (ver COMPARATIVA-MODELOS).
    """
    from app.generation.provider_cascade import DIFICIL, task_para_banda

    assert task_para_banda("limited") == DIFICIL
    assert task_para_banda("sufficient") == REDACCION
    assert task_para_banda("none") == REDACCION      # sin literatura no hay a quien escalar

    _cascada(monkeypatch, redaccion="barato@openai")
    monkeypatch.setattr(pc.get_settings(), "llm_cascade_dificil", "fiel@anthropic", raising=False)
    llamados = _fake_client(monkeypatch, {"barato@openai": "B", "fiel@anthropic": "F"})

    assert ProviderCascade(task_para_banda("sufficient")).complete("s", "u") == "B"
    assert ProviderCascade(task_para_banda("limited")).complete("s", "u") == "F"
    assert llamados == ["barato@openai", "fiel@anthropic"]


def test_sin_cadena_dificil_configurada_el_caso_dificil_usa_la_de_siempre(monkeypatch):
    """Encender el routing por consulta es agregar una variable; apagarlo, borrarla. Sin ella el
    comportamiento es identico al anterior, que es lo que lo hace seguro de desplegar."""
    from app.generation.provider_cascade import DIFICIL

    _cascada(monkeypatch, redaccion="barato@openai")
    monkeypatch.setattr(pc.get_settings(), "llm_cascade_dificil", "", raising=False)
    llamados = _fake_client(monkeypatch, {"barato@openai": "B"})
    assert ProviderCascade(DIFICIL).complete("s", "u") == "B"
    assert llamados == ["barato@openai"]
