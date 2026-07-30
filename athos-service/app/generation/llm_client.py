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


class LLMClient:
    def __init__(self, model: str | None = None, provider: str | None = None,
                 base_url: str | None = None, api_key: str | None = None):
        s = get_settings()
        self.provider = (provider or s.llm_provider or "anthropic").lower()
        self.model = model or s.llm_model
        if self.provider == "google":
            # Gemini trae su propia key y base URL: así el proveedor primario puede seguir siendo
            # DeepSeek y Gemini convivir como alternativa sin pisarle las variables.
            self.api_key = api_key if api_key is not None else s.gemini_api_key
            self.base_url = (base_url or s.gemini_base_url or GOOGLE_BASE_URL).rstrip("/")
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
        import httpx
        with httpx.Client(verify=_tls_context(), timeout=120) as client:
            r = client.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                # thinking desactivado: los modelos v4 razonan ~30s antes del `content`; sin esto el
                # chat "se congela" y el JSON del Phantom gasta el presupuesto en 'thinking'. Equivale
                # al viejo deepseek-chat (no-razonador), la base validada en el golden.
                # Va por `_extra_body` porque Gemini rechaza ese parámetro con HTTP 400.
                json={"model": self.model, "max_tokens": max_tokens, "stream": False,
                      **self._extra_body(),
                      "messages": self._openai_messages(system, user)},
            )
            if r.status_code >= 400:
                # Incluye el cuerpo (motivo real del proveedor: modelo inválido, contexto, etc.).
                raise RuntimeError(f"LLM {self.model} HTTP {r.status_code}: {r.text[:400]}")
            data = r.json()
        # Ignora `reasoning_content` (solo el `content` final -> JSON limpio para el Phantom).
        return (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""

    def _openai_stream(self, system: str, user: str, max_tokens: int, history):
        import json

        import httpx
        with httpx.Client(verify=_tls_context(), timeout=120) as client:
            with client.stream(
                "POST", f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                # thinking desactivado: sin esto el primer token del chat tarda ~30s (razonamiento).
                # Va por `_extra_body` porque Gemini rechaza ese parámetro con HTTP 400.
                json={"model": self.model, "max_tokens": max_tokens, "stream": True,
                      **self._extra_body(),
                      "messages": self._openai_messages(system, user, history)},
            ) as r:
                if r.status_code >= 400:
                    body = r.read().decode("utf-8", "replace")[:400]
                    raise RuntimeError(f"LLM {self.model} HTTP {r.status_code}: {body}")
                for line in r.iter_lines():
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    payload = line[len("data:"):].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        obj = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    delta = (obj.get("choices") or [{}])[0].get("delta") or {}
                    content = delta.get("content")  # ignora reasoning_content
                    if content:
                        yield content
