"""La nota clínica lleva clínica, o no lleva nada.

── EL REPORTE (27-ago, con captura) ────────────────────────────────────────────────────────────

El vet cierra una consulta sin material y la pantalla lo recibe con dos campos vacíos y dos llenos
de negaciones: «No hay suficiente información…», «No es posible proponer un plan…», con un
«[sin literatura suficiente]» entre corchetes repetido dos veces, y un recordatorio de advertir
alergias «aunque no se reportan conocidas en el paciente». El cliente lo llamó «poco profesional».

── POR QUÉ ERA UN DEFECTO Y NO UN GUSTO ────────────────────────────────────────────────────────

1. DUPLICABA la interfaz. `lib/evidencia.ts` ya muestra la banda del juez arriba de la nota, con su
   explicación redactada para un veterinario. El modelo la repetía, peor escrita, adentro.
2. ENSUCIABA LA HISTORIA CLÍNICA. Ese texto se guarda en `clinical_notes` si el vet aprueba.
3. Y el marcador salía del RELLENO DEL PROMPT: «(sin literatura suficiente)» era el texto que se
   ponía en la sección de literatura cuando no había ninguna, y el modelo lo copiaba como si fuera
   una cita.

Se arregló en las tres capas: el prompt dejó de pedirlo, el relleno dejó de parecer un dato, y
`_sin_disculpas` es la red — porque un prompt es una instrucción, no una garantía, y acá lo que se
cuela entra a una historia clínica.
"""
import app.generation.generate as g
from app.generation.generate import _sin_disculpas


def test_la_disculpa_completa_deja_el_campo_vacio():
    # Un campo vacío es una nota que el vet completa; una disculpa es texto que tiene que borrar.
    entrada = ("No hay suficiente información en la transcripción ni literatura recuperada para "
               "evaluar el caso clínico [sin literatura suficiente].")
    assert _sin_disculpas(entrada) == ""


def test_recorta_la_disculpa_y_conserva_el_resto():
    entrada = ("No es posible proponer un plan diagnóstico o terapéutico debido a la ausencia de "
               "información clínica y literatura de respaldo [sin literatura suficiente]. "
               "Reposo estricto en jaula 4-6 semanas.")
    assert _sin_disculpas(entrada) == "Reposo estricto en jaula 4-6 semanas."


def test_la_clinica_no_se_toca():
    # El caso que hace peligroso este recorte: «no es posible» PUEDE ser clínica legítima. Se
    # recortan frases sobre el SISTEMA, nunca sobre el paciente.
    entrada = "No es posible determinar la especie por la transcripción; se registra como canino."
    assert _sin_disculpas(entrada) == entrada

    nota = "Cuadro compatible con otitis por Malassezia [abc-123]. Se sugiere citología ótica."
    assert _sin_disculpas(nota) == nota


def test_el_marcador_no_sobrevive_aunque_venga_solo():
    assert "sin literatura" not in _sin_disculpas("Otitis bilateral [sin literatura suficiente]").lower()


def test_el_relleno_de_literatura_ya_no_parece_un_dato_citable():
    # Era "(sin literatura suficiente)" — un token con forma de contenido, en la sección de
    # literatura. El modelo lo copiaba tal cual. Ahora es una instrucción, y dice explícitamente
    # que no se mencione.
    relleno = g._format_literature([])
    assert "(sin literatura suficiente)" not in relleno
    assert "NO menciones" in relleno


def test_sin_alergias_conocidas_no_se_pide_advertirlas():
    # El plan de la captura terminaba advirtiendo sobre alergias «aunque no se reportan conocidas»:
    # el prompt pedía ADVERTIR siempre, hubiera o no qué advertir. El gate determinístico de alergia
    # severa (`allergy_gate.py`) no cambia — esto es sólo qué se le pide al redactor.
    from app.models import PatientContext

    paciente = PatientContext(patient_id="p-1", species="canino", weight_kg=12.4, age_years=4)
    _, sin = g.build_note_prompt("hola", [], paciente, [])
    assert "ADVERTIR antes de cualquier plan" not in sin
    assert "no hace falta mencionarlo" in sin

    _, con = g.build_note_prompt("hola", [], paciente, ["penicilina"])
    assert "ADVERTIR antes de cualquier plan" in con
    assert "penicilina" in con


def test_el_prompt_prohibe_explicitamente_hablar_de_las_limitaciones():
    assert "NUNCA expliques tus propias limitaciones" in g.CLINICAL_SYSTEM_PROMPT
    # Y ya no pide lo contrario, que es de donde salía el texto.
    assert "indícalo en el assessment" not in g.CLINICAL_SYSTEM_PROMPT
