"""Configuración del servicio. TODO viene de variables de entorno (nada hardcodeado)."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase / DB
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""          # HS256 legacy (fallback)
    supabase_jwks_url: str = ""            # si vacío se deriva de supabase_url
    database_url: str = ""                  # DB de PACIENTE + trazas (por clínica) — el principal
    corpus_database_url: str = ""          # DB del CORPUS/glosario (global); si vacío usa database_url

    # Motores de IA (parametrizables). LA ENV VAR SIGUE MANDANDO: esto es lo que queda cuando no hay
    # ninguna, y por eso importa cuál es.
    #
    # ── POR QUÉ EL DEFAULT ES DEEPSEEK Y NO CLAUDE (cambiado el 2026-08-22) ────────────────────
    #
    # Era `claude-sonnet-5@anthropic`, y `provider_cascade.py` dice —con todas las letras— que
    # Anthropic no debe usarse mientras su cuenta no tenga crédito. O sea que "sin variables de
    # entorno" era exactamente la configuración que se sabe rota: el servicio arranca, pasa el
    # healthcheck de Railway y muere en la primera generación, con el tablero en verde.
    #
    # Ahora el default es el primario VALIDADO contra el golden set, que es además lo que corre en
    # producción (verificado el 2026-08-22 contra `clinical_notes.ai_model`). El caso que arregla de
    # verdad: quien configure `LLM_API_KEY` y se olvide del resto ahora funciona en vez de fallar.
    #
    # LOS TRES VAN JUNTOS. Un default a medias es peor que el anterior: con `openai` y `llm_base_url`
    # vacío, la URL queda en "/chat/completions" —relativa, inválida— y el fallo pasa de "sin
    # crédito" a "no se entiende". Proveedor, URL y modelo se mueven de a tres o no se mueven.
    #
    # ANTHROPIC NO SE VA: sigue soportado como proveedor y como alternativa de la cascada, con su
    # `anthropic_api_key` propia. Lo que cambia es cuál se asume cuando no se dijo nada.
    llm_provider: str = "openai"           # "anthropic" | "openai" (compatible: DeepSeek, Moonshot/Kimi)
    llm_base_url: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-v4-flash"
    llm_light_model: str = "deepseek-v4-flash"
    llm_api_key: str = ""

    # Key propia de Anthropic. Si esta vacia cae a `llm_api_key`, que es como funcionaba cuando
    # anthropic era el proveedor primario. Hace falta separarla para que la CASCADA pueda usar
    # Claude como alternativa mientras el primario sigue siendo DeepSeek: si no, la rama de
    # Anthropic intentaria autenticarse con la key de DeepSeek y fallaria siempre.
    anthropic_api_key: str = ""

    # --- Gemini (Google). Key y base URL propias para que convivan con el proveedor primario sin
    # pisarle las variables: hoy el primario es DeepSeek y Gemini entra como alternativa. ---
    # ⚠️ El MODELO de Gemini NO se configura aquí: sale del string de la cascada
    # (`LLM_CASCADE_*="gemini-3.6-flash@google"`). Existieron `GEMINI_MODEL`/`GEMINI_LIGHT_MODEL`
    # como settings que NADIE leía — cambiarlas en Railway no cambiaba nada, y el doc de entrega
    # las citaba como evidencia (mismo defecto que EVOLUTION_API_URL, auditoría 2026-07-30). Se
    # eliminaron para que la única perilla sea la que funciona.
    gemini_api_key: str = ""
    gemini_base_url: str = ""              # vacío -> el endpoint OpenAI-compatible por defecto

    # --- CASCADA ENTRE PROVEEDORES (cláusula 1.4) y ROUTING (1.5) ---
    # ⚠️ NO confundir con `app/retrieval/cascade.py`, que es la cascada de RECUPERACIÓN de documentos
    # y no tiene nada que ver: son cosas distintas con nombre parecido, y la auditoría lo señala.
    #
    # Formato: "modelo@proveedor,modelo@proveedor,..." en orden de preferencia. El primero es el que
    # atiende; los siguientes SÓLO se usan si el anterior falla. Vacío = comportamiento de siempre
    # (un único proveedor, sin alternativas), así que apagar esto devuelve el sistema exactamente a
    # como estaba. Ejemplo: "deepseek-v4-flash@openai,gemini-3.6-flash@google".
    llm_cascade_redaccion: str = ""        # chat y nota del Fantasma
    llm_cascade_liviano: str = ""          # A->B, juez de evidencia, auditores
    # ROUTING POR CONSULTA (1.5), no sólo por tarea: cadena que se usa cuando el juez de evidencia
    # dictamina cobertura **limitada**. Vacío = se usa `llm_cascade_redaccion` para todo, o sea el
    # comportamiento anterior.
    #
    # Por qué la banda `limited` y no otra señal: es el caso donde la literatura cubre el cuadro sólo
    # a medias, que es exactamente donde el modelo tiende a rellenar el hueco con su propio
    # conocimiento — el fallo que más caro sale en una nota clínica. Y es una señal que el pipeline YA
    # calcula, así que no cuesta una llamada extra.
    #
    # A quién mandar ahí lo dice la comparativa medida (`docs/COMPARATIVA-MODELOS-2026-07-30.md`):
    # Claude es mejor en **fidelidad y seguridad** con los dos jueces sesgados en direcciones
    # opuestas, y DeepSeek empata o gana en utilidad. Traducido: el caso fácil se queda en el barato,
    # el caso donde la fidelidad manda escala al que mide mejor en fidelidad.
    #
    # ⚠️ Sólo aplica al **Fantasma**. En el chat el juez corre EN PARALELO con la redacción para no
    # pagar su latencia en el primer token; esperar la banda para elegir modelo costaría esos ~1,8s
    # justo donde el veterinario está mirando la pantalla. En el Fantasma nadie espera.
    llm_cascade_dificil: str = ""
    # Tope de intentos por si alguien configura una lista larga: acota la latencia del peor caso.
    llm_cascade_max_intentos: int = 3

    embedding_provider: str = "cohere"
    embedding_model: str = "embed-v4.0"
    embedding_dim: int = 1024
    embedding_api_key: str = ""
    # Reranking (sección 11.3): reordena los candidatos fusionados por relevancia real a la
    # consulta antes de la generación. Vacío o `rerank_enabled=False` -> se salta (degradación).
    rerank_enabled: bool = True
    rerank_model: str = "rerank-v3.5"
    rerank_api_key: str = ""               # si vacío reusa embedding_api_key (misma cuenta Cohere)

    # Abstención (juez semántico de evidencia). Es la ÚNICA señal que separa cobertura real de
    # plausibilidad temática: ni el score determinístico, ni el del reranker, ni el nº de citas lo
    # hacen (medido sobre 187 casos). Ver app/generation/evidence_judge.py.
    judge_enabled: bool = True
    # Si vacío cae a llm_light_model (el mismo del A->B). ⚠️ NO apuntarlo al modelo grande sin volver
    # a medir: se probó el 2026-07-29 y se REVIRTIÓ. La primera corrida bajaba los negativos que
    # responden con confianza de 9/10 a 5/10, pero la segunda no lo reprodujo (8/10) y la
    # sobre-abstención se triplicó (2/24 -> 5/24) — con el agravante de que en 3 de esos 5 casos el
    # descriptor objetivo SÍ estaba en la literatura ofrecida: el juez grande puntuó 0 sobre
    # literatura correcta. Una abstención indebida daña tanto como la falta de abstención.
    # El arreglo real es rehacer el banco de negativos con validación clínica y recién entonces
    # calibrar los cortes. Detalle: `scripts/calidad/README.md` §JUDGE_MODEL probado y revertido.
    judge_model: str = ""
    # Cortes de las bandas. CALIBRADOS el 2026-07-30 sobre el banco COMPLETO (188 casos) contra una
    # verdad-de-terreno MECÁNICA, no contra las etiquetas del banco: ver
    # `scripts/calidad/abstencion_verdad.py` y `docs/ABSTENCION-MEDICION-2026-07-30.md`.
    #
    # Por qué cambió el instrumento: el banco etiqueta si el CORPUS contiene el descriptor, y el juez
    # decide otra cosa — si los pasajes RECUPERADOS cubren la consulta. Medir lo segundo con lo
    # primero castigaba al juez por acertar (las etiquetas sólo coinciden con la verdad en ~74%).
    #
    # Los cortes NO se eligen solos: van con la corroboración determinística de `evidence_judge.py`.
    #
    #   configuración                        seguridad   utilidad
    #   4/7, sin señal          (antes)        82,4%       63,3%
    #   2/6 + corroboración     (ahora)        92,6%       65,5%   <- mejor en las DOS
    #
    # `seguridad` = no cometió un fallo grave (ni responder con confianza sin literatura, ni callarse
    # teniéndola). `utilidad` = de los casos CON literatura, cuántos se responden sin la advertencia
    # de evidencia limitada. Se reportan las dos a propósito: una regla que respondiera siempre
    # "evidencia limitada" sacaría una seguridad altísima y sería inútil.
    #
    # La regla se eligió usando SÓLO la mitad del banco; en la mitad no vista da 94,5%.
    judge_abstain_max: int = 2             # puntaje <= -> abstención dura
    judge_limited_max: int = 6             # puntaje <= -> se responde declarando evidencia limitada
    judge_passages: int = 6                # mejores chunks que lee el juez
    judge_chat_timeout_s: float = 4.0      # tope de espera EN EL CHAT; si vence, se responde igual

    # Fidelidad de las citas: ¿el pasaje citado sostiene lo afirmado? Medido, 18 de 24 respuestas
    # citaban al menos un pasaje que no. Corre DESPUÉS de la respuesta (no suma latencia al primer
    # token) y sólo filtra las referencias del payload. Ver app/generation/citation_fidelity.py.
    #
    # ENCENDIDO tras calibrar (2026-07-29). La primera versión descartaba el **58%** de las
    # referencias — castigaba la reformulación legítima igual que la extrapolación — y quedó apagada.
    # Recalibrado el umbral ("en caso de duda, la cita sostiene" + 6 casos que no debe marcar):
    # descarta el **18%** (16 de 90), **ninguna** respuesta queda sin referencias, y las respuestas
    # que el juez de calidad puntúa 8 de fundamentación quedan intactas. Se revisaron a mano 6
    # descartes: 4 claramente correctos, 1 defendible, 1 falso positivo (ya corregido en el prompt).
    # Detalle y tabla de la revisión: `scripts/calidad/README.md` §Calibración del auditor.
    # Rollback sin redespliegue: `FIDELITY_ENABLED=false` en Railway.
    fidelity_enabled: bool = True

    # Fidelidad de la NOTA contra el TRANSCRIPT (`transcript_fidelity.py`). Distinto del de arriba:
    # ese audita el assessment contra la literatura, éste audita S y O contra lo que se dijo en la
    # consulta. Medido el 2026-07-29 sobre 40 transcripciones: **17 de 40 notas afirman al menos un
    # hecho que la consulta no contiene** (palpaciones que nadie hizo, reflejos que nadie evaluó,
    # síntomas atribuidos a la boca equivocada). No corrige la nota: la señala, para que el
    # veterinario lo arregle antes de firmar. Rollback: `TRANSCRIPT_FIDELITY_ENABLED=false`.
    transcript_fidelity_enabled: bool = True
    # Modelo del auditor de la nota. Se separa del liviano porque comparar un hallazgo contra el
    # transcript palabra por palabra es razonamiento fino, no redacción, y el Fantasma es asíncrono:
    # acá un modelo más caro no le cuesta espera a nadie (2,3s vs 1,2s, y nadie está esperando).
    # Medido sobre 39 notas con verdad-de-terreno (`scripts/calidad/auditor_calibrar.py`):
    #                      recall  precisión
    #   flash, sin pista     0,20     0,50
    #   flash, con pista     0,33     0,62
    #   pro,   sin pista     0,40     0,46
    #   pro,   con pista     0,47     0,78   <-- adoptado
    # La precisión es la que más importa: un señalamiento falso le hace perder confianza al veterinario
    # en los señalamientos, y entonces deja de leerlos. Vacío = cae a `llm_light_model`.
    note_fidelity_model: str = "deepseek-v4-pro"

    # STT — Modo Fantasma (ADR-0016: Deepgram Nova, batch + diarización)
    deepgram_api_key: str = ""
    stt_model: str = "nova-2"
    # Proveedor del BATCH de transcripción (decisión del cliente 2026-08-26: migrar a Grok/xAI,
    # que lanzó STT en abril-2026 a mitad de precio). `grok` transcribe con xAI y cae SOLO a
    # Deepgram si falla (una consulta no se puede perder por un proveedor caído). El streaming EN
    # VIVO sigue en Deepgram por ahora: Grok live exige Opus crudo/PCM y el front graba WebM —
    # cambiarlo es la fase 2 (demux o captura PCM), no una variable.
    stt_provider: str = "deepgram"
    xai_api_key: str = ""

    # App
    cors_origins: str = "http://localhost:3000"
    app_env: str = "dev"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def rerank_key(self) -> str:
        """Key del reranker. Por defecto la misma cuenta de Cohere que los embeddings."""
        return self.rerank_api_key or self.embedding_api_key

    @property
    def judge_model_name(self) -> str:
        """Modelo del juez. Por defecto el liviano (medido: mediana 1,8s, p90 2,3s)."""
        return self.judge_model or self.llm_light_model

    @property
    def corpus_db_url(self) -> str:
        """DB del corpus/glosario. Si no se define aparte, usa la misma que la de paciente (dev)."""
        return self.corpus_database_url or self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
