# -*- coding: utf-8 -*-
"""Variantes del prompt de redacción del chat, para comparar A/B con `respuestas_ab.py`.

La variante `actual` se IMPORTA de `app.chat` (nunca se copia: una copia mentiría en cuanto el
prompt de producción cambie). Las candidatas viven acá hasta que ganan la medición; recién
entonces se mueven a `app/chat.py`.

Historia de lo medido (2026-07-29, banco de `respuestas_eval.py` contra producción):

1. El prompt original producía respuestas correctas y seguras pero **de nivel resumen**: utilidad
   5,9 y sólo 3/23 respuestas que un veterinario experimentado seguiría. El juez pedía SIEMPRE lo
   mismo — diferenciales priorizados, siguiente paso concreto, criterios de urgencia. La variante
   de "clínico que decide" ganó el A/B **15-0** y pasó a producción: utilidad 9,0, confianza 16/24.
2. Lo que NO movió: **la fidelidad de las citas** (18/24 respuestas con al menos una cita que no
   sostiene lo afirmado, igual que antes). De ahí sale `CITAS_ESTRICTAS`.
"""
from app.chat import CHAT_SYSTEM

# ---------------------------------------------------------------------------------------------
# Candidata "citas_estrictas": ataca el modo de falla que quedó abierto. La anatomía de las 18
# respuestas con citas infieles (revisadas una por una) NO muestra cifras inventadas —medido: de 14
# cifras duras presentadas con cita, 11 estaban en el pasaje, y los 3 fallos son de una sola
# respuesta—, sino tres patrones semánticos:
#
#   a) EXTRAPOLAR: el pasaje dice algo vecino y la afirmación lo estira ("fuerza la interpretación
#      del pasaje [2]"; "atribuye a [1] un 'suele ser' sobre un caso anecdótico").
#   b) CITAR TABLAS como si fueran narrativa: "[2] es una tabla de datos de laboratorio que no
#      contiene información sobre la resolución de petequias".
#   c) CITA MÚLTIPLE DECORATIVA: "[1, 5, 11]" al final de una afirmación compuesta, donde ninguna
#      de las tres la sostiene entera.
#
# La regla pide granularidad (cita la cláusula, no el párrafo), prohíbe la cita múltiple sin que
# CADA fuente sostenga lo afirmado, y nombra explícitamente el caso de la tabla y el del caso único.
#
# ⛔ **MEDIDA Y DESCARTADA (2026-07-29): empeora TODO.** Contra el prompt de producción, mismo banco
# y mismo juez: fundamentación 7,0 -> 6,3; utilidad 9,0 -> 8,6; seguridad 8,6 -> 8,4; honestidad
# 8,4 -> 7,9; "un vet experimentado seguiría esto" **16/24 -> 8/23**; y las citas infieles ni se
# movieron (18/24 -> 19/23). El efecto contraintuitivo que lo explica: el modelo pasó a citar MÁS
# (mediana 6 -> 8 fuentes por respuesta). Insistirle sobre las citas le sube la ansiedad por citar
# y le diluye las instrucciones clínicas, que es de donde salía la calidad.
#
# Segundo intento fallido de arreglar por prompt algo que debe garantizarse por código (el primero
# fueron las dosis, ver `app/generation/dose_guard.py`). **La fidelidad de las citas necesita
# verificación por afirmación, no otra vuelta de redacción.** Se conserva acá como evidencia para
# que nadie la vuelva a intentar.
# ---------------------------------------------------------------------------------------------
_CITAS_BLOQUE = (
    "CÓMO CITAR (esto es lo que más se te audita):\n"
    "- Cita la CLÁUSULA, no el párrafo: el número va pegado a la afirmación concreta que esa "
    "fuente sostiene, no al final de un bloque que mezcla varias ideas.\n"
    "- Si pones varias fuentes juntas ([1][5]), CADA UNA debe sostener lo afirmado por sí sola. "
    "Si sólo una lo sostiene, cita sólo esa. Acumular números no fortalece una afirmación.\n"
    "- Un pasaje que es una TABLA de datos, un listado de laboratorio o una figura NO sostiene una "
    "afirmación narrativa (evolución, pronóstico, respuesta al tratamiento). No lo cites para eso.\n"
    "- Un pasaje que describe UN caso sostiene 'se ha descrito', nunca 'suele ocurrir' ni un "
    "porcentaje. No inventes cifras ni las atribuyas a una fuente que no las trae.\n"
    "- Si la fuente es de otra especie o de otro contexto y aun así te sirve, dilo en el texto "
    "('descrito en perros, extrapolable con cautela') en vez de citarla como si fuera del caso.\n"
    "- Antes de cerrar, repasá cada [n] que escribiste y preguntate: ¿el veterinario que abra esa "
    "fuente va a encontrar ahí lo que le dije? Si la respuesta es no, quitá el número.\n"
)

CITAS_ESTRICTAS = CHAT_SYSTEM.replace(
    "CÓMO RESPONDER (sin encabezados rígidos ni relleno; habla como a un colega):",
    _CITAS_BLOQUE + "\nCÓMO RESPONDER (sin encabezados rígidos ni relleno; habla como a un colega):",
)

VARIANTES = {
    "actual": CHAT_SYSTEM,          # el de producción, importado (nunca copiado)
    "citas_estrictas": CITAS_ESTRICTAS,
}

# Comprobación de que el injerto encontró su anclaje: si `CHAT_SYSTEM` se reescribe y el marcador
# desaparece, la variante sería idéntica a `actual` y el A/B mediría ruido en vez del cambio.
assert CITAS_ESTRICTAS != CHAT_SYSTEM, (
    "CITAS_ESTRICTAS quedó igual a CHAT_SYSTEM: cambió el texto de anclaje en app/chat.py")
