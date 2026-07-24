"""Sugerencias de respuesta para WhatsApp (bandeja de Comunicaciones) — con aprobación humana.

Athos redacta un BORRADOR de respuesta al titular; el vet lo edita y lo envía desde la bandeja
(`agent_mode=review`: acá NUNCA se envía nada). Usa el modelo liviano (LLM_LIGHT_MODEL): es texto
cordial de coordinación, no una nota clínica.

Guardrails (en el prompt, reforzados por el flujo humano):
- Sin diagnósticos, dosis ni indicaciones clínicas cerradas: ante lo clínico -> empatía + cita.
- No inventar datos de la clínica (horarios, precios, direcciones).
- Tono WhatsApp: breve, cordial, español.
"""
from app.config import get_settings
from app.generation.llm_client import LLMClient

WHATSAPP_SYSTEM_PROMPT = """Eres el asistente de comunicación de una clínica veterinaria en Colombia.
Redactas BORRADORES de respuesta de WhatsApp para los titulares (dueños de mascotas). Un veterinario
revisará y editará tu borrador antes de enviarlo — tú nunca envías nada.

Reglas estrictas:
1. NUNCA des diagnósticos, dosis, ni indicaciones clínicas concretas por chat. Si la consulta es
   clínica (síntomas, urgencias, medicamentos), responde con empatía y sugiere agendar una cita o
   acudir a la clínica; si suena urgente, recomienda acudir de inmediato.
2. NUNCA inventes datos de la clínica: horarios, precios, direcciones o disponibilidad. Si los
   preguntan, di que el equipo se los confirma enseguida.
3. Tono: cordial, cercano y profesional. Breve (1-3 frases, estilo WhatsApp). Español. Puedes usar
   un emoji ocasional si el tono lo permite.
4. Responde SOLO con el texto del borrador, sin comillas ni explicaciones.
"""

MAX_TURNS = 15


def build_reply_prompt(messages: list[dict], owner_name: str | None = None) -> str:
    """Arma el prompt de usuario con el hilo reciente. Puro -> testeable sin red.

    `messages`: [{direction: inbound|outbound, body: str}] en orden cronológico.
    """
    turns = [m for m in messages if (m.get("body") or "").strip()][-MAX_TURNS:]
    lines = []
    for m in turns:
        who = "Titular" if m.get("direction") == "inbound" else "Clínica"
        lines.append(f"{who}: {m['body'].strip()}")
    convo = "\n".join(lines) if lines else "(sin mensajes previos)"
    quien = f" El titular se llama {owner_name}." if owner_name else ""
    return (
        f"Conversación reciente:{quien}\n\n{convo}\n\n"
        "Redacta el borrador de respuesta de la clínica al último mensaje del titular."
    )


def suggest_reply(messages: list[dict], owner_name: str | None = None) -> str:
    """Genera el borrador con el modelo liviano. Devuelve texto plano."""
    s = get_settings()
    client = LLMClient(model=s.llm_light_model)
    draft = client.complete(WHATSAPP_SYSTEM_PROMPT, build_reply_prompt(messages, owner_name),
                            max_tokens=300)
    return draft.strip().strip('"')
