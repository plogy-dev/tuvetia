"""Tests del borrador de WhatsApp: prompt builder puro (sin red) + guardrails del system prompt.

Lo clínicamente importante: el system prompt DEBE prohibir diagnósticos/dosis por chat y el
endpoint nunca envía — el humano aprueba (agent_mode=review).
"""
from app.whatsapp_reply import MAX_TURNS, WHATSAPP_SYSTEM_PROMPT, build_reply_prompt


def test_arma_el_hilo_con_roles():
    prompt = build_reply_prompt(
        [
            {"direction": "inbound", "body": "Hola, ¿tienen cita para mañana?"},
            {"direction": "outbound", "body": "¡Hola! Claro, ¿en qué horario te sirve?"},
            {"direction": "inbound", "body": "Por la tarde"},
        ],
        owner_name="Carlos",
    )
    assert "Titular: Hola, ¿tienen cita para mañana?" in prompt
    assert "Clínica: ¡Hola! Claro, ¿en qué horario te sirve?" in prompt
    assert prompt.index("Titular: Hola") < prompt.index("Titular: Por la tarde"), "orden cronológico"
    assert "Carlos" in prompt


def test_recorta_a_los_ultimos_turnos_y_salta_vacios():
    msgs = [{"direction": "inbound", "body": f"m{i}"} for i in range(30)]
    msgs.insert(0, {"direction": "inbound", "body": "   "})  # vacío -> fuera
    prompt = build_reply_prompt(msgs)
    assert "m29" in prompt and "m5" not in prompt, f"solo los últimos {MAX_TURNS} turnos"
    assert prompt.count("Titular:") == MAX_TURNS


def test_sin_mensajes_no_revienta():
    assert "(sin mensajes previos)" in build_reply_prompt([])


def test_guardrails_en_el_system_prompt():
    p = WHATSAPP_SYSTEM_PROMPT
    assert "NUNCA des diagnósticos" in p
    assert "NUNCA inventes datos" in p
    assert "veterinario revisará" in p or "revisará" in p, "el humano aprueba siempre"
