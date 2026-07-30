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
import logging
import time

from app.config import get_settings
from app.generation.llm_client import LLMClient

log = logging.getLogger(__name__)

# Tareas ruteables. El nombre describe el PAPEL, no el modelo: es lo que permite cambiar el modelo de
# una tarea sin tocar el código que la invoca.
REDACCION = "redaccion"   # chat del vet y nota del Fantasma (calidad primero)
LIVIANO = "liviano"       # A->B, juez de evidencia, auditores (volumen y costo primero)
DIFICIL = "dificil"       # redacción de un caso con cobertura LIMITADA (fidelidad primero)


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
        salida.append((modelo.strip(), proveedor.strip().lower()))
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
    return _parse(spec)[: max(1, s.llm_cascade_max_intentos)]


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

    def __init__(self, task: str, model: str | None = None):
        self.task = task
        # `model` fuerza el modelo del primario (lo usan los auditores, que eligen el suyo). En ese
        # caso el primario es el forzado y la cascada queda como alternativa detrás.
        self.model_forzado = model
        self.usado: str | None = None      # "modelo@proveedor" que respondió; para trazabilidad

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
        for i, (modelo, proveedor) in enumerate(cadena):
            t0 = time.monotonic()
            try:
                texto = LLMClient(model=modelo, provider=proveedor).complete(
                    system, user, max_tokens=max_tokens)
                self.usado = f"{modelo or 'default'}@{proveedor or 'default'}"
                if i:
                    log.warning("cascada de proveedores: respondió la alternativa %s tras %s fallo(s)",
                                self.usado, i)
                return texto
            except Exception as e:  # noqa: BLE001 — se prueba el siguiente proveedor
                ultimo = e
                log.warning("cascada de proveedores: falló %s@%s en %.1fs (%s)",
                            modelo or "default", proveedor or "default",
                            time.monotonic() - t0, str(e)[:200])
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
        for i, (modelo, proveedor) in enumerate(cadena):
            emitido = False
            try:
                for trozo in LLMClient(model=modelo, provider=proveedor).stream(
                        system, user, max_tokens=max_tokens, history=history):
                    emitido = True
                    yield trozo
                self.usado = f"{modelo or 'default'}@{proveedor or 'default'}"
                if i:
                    log.warning("cascada de proveedores (stream): respondió %s tras %s fallo(s)",
                                self.usado, i)
                return
            except Exception as e:  # noqa: BLE001
                ultimo = e
                if emitido:
                    log.error("cascada de proveedores: %s@%s falló DESPUÉS de emitir; no se reintenta "
                              "para no coser dos respuestas (%s)",
                              modelo or "default", proveedor or "default", str(e)[:200])
                    raise
                log.warning("cascada de proveedores (stream): falló %s@%s antes del primer token (%s)",
                            modelo or "default", proveedor or "default", str(e)[:200])
        raise ultimo if ultimo else RuntimeError("cascada de proveedores sin candidatos")
