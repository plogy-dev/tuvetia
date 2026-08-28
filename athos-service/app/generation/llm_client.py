"""Cliente LLM multi-proveedor. Modelo, proveedor y key vienen de env (nada hardcodeado).

Ruteo por `LLM_PROVIDER`:
- `anthropic` (SDK oficial, prompt caching en el system estable, thinking desactivado).
- `openai`   (compatible: DeepSeek, Moonshot/Kimi) vía **httpx directo** a `{LLM_BASE_URL}/chat/
  completions` — sin dependencia nueva. Ignora `reasoning_content` (solo `content`) para JSON limpio.
- `google`   (Gemini) por su endpoint **compatible con OpenAI**, así que reusa el mismo cuerpo HTTP
  que `openai` en vez de agregar el SDK de Google. Ver la nota de `_extra_body`, que es donde está la
  única diferencia real y la razón por la que no se puede reusar tal cual.

TLS vía el trust store del SO (`truststore`, igual que embeddings): la red de dev usa un proxy MITM
cuya CA rechaza OpenSSL 3. Mantener el cuerpo detrás de esta interfaz permite cambiar de proveedor
sin tocar el flujo de generación.
"""
from app.config import get_settings
from app.embeddings import _tls_context

GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"

# Un solo cliente HTTP por proceso (keep-alive): abrir un httpx.Client POR LLAMADA pagaba el
# handshake TCP+TLS (~100-300ms) en cada una, y un chat hace 4-5 (distil, redacción, juez,
# fidelidad). httpx.Client es thread-safe; el timeout va POR PETICIÓN (cada tarea trae el suyo).
# La caché va POR CLASE: los tests monkeypatchean `httpx.Client` con un fake distinto cada uno,
# y una instancia cacheada entre tests (o del cliente real) rompería el aislamiento.
_http = None
_http_cls = None


def _http_client():
    global _http, _http_cls
    import httpx
    if _http is None or _http_cls is not httpx.Client:
        _http = httpx.Client(verify=_tls_context(), timeout=120)
        _http_cls = httpx.Client
    return _http


class RespuestaVaciaError(RuntimeError):
    """El proveedor respondió 200 pero sin contenido utilizable (vacío, solo razonamiento, o
    cortado por max_tokens). Es una clase propia para que quien reintenta pueda distinguirla de un
    fallo HTTP: `generate_note` la trata como reintentable (medido: la misma transcripción que
    salió vacía generó bien al reintentar) y la cascada la trata como fallo del candidato."""


