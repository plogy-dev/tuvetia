"""Cascada entre PROVEEDORES de IA y routing por tipo de tarea (cláusula 1.4 y 1.5 del contrato).

⚠️ **No confundir con `app/retrieval/cascade.py`.** Esa es la cascada de RECUPERACIÓN de documentos
(filtros → léxico → vectorial) y no tiene ninguna relación con esto. Son dos cosas distintas con
nombre parecido, y la auditoría del Milestone 2 advierte explícitamente que la de retrieval **no debe
presentarse como evidencia de cumplimiento de la 1.4**. Esta sí lo es.

QUÉ HACE
Ante un error del proveedor primario —caída, timeout, límite de tasa, saldo agotado— reintenta la
misma generación con el siguiente proveedor de la lista, en orden de preferencia. Si todos fallan,
levanta el último error.

POR QUÉ ES SEGURO ENCENDERLO CON DEMOSTRACIONES EN VIVO, que es la restricción real de este cambio:

  1. **No cambia el camino feliz.** Si el primario responde, no hay una sola llamada extra ni un
     milisegundo extra: la lista sólo se recorre cuando hubo una excepción.
  2. **Sin configurar, no existe.** Con `LLM_CASCADE_* ` vacío se usa el proveedor de siempre y este
     módulo no interviene. Apagarlo devuelve el sistema exactamente a como estaba.
  3. **Sólo puede mejorar el peor caso.** Hoy, si DeepSeek se cae, la petición muere. Con la cascada,
     se responde con Gemini. Nunca convierte un éxito en un fallo.
  4. **El streaming sólo cae hacia atrás ANTES del primer token.** Una vez que el veterinario empezó a
     ver texto, cambiar de proveedor produciría una respuesta cosida de dos modelos: se prefiere
     fallar como falla hoy. Ver `stream()`.

ORDEN RECOMENDADO Y UNA ADVERTENCIA DE COSTOS
`deepseek-v4-flash@openai` primero (es el modelo validado contra el golden set) y
`gemini-3.6-flash@google` como alternativa. **Anthropic NO debe ir en la lista mientras su cuenta no
tenga crédito**: cada intento suyo agregaría una llamada fallida y su latencia antes de llegar al
proveedor que sí puede responder.
"""
import contextvars
import logging
import time

from app.config import get_settings
from app.generation.llm_client import LLMClient

log = logging.getLogger(__name__)

# El "modelo@proveedor" que respondió la ÚLTIMA generación de este contexto (petición). Existe para
# la trazabilidad clínica: `clinical_notes.ai_model` y `rag_answer_log.model` deben registrar quién
# respondió DE VERDAD — con la cascada, el modelo puede variar por petición, y registrar siempre
# LLM_MODEL escribía un modelo que no generó la nota que el veterinario firma (auditoría 2026-07-30).
# ContextVar y no atributo: `generate_note` instancia la cascada internamente y cambiarle la firma
# rompería a todos sus llamadores; los hilos nuevos (el juez del chat) arrancan con contexto propio,
# así que el juez no pisa la etiqueta de la redacción.
_ultimo_usado: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "cascada_ultimo_usado", default=None)


def modelo_usado(por_defecto: str) -> str:
    """Quién respondió la última generación de esta petición, o `por_defecto` si nada corrió aún."""
    return _ultimo_usado.get() or por_defecto

# Tareas ruteables. El nombre describe el PAPEL, no el modelo: es lo que permite cambiar el modelo de
# una tarea sin tocar el código que la invoca.
REDACCION = "redaccion"   # chat del vet y nota del Fantasma (calidad primero)
LIVIANO = "liviano"       # A->B, juez de evidencia, auditores (volumen y costo primero)
DIFICIL = "dificil"       # redacción de un caso con cobertura LIMITADA (fidelidad primero)


# Proveedores que LLMClient sabe despachar. La lista blanca existe porque el despacho cae a
# Anthropic para cualquier nombre desconocido: un typo como "gemini" en vez de "google" mandaría
# la key del primario (DeepSeek) a api.anthropic.com — credencial filtrada a un tercero, y un
# fallo por candidato en cada petición. Un typo se descarta con aviso, no se ejecuta.
PROVEEDORES_VALIDOS = {"openai", "google", "anthropic"}


