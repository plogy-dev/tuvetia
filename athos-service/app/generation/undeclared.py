"""Detecta lo que el chat afirma como EJECUTABLE sin citar y sin declarar que es criterio clínico.

La regla 2 de `CHAT_SYSTEM` exige que lo que no venga de la literatura lleve el prefijo
"Criterio clínico (no está en la literatura recuperada):". Es una regla dura confiada al prompt, y en
este proyecto eso ya falló de forma medida — con la regla de dosis escrita en el prompt las cifras
pasaron de 2/23 a 9/23 (`dose_guard.py`). Así que se verifica en el código.

El hueco que cierra: `citation_fidelity` audita las frases CON cita (¿el pasaje sostiene lo afirmado?)
y **por diseño ignora las que no la tienen** — "no fingen respaldo, así que no hay nada que auditar".
Eso vale para una frase que declara ser criterio clínico. Pero un fármaco o una cifra afirmados sin
cita y sin declarar caen en el medio: no fingen respaldo, simplemente no dicen nada, y el veterinario
no puede distinguir "esto lo dice la literatura" de "esto lo cree el modelo".

QUÉ SE MARCA Y QUÉ NO, que es donde está el diseño. La primera versión marcaba toda oración clínica
sin cita y daba **57 %** — un número que no significaba nada: al revisar la muestra a mano, la mayoría
eran reformulaciones del caso que el propio veterinario acababa de contar, razonamiento clínico
(priorizar diferenciales ES el trabajo) y andamiaje. Exigir la marca en cada frase de razonamiento
haría la respuesta ilegible y no es lo que pide la regla. Se marca sólo lo **EJECUTABLE** — un fármaco
o una cifra clínica —, que es lo que el veterinario puede administrar y lo que puede estar
flatamente mal. Con ese criterio: **30 casos en 34 respuestas medidas, 15 de 34 respuestas con al
menos uno** (`scripts/calidad/chat_declaracion.py`).

NO censura. Que Athos diga "doxiciclina es el tratamiento de elección para ehrlichiosis" es correcto y
útil, y suprimirlo lo haría peor — la lección de `prompts_variantes.CITAS_ESTRICTAS`, que al apretar
las citas empeoró todo. Lo que hace falta es que se vea de dónde viene. Igual que
`unverified_sources`: el texto del chat ya se emitió por streaming, así que esto viaja como metadato
en el evento `done` y el front lo marca.
"""
import re

# Marcadores de cita ya numerados por el pipeline.
_CITA_RE = re.compile(r"\[\d{1,2}(?:\s*,\s*\d{1,2})*\]")
_SPLIT_RE = re.compile(r"(?<=[.!?;])\s+|\n+")

# La declaración que pide la regla 2, en cualquier variante razonable: importa que el veterinario vea
# que no viene de la literatura, no la puntuación exacta.
_MARCA_RE = re.compile(
    r"criterio\s+cl[ií]nico|no\s+est[áa]\s+en\s+la\s+literatura|"
    r"sin\s+respaldo\s+en\s+la\s+literatura|no\s+aparece\s+en\s+la\s+literatura",
    re.IGNORECASE)

# Principios activos por terminación. En español son muy regulares, y una lista cerrada envejece:
# la terminación cubre fármacos que todavía no existen. Se agregan aparte los que no siguen patrón.
_FARMACO_RE = re.compile(
    r"\b\w{4,}(?:azol|azoles|micina|micinas|ciclina|ciclinas|cilina|cilinas|profeno|oxacino|"
    r"oxacina|pramida|prazol|tidina|dipropionato|sulfona|sulfamid|quantel|antel)\w*\b"
    r"|\b(?:ivermectina|prednisolona|prednisona|dexametasona|meloxicam|carprofeno|tramadol|"
    r"gabapentina|furosemida|pimobendan|benazepril|enalapril|maropitant|ondansetron|imidocarb|"
    r"fluralaner|afoxolaner|sarolaner|espironolactona|ciclosporina|azatioprina|micofenol\w*)\b",
    re.IGNORECASE)

# Cifras que un veterinario podría EJECUTAR: dosis, frecuencia, duración, porcentaje, valor de
# laboratorio. Deliberadamente NO incluye las que sólo reformulan el caso ("hace 2 días", "3 años").
_CIFRA_RE = re.compile(
    r"\d+(?:[.,]\d+)?\s*(?:%|mg|mcg|µg|ug|ml|ui\b|meq)"
    r"|\b(?:cada)\s+\d+\s*(?:h\b|horas|d[ií]as)"
    r"|\b(?:durante|por)\s+\d+\s*(?:d[ií]as|semanas|meses)"
    r"|\b\d+\s*(?:veces|vez)\s+(?:al|por)\s+(?:d[ií]a|hora|semana)",
    re.IGNORECASE)

MIN_CHARS = 30      # por debajo no hay una afirmación auditable
MAX_MARCAS = 12     # tope de lo que se reporta al front (no inundar la interfaz)


def find_undeclared(answer: str) -> list[dict[str, str]]:
    """Oraciones que afirman un fármaco o una cifra sin cita y sin declararse criterio clínico.

    Determinístico y testeable sin LLM. Devuelve [{"tipo": "fármaco"|"cifra", "texto": "..."}].
    No modifica el texto: sólo informa.
    """
    encontrados: list[dict[str, str]] = []
    # La marca puede encabezar un bloque y aplicar a lo que sigue ("Criterio clínico (...): a, b y c"),
    # así que se arrastra dentro del párrafo.
    for parrafo in re.split(r"\n\s*\n", answer or ""):
        if _MARCA_RE.search(parrafo):
            continue
        for frase in _SPLIT_RE.split(parrafo):
            limpia = frase.strip()
            if len(limpia) < MIN_CHARS or _CITA_RE.search(limpia):
                continue
            if _FARMACO_RE.search(limpia):
                tipo = "fármaco"
            elif _CIFRA_RE.search(limpia):
                tipo = "cifra"
            else:
                continue
            encontrados.append({"tipo": tipo, "texto": limpia[:300]})
            if len(encontrados) >= MAX_MARCAS:
                return encontrados
    return encontrados
