"""Notas y sugerencias MIENTRAS la consulta pasa, no al cerrarla.

LO QUE PIDIÓ EL CLIENTE, el 17-ago:

    Luciano: "la inteligencia de datos no tiene que estar solamente al finalizar la consulta, sino
              durante la consulta… yo como médico darle toda la consulta al man, que me dé notas,
              me dé sugerencias de qué decir, me busque la literatura en tiempo real"

Dos modos, con dos costos muy distintos:

  · **notas** — qué se dijo, ordenado. Modelo LIVIANO, sin literatura, sin retrieval. Es dictado
    estructurado: barato y frecuente.
  · **sugerencias** — qué mirar y qué preguntar. Es lo caro, y por eso su cadencia es la mitad de
    frecuente y su techo por consulta, un tercio.

CUÁNDO SE LLAMA NO SE DECIDE ACÁ. Lo decide el navegador con `lib/consulta-viva/disparador.ts`, por
CONTENIDO NUEVO y no por reloj — y ahí está la aritmética de por qué: a intervalo fijo, una consulta
de 15 minutos gastaría 80 llamadas contra un tope de 1000 al mes por clínica.

── LAS TRES COSAS QUE ESTO **NO** HACE, Y SON LAS QUE IMPORTAN ─────────────────────────────────────

1. **NO ES UNA NOTA CLÍNICA.** Nada de lo que sale de acá entra a la historia. La nota sigue siendo
   la del cierre (`/athos/phantom/suggest`), con su `clinical_notes` en draft y su aprobación
   humana — regla 5. Esto es un cuaderno que se mira mientras se atiende y se descarta.

   Por eso tampoco escribe en `clinical_notes` ni en `transcripts`: no hay nada que aprobar.

2. **NO DIAGNOSTICA.** Sobre una consulta a medias, cualquier conclusión es prematura por
   construcción: falta la exploración, faltan los signos que todavía no se dijeron. El prompt pide
   HIPÓTESIS A DESCARTAR y PREGUNTAS QUE FALTAN, que es lo que un colega mirando por encima del
   hombro aportaría de verdad.

3. **NO SE SALTA EL GUARD DE DOSIS.** Es la regla 4 y es determinística: si falta especie, peso o
   edad, ninguna cifra por peso sale — tampoco acá. Medido en su momento: pedirle al modelo que sea
   resolutivo lo empuja a dosificar (2/23 -> 9/23), y en vivo la presión es mayor todavía porque el
   vet está por decidir. El guard corre sobre el texto, no en el prompt.

   El gate de alergia severa también viaja, por el mismo motivo: si el paciente tiene una alergia
   bloqueante, el momento de decirlo es ANTES de que el vet elija el fármaco, no al cerrar.
"""
import logging

from app.config import get_settings
from app.generation.dose_guard import (
    DOSE_NOTICE, patient_data_complete, redact_doses)
from app.generation.llm_client import LLMClient
from app.models import PatientContext

log = logging.getLogger(__name__)

#: Cuánto transcript se manda. Una consulta de 90 minutos no cabe, y el final es lo que importa:
#: las notas anteriores ya cubrieron el principio.
MAX_TRANSCRIPT_CHARS = 6000

#: Techo de salida. Esto se lee de reojo mientras se atiende — si no cabe de un vistazo, no sirve.
MAX_TOKENS = 400

NOTAS_SYSTEM = """Eres el cuaderno de un veterinario que está atendiendo AHORA MISMO. Recibes la
transcripción PARCIAL de la consulta en curso y devuelves notas de lo que se dijo.

Reglas:
1. SOLO lo que aparece en la transcripción. No completes, no infieras, no supongas.
2. Si algo se entendió a medias, no lo escribas. Una nota inventada en una consulta es peor que una
   nota que falta.
3. Máximo 6 viñetas, cada una de una línea. Español.
4. Agrupa por lo que sirve después: motivo, hallazgos, lo que dijo el titular, lo que se acordó.
5. Nada de diagnósticos ni conclusiones: esto es lo que SE DIJO, no lo que significa.
6. Si todavía no hay material suficiente, responde exactamente: SIN MATERIAL

Responde solo las viñetas, sin encabezados ni preámbulo."""

SUGERENCIAS_SYSTEM = """Eres un veterinario con décadas de experiencia mirando por encima del hombro
de un colega que está atendiendo AHORA MISMO. Recibes la transcripción PARCIAL de la consulta.

Tu valor es lo que un colega experimentado aportaría en voz baja, sin interrumpir:
- QUÉ FALTA PREGUNTAR: lo que todavía no se indagó y cambiaría la conducta.
- QUÉ NO DEJAR PASAR: lo grave o urgente que este cuadro admite, aunque sea poco probable.
- QUÉ MIRAR en la exploración, concretamente.

Reglas estrictas:
1. La consulta está A MEDIAS. NO diagnostiques ni cierres nada: faltan datos por definición.
   Lenguaje de posibilidad ("compatible con", "valdría descartar").
2. NO escribas cifras de dosis. Si corresponde un fármaco, nómbralo sin dosificar.
3. Máximo 4 viñetas, una línea cada una. Español. Directo, sin explicar lo obvio: tu interlocutor
   es veterinario y tiene al animal delante.
4. Si la consulta todavía no da para nada útil, responde exactamente: SIN MATERIAL

Responde solo las viñetas, sin encabezados ni preámbulo."""

