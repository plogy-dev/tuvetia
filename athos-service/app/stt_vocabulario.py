"""Refuerzo de vocabulario para el reconocimiento de voz.

── POR QUÉ EXISTE ──────────────────────────────────────────────────────────────────────────────

David, 26-ago, probando el Modo Fantasma: *"la transcripción no está tan precisa, toca ver si esto
puede mejorar"*. Al revisar las tres llamadas a STT del servicio —lote con el primario (entonces
Grok/xAI, hoy Groq/Whisper), lote con Deepgram y el vivo— ninguna pasaba una sola palabra de
vocabulario. El motor entraba a una consulta
veterinaria colombiana con `language: "es"` a secas y nada más.

Eso explica el patrón que se ve en los transcripts reales: la gramática sale bien y los NOMBRES
PROPIOS salen mal. Un modelo general nunca oyó "maropitant" ni "gingivoestomatitis"; oye algo
parecido en español corriente y escribe eso. Y como la nota SOAP se redacta A PARTIR del
transcript, un fármaco mal escrito no es un detalle cosmético: se propaga a la historia clínica.

El repo ya tiene un glosario veterinario (`app/glossary/`), pero vive en la base y se usa para
*retrieval*. Meter una consulta a la base en la ruta caliente del STT sería pagar latencia en el
peor momento; esta lista es estática, chica y va en la URL de la petición.

── QUÉ ENTRA Y QUÉ NO ──────────────────────────────────────────────────────────────────────────

Sólo términos que el motor NO PUEDE saber y que cambian el sentido clínico: principios activos,
patógenos, vacunas, razas y unas pocas siglas. No entran palabras que el español general ya
resuelve ("vómito", "diarrea", "fiebre") — el refuerzo tiene coste: sube la probabilidad de que el
motor OIGA el término donde no lo hay, así que cada entrada tiene que ganarse el lugar.

Tampoco entran nombres de mascota ni de vet: cambian por clínica y son justo lo que un refuerzo
global haría aparecer donde no corresponde.
"""

from __future__ import annotations

# ── EL EMPUJE, BAJADO A 1 POR UN INCIDENTE REAL ─────────────────────────────────────────────────
#
# Arrancó en 1.5 «deliberadamente moderado». La primera prueba real (26-ago de noche) lo desmintió:
# el vet dijo «probando, probando» y el transcript arrancó con «Propofol.» — un ANESTÉSICO inventado
# en una historia clínica, casi seguro este mismo refuerzo empujando su término sobre un parónimo
# («pro-ban-do» / «pro-po-fol»). Es exactamente el riesgo que este archivo ya advertía, y es el peor
# de los dos errores posibles: un fármaco que falta se nota y se corrige; uno inventado se lee como
# dicho.
#
# En 1, el término sigue en el diccionario de la sesión —que es la mitad del beneficio: el motor
# SABE que «maropitant» puede aparecer— pero sin sobrepeso frente a lo que de verdad se oyó. Si la
# precisión en fármacos reales sigue corta, el camino es subir el MODELO (STT_MODEL=nova-3 en
# Railway, pendiente), no volver a subir esto.
EMPUJE = "1"

# El nombre del paciente sí lleva empuje de verdad (3): es la palabra MÁS probable de la consulta
# entera —se repite decenas de veces— y equivocarla no inventa clínica, solo escribe mal un nombre
# («probando a Shira» donde la perra se llama Achira, mismo incidente). El costo de un falso
# positivo acá es cero comparado con un fármaco.
EMPUJE_NOMBRE = "3"

# Principios activos y presentaciones que se dictan en voz alta en una consulta.
FARMACOS: tuple[str, ...] = (
    "meloxicam", "carprofeno", "firocoxib", "robenacoxib", "dipirona", "tramadol", "gabapentina",
    "buprenorfina", "metadona", "ketamina", "propofol", "dexmedetomidina",
    "maropitant", "ondansetrón", "metoclopramida", "omeprazol", "sucralfato",
    "famotidina", "furosemida", "benazepril", "pimobendán",
    "amoxicilina", "clavulánico", "cefalexina", "cefovecina", "enrofloxacina", "marbofloxacina",
    "metronidazol", "doxiciclina", "clindamicina", "trimetoprim",
    "itraconazol", "ketoconazol", "terbinafina", "ivermectina", "selamectina",
    "milbemicina", "fenbendazol", "praziquantel", "toltrazuril",
    "fluralaner", "afoxolaner", "sarolaner", "fipronil",
    "dexametasona", "prednisolona", "ciclosporina", "oclacitinib",
    "apoquel", "cytopoint", "levotiroxina",
)

# Patógenos y cuadros que se nombran por su nombre propio.
PATOLOGIAS: tuple[str, ...] = (
    "parvovirus", "moquillo", "leptospira", "leptospirosis", "ehrlichia",
    "ehrlichiosis", "anaplasma", "babesia", "hemoparásitos", "dirofilaria", "leishmania",
    "panleucopenia", "calicivirus", "herpesvirus", "giardia",
    "demodex", "demodicosis", "sarcóptica", "malassezia",
    "piodermia", "gingivoestomatitis", "piómetra",
    "patelar", "mastocitoma", "linfoma",
    "cushing", "addison", "urolitiasis", "estruvita", "megaesófago",
)