class LLMClient:
    def __init__(self, model: str | None = None, provider: str | None = None,
                 base_url: str | None = None, api_key: str | None = None,
                 timeout: float | None = None):
        s = get_settings()
        # 120s es el tope del REDACTOR. Las tareas livianas del camino crítico (distilación, juez)
        # pasan uno corto: un proveedor colgado no puede costar 120s de primer token (auditoría
        # 28-ago) — la degradación de cada llamador (glosario solo, falla abierta) es más barata.
        self.timeout = 120.0 if timeout is None else timeout
        self.provider = (provider or s.llm_provider or "anthropic").lower()
        self.model = model or s.llm_model
        if self.provider == "google":
            # Gemini trae su propia key y base URL: así el proveedor primario puede seguir siendo
            # DeepSeek y Gemini convivir como alternativa sin pisarle las variables.
            self.api_key = api_key if api_key is not None else s.gemini_api_key
            self.base_url = (base_url or s.gemini_base_url or GOOGLE_BASE_URL).rstrip("/")
        elif self.provider == "anthropic":
            # Key propia si existe; si no, la general (que es como funcionaba cuando anthropic era el
            # primario). Sin esto, usar Claude como ALTERNATIVA de la cascada intentaria autenticarse
            # con la key de DeepSeek y fallaria en el 100% de los casos.
            self.api_key = api_key if api_key is not None else (s.anthropic_api_key or s.llm_api_key)
            self.base_url = (base_url if base_url is not None else s.llm_base_url).rstrip("/")
        else:
            self.api_key = api_key if api_key is not None else s.llm_api_key
            self.base_url = (base_url if base_url is not None else s.llm_base_url).rstrip("/")
        self._client = None

    # ------------------------------------------------------------------ dispatch
    def complete(self, system: str, user: str, max_tokens: int = 2000) -> str:
        """Una llamada de generación (self.model desde env). Devuelve el texto de la respuesta."""
        if self.provider in ("openai", "google"):
            return self._openai_complete(system, user, max_tokens)
        return self._anthropic_complete(system, user, max_tokens)

    def stream(self, system: str, user: str, max_tokens: int = 1500,
               history: list[dict] | None = None):
        """Genera en streaming (para SSE): fragmentos de texto a medida que llegan.

        `history` (opcional) son los turnos previos [{role, content}, ...] del hilo; van ANTES del
        turno actual para dar memoria."""
        if self.provider in ("openai", "google"):
            yield from self._openai_stream(system, user, max_tokens, history)
        else:
            yield from self._anthropic_stream(system, user, max_tokens, history)

    def _extra_body(self) -> dict:
        """Parámetros propios del proveedor que van en el cuerpo de la petición.

        Existe por un detalle que rompe en caliente: `thinking: {"type": "disabled"}` es de DeepSeek,
        y **Gemini lo rechaza con HTTP 400** (`Unknown name "thinking": Cannot find field`). Mandarlo
        a Gemini haría fallar el 100 % de sus llamadas, así que no puede ir fijo en el cuerpo común.
        `reasoning_effort: "none"` tampoco sirve — Gemini también lo rechaza con 400.

        A Gemini se le manda el cuerpo pelado. Razona igual y gasta tokens en ello (medido: ~180
        totales para 5 de respuesta), así que necesita presupuesto holgado — que es justo lo que ya
        usa este servicio (3000 en el chat, 4000 en la nota) por la misma razón con los modelos v4.
        """
        if self.provider == "google":
            return {}
        return {"thinking": {"type": "disabled"}}

    # ------------------------------------------------------------------ anthropic
    def _anthropic(self):
        if self._client is None:
            import anthropic
            from anthropic import DefaultHttpxClient
            self._client = anthropic.Anthropic(
                api_key=self.api_key,
                http_client=DefaultHttpxClient(verify=_tls_context()),
                # Sin esto, el SDK usa su default (~10 min): como alternativa de cascada podía
                # colgar una petición mucho más que los 120s del resto de proveedores.
                timeout=self.timeout,
            )
        return self._client

    def _anthropic_complete(self, system: str, user: str, max_tokens: int) -> str:
        # Salida estructurada (JSON): sin thinking -> predecible, barato, y todo el presupuesto de
        # tokens va a la respuesta. El system (prefijo estable) va con prompt caching.
        resp = self._anthropic().messages.create(
            model=self.model,
            max_tokens=max_tokens,
            thinking={"type": "disabled"},
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
        )
        return "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")

    def _anthropic_stream(self, system: str, user: str, max_tokens: int, history):
        messages = list(history or []) + [{"role": "user", "content": user}]
        with self._anthropic().messages.stream(
            model=self.model,
            max_tokens=max_tokens,
            thinking={"type": "disabled"},
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=messages,
        ) as s:
            yield from s.text_stream

    # ------------------------------------------------------------------ openai-compatible
    def _openai_messages(self, system: str, user: str, history=None) -> list[dict]:
        # OpenAI-compat: el system va como primer mensaje (no hay campo `system` aparte).
        return [{"role": "system", "content": system}, *(history or []),
                {"role": "user", "content": user}]

    def _openai_complete(self, system: str, user: str, max_tokens: int) -> str:
        r = _http_client().post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            # thinking desactivado: los modelos v4 razonan ~30s antes del `content`; sin esto el
            # chat "se congela" y el JSON del Phantom gasta el presupuesto en 'thinking'. Equivale
            # al viejo deepseek-chat (no-razonador), la base validada en el golden.
            # Va por `_extra_body` porque Gemini rechaza ese parámetro con HTTP 400.
            json={"model": self.model, "max_tokens": max_tokens, "stream": False,
                  **self._extra_body(),
                  "messages": self._openai_messages(system, user)},
            timeout=self.timeout,
        )
        if r.status_code >= 400:
            # Incluye el cuerpo (motivo real del proveedor: modelo inválido, contexto, etc.).
            raise RuntimeError(f"LLM {self.model} HTTP {r.status_code}: {r.text[:400]}")
        data = r.json()
        # Ignora `reasoning_content` (solo el `content` final -> JSON limpio para el Phantom).
        choice = (data.get("choices") or [{}])[0]
        content = (choice.get("message") or {}).get("content") or ""
        finish = choice.get("finish_reason")
        # Una respuesta vacía o cortada por presupuesto NO es un éxito: devolverla como si lo
        # fuera impedía que la cascada probara la alternativa (el fallo más probable con Gemini,
        # que gasta el presupuesto en razonamiento antes del content — medido ~180 tokens para 5
        # de respuesta). Se levanta y que decida quien llama.
        if not content.strip():
            raise RespuestaVaciaError(
                f"LLM {self.model}: respuesta sin contenido (finish_reason={finish!r})")
        if finish == "length":
            raise RespuestaVaciaError(
                f"LLM {self.model}: respuesta cortada por max_tokens (finish_reason=length)")
        return content

    def _openai_stream(self, system: str, user: str, max_tokens: int, history):
        import json

        with _http_client().stream(
                "POST", f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                # thinking desactivado: sin esto el primer token del chat tarda ~30s (razonamiento).
                # Va por `_extra_body` porque Gemini rechaza ese parámetro con HTTP 400.
                json={"model": self.model, "max_tokens": max_tokens, "stream": True,
                      **self._extra_body(),
                      "messages": self._openai_messages(system, user, history)},
                timeout=self.timeout,
        ) as r:
                if r.status_code >= 400:
                    body = r.read().decode("utf-8", "replace")[:400]
                    raise RuntimeError(f"LLM {self.model} HTTP {r.status_code}: {body}")
                emitido = False
                cerrado = False   # llegó el [DONE] del protocolo
                finish = None
                for line in r.iter_lines():
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    payload = line[len("data:"):].strip()
                    if payload == "[DONE]":
                        cerrado = True
                        break
                    try:
                        obj = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    choice = (obj.get("choices") or [{}])[0]
                    if choice.get("finish_reason"):
                        finish = choice["finish_reason"]
                    delta = choice.get("delta") or {}
                    content = delta.get("content")  # ignora reasoning_content
                    if content:
                        emitido = True
                        yield content
                # Un stream que termina sin emitir nada (solo razonamiento, o presupuesto agotado
                # antes del content) o que se corta sin el [DONE] del protocolo (proxy/LB reciclando
                # la conexión) NO es un éxito: antes terminaba en silencio y la cascada lo daba por
                # bueno — media respuesta entregada como completa. Se levanta: si aún no se emitió,
                # la cascada prueba la alternativa; si ya se emitió, el error queda registrado en
                # vez de fingir que el texto está entero.
                if not emitido:
                    raise RespuestaVaciaError(
                        f"LLM {self.model}: stream sin contenido (finish_reason={finish!r})")
                if finish == "length":
                    raise RespuestaVaciaError(
                        f"LLM {self.model}: stream cortado por max_tokens (finish_reason=length)")
                if not cerrado and finish is None:
                    # Ni [DONE] ni finish_reason: la conexión murió a mitad de la respuesta.
                    raise RuntimeError(
                        f"LLM {self.model}: stream cortado sin [DONE] ni finish_reason — "
                        f"respuesta incompleta")