#: Lo que el modelo responde cuando no hay con qué. Se compara tal cual, así que va acá.
SIN_MATERIAL = "SIN MATERIAL"


def _ficha(patient: PatientContext | None) -> str:
    """La ficha en una línea. Sin paciente devuelve vacío: no se inventa contexto."""
    if not patient or not patient.patient_id:
        return ""
    partes = [
        f"especie: {patient.species}" if patient.species else None,
        f"peso: {patient.weight_kg} kg" if patient.weight_kg is not None else None,
        f"edad: {patient.age_years} años" if patient.age_years is not None else None,
    ]
    ficha = "; ".join(p for p in partes if p)
    return f"PACIENTE: {ficha}\n" if ficha else ""


def _alergias(patient: PatientContext | None) -> str:
    """El gate de alergia severa, en vivo.

    Va en el prompt Y se emite como aviso aparte (ver `analizar`): el momento de saber que este
    paciente no puede recibir penicilina es ANTES de que el vet la elija, no al cerrar la nota.
    """
    if not patient or not patient.severe_allergies:
        return ""
    return ("ALERGIAS SEVERAS DE ESTE PACIENTE (bloqueantes, tenelas en cuenta antes de sugerir "
            f"cualquier fármaco): {', '.join(patient.severe_allergies)}\n")


def build_live_prompt(transcript: str, patient: PatientContext | None, motivo: str | None) -> str:
    """El prompt de usuario. PURO, para poder probarlo sin red ni base.

    Se manda la COLA del transcript, no el principio: en una consulta larga lo último es lo que el
    vet está resolviendo, y las notas anteriores ya cubrieron lo de antes.
    """
    texto = (transcript or "").strip()
    if len(texto) > MAX_TRANSCRIPT_CHARS:
        texto = "…" + texto[-MAX_TRANSCRIPT_CHARS:]
    encabezado = _ficha(patient) + _alergias(patient)
    if motivo and motivo.strip():
        encabezado += f"MOTIVO DECLARADO AL INICIAR: {motivo.strip()}\n"
    return f"{encabezado}\nTRANSCRIPCIÓN PARCIAL DE LA CONSULTA EN CURSO:\n{texto}"


def analizar(
    transcript: str,
    modo: str,
    patient: PatientContext | None = None,
    motivo: str | None = None,
) -> dict:
    """Devuelve `{ texto, sin_material, dosis_redactadas, alergias_severas }`.

    NUNCA LANZA. Esto corre cada pocas decenas de segundos mientras alguien atiende: un error de
    proveedor no puede romper la consulta ni tumbar el panel. Ante un fallo devuelve `sin_material`,
    que la interfaz ya sabe pintar como "todavía no hay nada".
    """
    system = SUGERENCIAS_SYSTEM if modo == "sugerencias" else NOTAS_SYSTEM
    s = get_settings()

    try:
        crudo = LLMClient(model=s.llm_light_model).complete(
            system=system,
            user=build_live_prompt(transcript, patient, motivo),
            max_tokens=MAX_TOKENS,
        )
    except Exception as e:  # noqa: BLE001 — el vivo nunca rompe la consulta
        log.warning("vivo: falló la generación (%s): %s", modo, e)
        return {"texto": "", "sin_material": True, "dosis_redactadas": False,
                "alergias_severas": list(patient.severe_allergies) if patient else [],
                "modelo": s.llm_light_model, "gasto": False}

    texto = (crudo or "").strip()
    if not texto or texto.upper().startswith(SIN_MATERIAL):
        # `gasto=True` aunque no haya texto: la llamada al modelo YA ocurrió y ya se pagó. Contar
        # sólo lo que devuelve algo dejaría fuera del presupuesto justo el caso que más se repite.
        return {"texto": "", "sin_material": True, "dosis_redactadas": False,
                "alergias_severas": list(patient.severe_allergies) if patient else [],
                "modelo": s.llm_light_model, "gasto": True}

    # REGLA 4, SOBRE EL TEXTO Y NO EN EL PROMPT. El prompt ya lo pide; medido, el prompt no alcanza.
    redactado = False
    if not patient_data_complete(
        patient.species if patient else None,
        patient.weight_kg if patient else None,
        patient.age_years if patient else None,
    ):
        texto, redactado = redact_doses(texto)
        if redactado:
            texto = f"{texto}\n\n{DOSE_NOTICE}"

    return {
        "texto": texto,
        "sin_material": False,
        "dosis_redactadas": redactado,
        "alergias_severas": list(patient.severe_allergies) if patient else [],
        #: Qué modelo respondió y si hubo llamada. Next lo necesita para dejar la fila de consumo:
        #: el presupuesto por clínica vive allá, y una fila que no dice el modelo no sirve para
        #: costear después.
        "modelo": s.llm_light_model,
        "gasto": True,
    }
