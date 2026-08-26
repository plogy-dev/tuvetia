"""Lo que el servicio dice de sí mismo al arrancar.

POR QUÉ EXISTE. El 2026-08-22, para saber qué modelo estaba redactando las notas en producción hubo
que GENERAR UNA NOTA y mirar `clinical_notes.ai_model`. Una llamada al modelo para averiguar cuál es
el modelo. No había otra forma: `/health` responde `{"status":"ok"}` y nada más, y la configuración
vive en variables de Railway que no se ven desde el repo.

Y HAY UNA TRAMPA ATRÁS. Los defaults de `config.py` son `claude-sonnet-5@anthropic`, mientras que
`provider_cascade.py` dice —con todas las letras— que Anthropic **no debe usarse mientras su cuenta
no tenga crédito**. O sea que "sin configuración" es justo la configuración que se sabe rota: el
servicio arrancaría igual, pasaría el healthcheck de Railway igual, y moriría en la primera
generación. Con un healthcheck en verde.

Esto no lo arregla —los defaults son una decisión aparte— pero lo hace VISIBLE en el log de arranque,
que es donde alguien va a mirar cuando algo no responda. Sin secretos: nombres de modelo y booleanos
de "hay key o no", nunca el valor.

NO SE EXPONE POR HTTP a propósito. `/health` es público; qué modelo hay debajo es información de
producto, no de operación pública.
"""
import logging

log = logging.getLogger(__name__)

#: Proveedores cuya key propia se comprueba aparte de la general (`LLM_API_KEY`).
KEYS = ("llm_api_key", "anthropic_api_key", "gemini_api_key", "embedding_api_key", "deepgram_api_key",
        "xai_api_key")


def _si_no(v: object) -> str:
    return "sí" if v else "NO"


def resumen(s) -> list[str]:
    """Las líneas que se escriben al arrancar. Pura: se arma con lo que ya está resuelto."""
    lineas = [
        f"modelos — redacción: {s.llm_model}@{s.llm_provider} · liviano: {s.llm_light_model} · juez: {s.judge_model_name}",
    ]

    cadenas = [
        ("redacción", s.llm_cascade_redaccion),
        ("liviano", s.llm_cascade_liviano),
        ("difícil", s.llm_cascade_dificil),
    ]
    puestas = [f"{nombre}: {spec}" for nombre, spec in cadenas if spec]
    lineas.append("cascada — " + (" · ".join(puestas) if puestas else "sin configurar (se usa el cliente de siempre)"))

    lineas.append("credenciales — " + " ".join(f"{k.replace('_api_key', '')}={_si_no(getattr(s, k, ''))}" for k in KEYS))
    # STT (auditoría 26-ago): tras la migración a Grok, el proveedor de transcripción es una
    # decisión de negocio — el arranque tiene que decir cuál quedó activo, no dejarlo a adivinar.
    lineas.append(f"stt — proveedor: {getattr(s, 'stt_provider', 'deepgram')}"
                  f" · modelo deepgram: {getattr(s, 'stt_model', 'nova-2')}")
    return lineas


def advertencias(s) -> list[str]:
    """Lo que hay que gritar. Vacío es la respuesta buena."""
    avisos = []

    # LA QUE IMPORTA: el proveedor que va a redactar no tiene con qué autenticarse. Hoy esto se
    # descubre cuando un veterinario aprieta "Generar sugerencia" y no pasa nada.
    key_del_primario = {
        "anthropic": getattr(s, "anthropic_api_key", "") or getattr(s, "llm_api_key", ""),
        "openai": getattr(s, "llm_api_key", ""),
    }.get(s.llm_provider, getattr(s, "llm_api_key", ""))
    if not key_del_primario:
        avisos.append(
            f"el proveedor de redacción es {s.llm_provider} y NO tiene key: toda generación va a "
            "fallar, pero /health seguirá en verde"
        )

    # Y la trampa del default: Anthropic está excluido a propósito (ver `provider_cascade.py`).
    if s.llm_provider == "anthropic":
        avisos.append(
            "el proveedor de redacción es anthropic, que `provider_cascade.py` excluye mientras su "
            "cuenta no tenga crédito. ¿Se perdieron las variables de entorno? El validado contra el "
            "golden set es deepseek-v4-flash@openai"
        )

    if not getattr(s, "embedding_api_key", ""):
        avisos.append("sin key de embeddings: el Tier 2 vectorial queda fuera y el retrieval degrada")

    # STT (auditoría 26-ago): la trampa espejo de la de redacción — STT_PROVIDER=grok sin
    # XAI_API_KEY (o sin NINGUNA key de STT) deja la transcripción muerta con /health en verde.
    stt = str(getattr(s, "stt_provider", "deepgram") or "").strip().lower()
    if stt == "grok" and not getattr(s, "xai_api_key", ""):
        avisos.append("STT_PROVIDER=grok sin XAI_API_KEY: toda transcripción irá directo al respaldo "
                      "Deepgram (o fallará si tampoco hay DEEPGRAM_API_KEY)")
    if not getattr(s, "xai_api_key", "") and not getattr(s, "deepgram_api_key", ""):
        avisos.append("sin NINGUNA key de STT (ni xai ni deepgram): la transcripción de consultas va "
                      "a fallar, pero /health seguirá en verde")
    return avisos


def anunciar(s) -> None:
    """Escribe el resumen en el log. Lo llama el arranque de la app."""
    for linea in resumen(s):
        log.info("Athos arranca | %s", linea)
    for aviso in advertencias(s):
        log.warning("Athos arranca | AVISO: %s", aviso)