def _parse(spec: str) -> list[tuple[str, str]]:
    """"modelo@proveedor,modelo@proveedor" -> [(modelo, proveedor), ...], ignorando lo malformado.

    Tolerante a propósito: una entrada mal escrita en una variable de entorno no puede tumbar el
    servicio en el arranque. Lo que no se entiende se descarta con un aviso en el log.
    """
    salida: list[tuple[str, str]] = []
    for parte in (spec or "").split(","):
        parte = parte.strip()
        if not parte:
            continue
        modelo, sep, proveedor = parte.partition("@")
        if not sep or not modelo.strip() or not proveedor.strip():
            log.warning("cascada de proveedores: entrada ignorada por formato inválido: %r", parte)
            continue
        proveedor = proveedor.strip().lower()
        if proveedor not in PROVEEDORES_VALIDOS:
            log.warning("cascada de proveedores: proveedor desconocido %r ignorado (válidos: %s)",
                        proveedor, ", ".join(sorted(PROVEEDORES_VALIDOS)))
            continue
        salida.append((modelo.strip(), proveedor))
    return salida


def _con_credencial(pares: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Descarta candidatos cuyo proveedor no tiene key configurada.

    Un candidato sin key no es una alternativa: es un 401 garantizado que suma latencia y, peor,
    ENMASCARA el error real del primario (la cascada re-levanta el último fallo, y "API key not
    valid" taparía un saldo agotado o un 429 del proveedor que sí importa).
    """
    s = get_settings()
    salida: list[tuple[str, str]] = []
    for modelo, proveedor in pares:
        if proveedor == "google" and not s.gemini_api_key:
            log.warning("cascada de proveedores: %s@google descartado — GEMINI_API_KEY vacía", modelo)
            continue
        if proveedor == "anthropic" and not s.anthropic_api_key:
            log.warning("cascada de proveedores: %s@anthropic descartado — ANTHROPIC_API_KEY vacía "
                        "(la key general es del primario y no sirve contra Anthropic)", modelo)
            continue
        if proveedor == "openai" and not s.llm_api_key:
            log.warning("cascada de proveedores: %s@openai descartado — LLM_API_KEY vacía", modelo)
            continue
        salida.append((modelo, proveedor))
    return salida


def candidatos(task: str) -> list[tuple[str, str]]:
    """Lista ordenada de (modelo, proveedor) para la tarea. Vacía = usar el cliente de siempre.

    `DIFICIL` cae a la cadena de redacción si no está configurada: así, encender el routing por
    consulta es agregar una variable, y apagarlo es borrarla — sin tocar código ni desplegar.
    """
    s = get_settings()
    if task == LIVIANO:
        spec = s.llm_cascade_liviano
    elif task == DIFICIL:
        spec = s.llm_cascade_dificil or s.llm_cascade_redaccion
    else:
        spec = s.llm_cascade_redaccion
    return _con_credencial(_parse(spec))[: max(1, s.llm_cascade_max_intentos)]


def task_para_banda(banda: str) -> str:
    """Elige la cadena según la COBERTURA de literatura que el juez encontró para ESTA consulta.

    Es el routing por consulta de la cláusula 1.5. La banda `limited` significa que la literatura
    cubre el cuadro sólo a medias — el caso donde el modelo tiende a rellenar el hueco con su propio
    conocimiento, que es el fallo más caro en una historia clínica. Ahí conviene el modelo que mide
    mejor en fidelidad, aunque cueste más; en el resto, el barato que mide mejor en utilidad.
    """
    return DIFICIL if banda == "limited" else REDACCION


class ProviderCascade:
    """Ejecuta una generación probando los proveedores de `task` en orden.

    Si no hay cascada configurada, delega en un `LLMClient` normal — mismo comportamiento que antes
    de que este módulo existiera.
    """

    def __init__(self, task: str, model: str | None = None, timeout: float | None = None):
        self.task = task
        # `model` fuerza el modelo del primario (lo usan los auditores, que eligen el suyo). En ese
        # caso el primario es el forzado y la cascada queda como alternativa detrás.
        self.model_forzado = model
        # Tope HTTP por candidato. El LIVIANO corre en caminos que el vet ESPERA (distilación,
        # juez) o que fallan abiertas (auditores): 20s de tope evita que un proveedor colgado
        # cueste los 120s del redactor — la alternativa de la cascada entra 6x antes.
        self.timeout = timeout if timeout is not None else (20.0 if task == LIVIANO else None)
        self.usado: str | None = None      # "modelo@proveedor" que respondió; para trazabilidad

    @staticmethod
    def _etiqueta(modelo: str | None, proveedor: str | None) -> str:
        """Etiqueta trazable "modelo@proveedor" con los nombres RESUELTOS (no "default")."""
        s = get_settings()
        return f"{modelo or s.llm_model}@{proveedor or (s.llm_provider or 'anthropic').lower()}"

    def _cadena(self) -> list[tuple[str, str | None]]:
        lista: list[tuple[str, str | None]] = []
        if self.model_forzado:
            lista.append((self.model_forzado, None))       # None = proveedor por defecto del entorno
        lista.extend(candidatos(self.task))
        if not lista:
            lista.append((None, None))                      # el cliente de siempre, tal cual
        return lista

    def complete(self, system: str, user: str, max_tokens: int = 2000) -> str:
        cadena = self._cadena()
        ultimo: Exception | None = None
        errores: list[str] = []
        for i, (modelo, proveedor) in enumerate(cadena):
            t0 = time.monotonic()
            try:
                texto = LLMClient(model=modelo, provider=proveedor, timeout=self.timeout).complete(
                    system, user, max_tokens=max_tokens)
                self.usado = self._etiqueta(modelo, proveedor)
                _ultimo_usado.set(self.usado)
                if i:
                    log.warning("cascada de proveedores: respondió la alternativa %s tras %s fallo(s)",
                                self.usado, i)
                return texto
            except Exception as e:  # noqa: BLE001 — se prueba el siguiente proveedor
                ultimo = e
                errores.append(f"{self._etiqueta(modelo, proveedor)}: {str(e)[:200]}")
                log.warning("cascada de proveedores: falló %s@%s en %.1fs (%s)",
                            modelo or "default", proveedor or "default",
                            time.monotonic() - t0, str(e)[:200])
        # Se re-levanta el ÚLTIMO error, pero el diagnóstico completo va al log: el error del
        # PRIMARIO es el que suele importar (saldo, 429, contexto) y quedaría tapado por un fallo
        # tonto de la alternativa (p. ej. key inválida) si solo sobreviviera el último mensaje.
        if len(errores) > 1:
            log.error("cascada de proveedores agotada (%s intentos): %s",
                      len(errores), " | ".join(errores))
        raise ultimo if ultimo else RuntimeError("cascada de proveedores sin candidatos")

    def stream(self, system: str, user: str, max_tokens: int = 1500,
               history: list[dict] | None = None):
        """Igual que `complete`, pero **la alternativa sólo entra si el fallo ocurre antes del primer
        token**.

        Es la decisión que evita el peor resultado posible: si el proveedor se cae a mitad de la
        respuesta y se reintentara con otro, el veterinario vería un texto cosido de dos modelos —
        media recomendación de uno y media del otro, sin coherencia clínica. Cortar como se corta hoy
        es preferible. Antes del primer token no hay nada emitido, así que ahí sí se puede cambiar sin
        que se note.
        """
        cadena = self._cadena()
        ultimo: Exception | None = None
        errores: list[str] = []
        for i, (modelo, proveedor) in enumerate(cadena):
            emitido = False
            try:
                for trozo in LLMClient(model=modelo, provider=proveedor, timeout=self.timeout).stream(
                        system, user, max_tokens=max_tokens, history=history):
                    emitido = True
                    yield trozo
                self.usado = self._etiqueta(modelo, proveedor)
                _ultimo_usado.set(self.usado)
                if i:
                    log.warning("cascada de proveedores (stream): respondió %s tras %s fallo(s)",
                                self.usado, i)
                return
            except Exception as e:  # noqa: BLE001
                ultimo = e
                errores.append(f"{self._etiqueta(modelo, proveedor)}: {str(e)[:200]}")
                if emitido:
                    log.error("cascada de proveedores: %s@%s falló DESPUÉS de emitir; no se reintenta "
                              "para no coser dos respuestas (%s)",
                              modelo or "default", proveedor or "default", str(e)[:200])
                    raise
                log.warning("cascada de proveedores (stream): falló %s@%s antes del primer token (%s)",
                            modelo or "default", proveedor or "default", str(e)[:200])
        if len(errores) > 1:
            log.error("cascada de proveedores agotada (%s intentos): %s",
                      len(errores), " | ".join(errores))
        raise ultimo if ultimo else RuntimeError("cascada de proveedores sin candidatos")