# Procedimientos y hallazgos que se dictan en el examen y NO son español corriente.
#
# Acá se recortó fuerte a propósito. Estaban "auscultación", "mucosas", "taquicardia", "hemograma",
# "ecografía", "refuerzo", "triple"… todas palabras que el modelo general ya escribe bien. Empujar
# una palabra común no la mejora: sube la probabilidad de OÍRLA donde no está, y "triple" o
# "refuerzo" empujados aparecen en cualquier frase. El refuerzo sólo paga en lo que el modelo no
# pudo haber visto nunca.
CLINICOS: tuple[str, ...] = (
    "turgencia", "estertores", "sibilancias", "epífora", "blefaroespasmo", "nistagmo",
    "propiocepción", "azotémico", "ovariohisterectomía", "orquiectomía", "gastropexia",
    "enterotomía", "cistotomía", "desparasitación", "polivalente", "quíntuple", "séxtuple",
    "bordetella", "antirrábica",
)

# El orden es el de prioridad clínica —fármacos primero— porque es el orden en que sobreviven al
# tope de abajo si algún día la lista vuelve a crecer.
TERMINOS: tuple[str, ...] = FARMACOS + PATOLOGIAS + CLINICOS

# Deepgram admite 100 términos por petición. Pasarse no degrada: responde 400 y la consulta se
# queda SIN TRANSCRIBIR, que es un precio absurdo por una lista de vocabulario. El tope está acá y
# no en la revisión de nadie, porque agregar un fármaco a la lista de arriba es exactamente la
# clase de cambio que se hace sin pensar en un límite de la API.
TOPE = 100


# ── APAGADO POR DEFECTO DESDE EL 27-AGO ─────────────────────────────────────────────────────────
#
# El refuerzo se encendió el 26-ago y la PRIMERA prueba real lo desmintió: «probando, probando»
# salió como «Propofol.» — un anestésico inventado en una historia clínica. Se bajó el empuje de
# 1.5 a 1, pero eso sigue siendo una hipótesis SIN MEDIR, y el cliente está evaluando el Modo
# Fantasma —que llamó «el core»— justo hoy.
#
# Una hipótesis mía no puede ser una variable de su prueba. Apagado, el motor entra exactamente
# como entraba cuando funcionaba bien, y lo que ellos encuentren es comportamiento real del
# producto y no un experimento mío.
#
# CÓMO SE VUELVE A ENCENDER: `STT_VOCABULARIO=on` en Railway. El módulo, sus tests y el refuerzo
# por nombre quedan intactos — lo que falta no es código sino una MEDICIÓN contra audio real de
# consulta, comparando el mismo audio con y sin refuerzo. Ese es el trabajo pendiente, y hasta que
# exista el default es «apagado».
def vocabulario_encendido() -> bool:
    import os
    return os.environ.get("STT_VOCABULARIO", "").strip().lower() in ("1", "on", "true", "si")


def parametros_de_vocabulario(model: str, nombre_paciente: str | None = None) -> list[tuple[str, str]]:
    """Los pares (clave, valor) que le pasan el vocabulario al modelo de Deepgram.

    Deepgram cambió de parámetro entre generaciones y no son intercambiables: `nova-3` usa
    `keyterm` (acepta frases y no lleva empuje) y `nova-2` y anteriores usan `keywords:empuje`
    (una sola palabra por entrada). Mandar el equivocado no da error — se ignora en silencio, que
    es la peor forma de fallar para algo cuyo efecto sólo se nota leyendo transcripts.

    Se elige por el modelo configurado, así que subir `STT_MODEL` a `nova-3` en Railway migra
    también el vocabulario sin tocar código.

    `nombre_paciente` es la personalización por consulta —la primera prueba real la pidió a
    gritos: «Achira» salió como «Shira»—. Un refuerzo GLOBAL de nombres es imposible (cambian por
    clínica y meterían falsos positivos en todas), pero el de ESTA consulta es la palabra más
    probable del audio. Va PRIMERO, porque si la lista global llegara al tope, lo que se recorta
    es la cola global y nunca el nombre.
    """
    if not vocabulario_encendido():
        return []

    propios: list[str] = []
    if nombre_paciente:
        # Un nombre compuesto («Rocky Balboa») entra palabra por palabra en nova-2, que no acepta
        # espacios en `keywords`. Se filtran sufijos cortos («de», «la») que no aportan.
        propios = [p for p in nombre_paciente.strip().split() if len(p) >= 3]

    terminos = (tuple(propios) + TERMINOS)[:TOPE]
    if model.strip().lower().startswith("nova-3"):
        # nova-3 sí acepta frases: el nombre viaja entero, y el resto igual.
        frases = ([nombre_paciente.strip()] if nombre_paciente else []) + list(TERMINOS)
        return [("keyterm", t) for t in frases[:TOPE]]
    return [
        ("keywords", f"{t}:{EMPUJE_NOMBRE if t in propios else EMPUJE}")
        for t in terminos
        if " " not in t
    ]
