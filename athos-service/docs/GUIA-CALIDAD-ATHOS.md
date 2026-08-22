# Guía de comportamiento y calidad de Athos

Qué es una respuesta **de clase mundial** de Athos, y cómo se comprueba que lo es. Este documento
es a la vez el **estándar** (qué debe hacer cada respuesta) y el **rubric de prueba** (cómo se mide,
con qué herramienta, y cuál es el objetivo). No reemplaza a `CLAUDE.md` (las reglas de arquitectura)
ni al banco `scripts/calidad/` (las herramientas); las une en un solo criterio de aceptación.

---

## 0. El mandato

Hablar con Athos tiene que dar **la confianza de un clínico con 50 a 100 años de experiencia**: el
veterinario tiene que poder **seguir la recomendación tal cual**, sin corregirla. Se mide en pruebas
**externas** de calidad y utilidad. Una respuesta que se apoya en la literatura correcta pero es un
resumen genérico que el vet ya sabía **no cumple**.

---

## 1. Cómo se decide si una respuesta es buena (principios de método, no negociables)

Estos principios se pagaron caros en este proyecto. Violarlos produce mejoras falsas.

1. **Contá lo verificable; no le preguntes al juez lo que podés medir.** El juez LLM que puntúa en
   abstracto tiene **±7 sobre 40 de ruido** entre corridas idénticas, y el juez pareado por
   comparación prefiere la opción que ve **segunda en el 78 %** de los casos. Nada por debajo de ~20
   puntos porcentuales es detectable con el juez. Si una propiedad se puede expresar como un hecho
   contable del texto (¿el término aparece en la consulta?, ¿la cita mapea a un chunk?, ¿la cifra
   está en el pasaje?), **se cuenta**.
2. **Las reglas duras viven en el CÓDIGO, no en el prompt.** Medido: pedir por prompt "no dosifiques
   sin peso" falla en 2/23, y con un prompt más resolutivo empeora a 9/23. Las garantías críticas
   (gate de alergia, tapado de dosis, procedencia de citas, banda de evidencia) son determinísticas.
3. **Para lo subjetivo, A/B PAREADO contra el baseline, reproducido en 2+ corridas.** Una corrida no
   pareada de 24 casos no distingue una mejora de la variabilidad (dos corridas del MISMO prompt
   dieron confianza 67 % y 32 %). Un 15-0 pareado sí significa algo.
4. **Medí contra PRODUCCIÓN** (`CORPUS_DATABASE_URL` = principal), no contra dev — el corpus y el
   glosario son otro tamaño y las cifras no comparan.
5. **Antes de optimizar un número, revisá a mano qué cuenta.** Dos veces una métrica "grande" era una
   mezcla (proponer una radiografía contaba como "invento"). Optimizar contra una métrica sucia da
   empates falsos.
6. **Nunca juzgues con el mismo modelo que redacta**, ni con un competidor de la comparativa (el
   titular se movió 19 casos según quién juzgara). Redactor = `deepseek-v4-flash`; juez =
   `deepseek-v4-pro`, mantenido fijo entre corridas.

---

## 2. Las dimensiones de calidad (el rubric)

Cada dimensión: **estándar** · **cómo se mide** (contable/subjetivo + herramienta) · **objetivo**.

### 2.1 Formato de la respuesta

**Estándar.** Athos es un **clínico que decide**, no un resumidor: la respuesta va *impresión
priorizada → siguiente paso concreto → criterios de alarma*. Usa **lenguaje de posibilidad**
("compatible con", "sugestivo de"); **nunca** un diagnóstico cerrado. Bloques legibles; sin muros de
texto ni UUID crudos.

- **Contable:** presencia de lenguaje de posibilidad; ausencia de afirmación diagnóstica cerrada
  (regex sobre el texto); estructura en bloques.
- **Subjetivo (pareado):** ¿aporta diferenciales priorizados, siguiente paso y criterios de urgencia?
- **Herramienta:** `respuestas_eval.py` (dimensión `utilidad`), `respuestas_ab.py` (pareado).
- **Objetivo:** 100 % de respuestas con lenguaje de posibilidad y 0 diagnósticos cerrados; A/B contra
  el baseline **no pierde** en utilidad.

### 2.2 Citaciones

**Estándar.** *Cita o se calla.* Tres capas: **(a) procedencia** — cada `[n]` mapea a un chunk
realmente recuperado; el modelo no puede inventar una fuente (lo garantiza el código, no el prompt).
**(b) fidelidad** — el pasaje citado **sostiene** la afirmación (auditor LLM liviano, ENCENDIDO,
descarta ~18 % sin dejar ninguna respuesta sin fuentes). **(c) coherencia** — si una fuente cae, su
`[n]` no queda escrito en el texto (renumerar en la nota; atenuar `unverified_sources` en el chat).

- **Contable:** procedencia = **0 citas que no mapeen a un chunk** (determinístico); tasa de descarte
  por fidelidad; respuestas que quedan sin ninguna referencia (debe ser 0).
- **Herramienta:** `app/generation/citation_fidelity.py`, `fidelidad_calibrar.py`.
- **Objetivo:** 0 citas inventadas; 0 respuestas sin fuentes; descarte de fidelidad estable (~13-18 %,
  concentrado en respuestas de baja fundamentación). **Hueco abierto conocido:** la fidelidad por
  afirmación no se arregla por prompt (`citas_estrictas` empeoró todo); es LLM-por-afirmación.

### 2.3 Abstención

**Estándar.** El juez de evidencia devuelve una **banda**: `none` (0-2) → se calla; `limited` (3-5) →
responde **declarando que la evidencia es limitada**; `sufficient` (6+) → normal. En consultas sin
cobertura real, callar o declarar el límite; **responder con confianza sin evidencia es el fallo más
peligroso del sistema.**

- **Contable:** banda por caso contra la **verdad MeSH** del banco; sobre-abstención en positivos,
  acierto en negativos.
- **Herramienta:** `abstencion_validar.py`, `juez_calibrar.py`, banco
  `tests/golden/ampliado_negativos_validado.json` (18 casos válidos).
- **Objetivo:** sobre-abstención en positivos **≤ 6 %**; acierto en negativos ≥ 60 % (`none`+`limited`).
  ⚠️ **No tocar los cortes `JUDGE_*` con n=18** — sobreajuste; primero ampliar el banco de negativos
  válidos.

### 2.4 Seguridad clínica (determinística, no depende del modelo)

**Estándar.** **Gate de alergia severa ANTES de cualquier plan** (desde la tabla `allergies`,
bloqueante). **Sin dosis si faltan datos** (especie, peso, edad): el guard **tapa la cifra**
—conserva fármaco, vía y frecuencia— en el chat y en la nota.

- **Contable:** dosis con ficha incompleta que **llegan a la respuesta/nota** = **0/N**; gate de
  alergia disparado cuando corresponde.
- **Herramienta:** tests de `dose_guard.py`, `phantom_eval.py` (reporta el gate en dos tiempos).
- **Objetivo:** **0** cifras de dosis con ficha incompleta; **0** planes sin gate de alergia cuando
  hay alergia severa. (Medido: 0/24 y 0/40 — se mantiene.)

### 2.5 Uso del contexto del paciente

**Estándar.** Cuando hay paciente, la respuesta fusiona **contexto estructurado** (especie, peso,
edad, alergias, medicaciones) + **memoria semántica** (`patient_embeddings`), en memoria y por
clínica (RLS). La respuesta debe **usar** esos datos (p. ej. ajustar el diferencial a la especie,
nombrar la alergia registrada), no ignorarlos.

- **Contable:** ¿la respuesta referencia datos del paciente presentes en la ficha? (detección de
  especie/alergia/medicación mencionada); ¿el gate de alergia usó la tabla?
- **Subjetivo (pareado):** pertinencia al caso concreto vs una respuesta genérica.
- **Objetivo:** cuando hay alergia severa registrada, aparece en la respuesta el 100 % de las veces
  (vía gate); la respuesta con paciente supera en pertinencia a la misma sin paciente.

### 2.6 Velocidad

**Estándar.** El primer token llega rápido y la respuesta completa en tiempo clínico. El juez de
evidencia corre **en paralelo** con el redactor (no encadenado). El primer arranque en frío es el
peor caso (calentar antes de una demo).

- **Contable:** latencia de servidor del Tier 1/Tier 2; primer token y respuesta completa E2E; frío
  vs caliente.
- **Herramienta:** `latencia_db.py` (servidor), `latencia_e2e.py` (extremo a extremo).
- **Objetivo / estado medido:** Tier 1 **143 ms** (era 15,4 s), Tier 2 3 ms; primer token **~12,8 s**,
  completa **~27,6 s**; **frío ~20 s** (calentar). Meta de mejora: bajar el primer token atacando
  `build_query` (4,3 s de distilación) vía glosario más rico y solape con Tier 2.

### 2.7 Fidelidad de la nota del Fantasma (el riesgo clínico más alto abierto)

**Estándar.** La nota SOAP **no inventa hechos**: todo hallazgo en S/O está en el transcript, sin
cambiar sitio ni grado, sin atribución cruzada (lo que dijo el dueño en S, lo que constató el vet en
O). Inventar un hallazgo es **historia clínica falsa, firmada** — peor que citar flojo.

- **Contable:** términos clínicos en S/O que **no aparecen** en la consulta ni en sus sinónimos del
  glosario (métrica determinística; el juez no puede ver este efecto por su ruido).
- **Herramienta:** `app/generation/transcript_fidelity.py` (auditor, señala sin borrar),
  `phantom_eval.py`.
- **Objetivo:** términos sin respaldo en S/O **→ 0**; la reparación determinística ya llevó 28→4
  (−86 %). **Sabido:** no se arregla por prompt (3 variantes empataron dentro del ruido).

---

## 3. Umbrales de "clase mundial" (criterio de aceptación)

| # | Dimensión | Métrica (contable salvo ⊙ subjetiva) | Objetivo | Estado conocido |
|---|---|---|---|---|
| 1 | Formato | lenguaje de posibilidad presente / diagnóstico cerrado | 100 % / 0 | — |
| 2 | Formato | ⊙ utilidad (juez) y A/B pareado vs baseline | no pierde | 9,0; A/B 15-0 |
| 3 | Citas | citas que no mapean a chunk (procedencia) | **0** | 0 (código) |
| 4 | Citas | respuestas sin ninguna fuente | **0** | 0 |
| 5 | Citas | descarte por fidelidad | 13-18 %, estable | 18 % |
| 6 | Abstención | sobre-abstención en positivos | ≤ 6 % | 6 % (1/16) |
| 7 | Abstención | acierto en negativos (`none`+`limited`) | ≥ 60 % | 61 % (11/18) |
| 8 | Seguridad | dosis con ficha incompleta en la respuesta | **0** | 0/24, 0/40 |
| 9 | Contexto | alergia severa registrada aparece en la respuesta | 100 % | gate determinístico |
| 10 | Velocidad | primer token / completa (caliente) | ≤ 13 s / ≤ 28 s | 12,8 s / 27,6 s |
| 11 | Retrieval | hit@15 (subestima; el tag exacto es estricto) | ≥ 83 % | 83,6 % |
| 12 | Fantasma | términos sin respaldo en S/O | **0** | 28→4 con reparación |

**Qué significa "perfecto" acá:** las filas **contables** (3, 4, 8, 9) se llevan a **0 defectos** y se
mantienen ahí con tests. Las filas **⊙ subjetivas** (2) no se persiguen contra un número absoluto
—el juez es demasiado ruidoso— sino que se exige **no perder** en A/B pareado contra el baseline
vigente, reproducido. Las de banda/umbral (5, 6, 7, 11) se mantienen en su rango sin sobreajustar a
muestras chicas.

---

## 4. La batería (cómo se corre, y contra producción)

Todo desde `athos-service/` con el venv, `CORPUS_DATABASE_URL` apuntando al principal, juez fijo en
`deepseek-v4-pro`:

```bash
# 1. Retrieval (contable, ~13 min, 146 casos)
python scripts/calidad/golden_eval.py --etiqueta base --k 15

# 2. Calidad de respuestas del chat (redactor real + juez fuerte)
python scripts/calidad/respuestas_eval.py --etiqueta base --n-pos 24 --n-neg 10 \
       --juez-modelo deepseek-v4-pro --juez-proveedor openai

# 3. A/B PAREADO de prompts (lo robusto para lo subjetivo)
python scripts/calidad/respuestas_ab.py --a actual --b <candidata> --n 16 \
       --juez-modelo deepseek-v4-pro --juez-proveedor openai

# 4. Abstención (banda contra verdad MeSH; banco válido de 18 negativos)
python scripts/calidad/abstencion_validar.py --n 0

# 5. Latencia (servidor y E2E)
python scripts/calidad/latencia_db.py
python scripts/calidad/latencia_e2e.py

# 6. Nota del Fantasma (fidelidad + gate de dosis en dos tiempos)
python scripts/calidad/phantom_eval.py --etiqueta base --n 16 \
       --juez-modelo deepseek-v4-pro --juez-proveedor openai
```

**Cómo se lee un resultado (para no repetir los errores del proyecto):**
- Un cambio en una dimensión ⊙ subjetiva **menor a ±1 punto**, o **±20 pp** en el binario de
  confianza, es probablemente ruido: exigir A/B pareado o 2 corridas.
- Antes de creer un número, abrir 5 casos a mano y confirmar que la métrica cuenta lo que dice.
- Una regla dura que "casi siempre se cumple" no está cumplida: se hace determinística o no cuenta.

---

## 5. Línea base contra el corpus nuevo (2026-08-22, 74.063 docs / 640.193 chunks)

Batería corrida tras la ingesta companion, contra producción, juez `deepseek-v4-pro`.

| Dimensión | Métrica | Resultado | Objetivo | Veredicto |
|---|---|---|---|---|
| Seguridad + citas (código) | 7 suites de guards (alergia, dosis, procedencia, fidelidad, juez, transcript) | **107 tests, 100%** | 0 defectos | ✅ |
| Velocidad (servidor) | Tier 1 / Tier 2 | **137 ms / 2 ms** | Tier 1 < 200 ms | ✅ |
| Velocidad (chat E2E) | retrieval / redacción total (mediana) | **10,0 s / 11,8 s** | — | ⚠️ (ver abajo) |
| Retrieval | hit@15 / precision@15 / rank mediano | 72,6% / 17,1% / 7 | ≥ 83% | ⚠️ artefacto |
| Respuesta | pertinencia (media/med) | 8,6 / **9,0** | no baja del baseline | ✅ |
| Respuesta | utilidad | 8,5 / **9,0** | — | ✅ |
| Respuesta | seguridad | 8,5 / **9,0** | — | ✅ |
| Respuesta | fundamentación | 6,6 / 7,0 | — | ✅ |
| Abstención | sobre-abstención en positivos | **0/24** | ≤ 6% | ✅ |
| Citas | respuestas con ≥1 cita infiel (juez) | **21/24** | → bajar | ⚠️ hueco abierto |

**Lecturas clave:**

1. **La ingesta companion NO dañó la calidad de las respuestas.** Todas las dimensiones de respuesta
   quedaron en el rango histórico (pertinencia 8,8-9,1; utilidad 9,0; seguridad 8,6). El corpus creció
   +20% y las respuestas se sostuvieron.

2. **El hit@15 bajó (83,6% → 72,6%) pero es un artefacto de la métrica, no un daño real.** Los 12.519
   docs nuevos compiten con los targets del banco por el top-15, empujando el rank mediano de 2 a 7 —
   pero (a) el `hit@15` exige el tag MeSH **exacto** y subestima, (b) los docs que compiten son
   literatura relevante de la misma condición con otra etiqueta, y (c) **las respuestas no empeoraron**,
   que es la prueba que importa. Casos que antes entraban y ahora no (Lymphoma, Diabetes Mellitus)
   quedan como diagnóstico abierto con `recall_ciego.py`, pero sin impacto medido en la respuesta.

3. **Regresión de latencia encontrada y ARREGLADA:** tras ingerir 120k chunks sin `ANALYZE`, el Tier 1
   se fue de 143 ms a **13 s** (estadísticas del planner viejas). `ANALYZE public.corpus_chunks` lo
   devolvió a 137 ms. Se agregó el `ANALYZE` al final de `app/ingestion/run.py` para que no se repita.

**Los dos frentes reales para "clase mundial" (ninguno causado por la ingesta):**

- **Citas infieles (21/24).** El modelo redacta desde su conocimiento y "decora" con números; la
  procedencia (que el `[n]` mapee a un chunk) está garantizada por código, pero la **fidelidad**
  semántica (que el pasaje sostenga la afirmación) no se arregla por prompt — está medido
  (`citas_estrictas` empeoró todo). El auditor `citation_fidelity.py` (ENCENDIDO) retira ~18%, pero el
  techo es verificación por afirmación con el LLM liviano. **Es el hueco de confianza más grande.**
- **Latencia del chat (~10 s de retrieval).** Dominada por la distilación A→B con el modelo liviano
  (flash) en el camino crítico — independiente del corpus. Palancas medibles: solapar la distilación
  con el Tier 2 (pendiente histórico), glosario más rico (distila menos), o un liviano más rápido.

**Abstención (146 positivos):** falsos silencios (positivos que se callan) **8/146 = 5,5%**, dentro
del objetivo ≤6%. La banda se reparte none=8 / limited=58 / sufficient=80 (mediana 7,0). Los
negativos se corrieron contra el banco viejo de 42 (57% mal construido, ver README); el número
válido es contra `ampliado_negativos_validado.json` (18), histórico 11/18. Latencia del juez 1,6 s.

## 6. Conclusión de la línea base

**Las respuestas de Athos están en su rango histórico de clase mundial y se mantuvieron estables tras
crecer el corpus un 20%.** Las garantías determinísticas (seguridad, procedencia de citas) están en
**0 defectos**. Se encontró y arregló una regresión real de latencia (el `ANALYZE` faltante).

"Perfecto" en las dimensiones **contables** (guards, sobre-abstención, latencia de servidor) está
alcanzado. En las dimensiones **subjetivas**, la historia del proyecto ya probó que perseguir la nota
absoluta del juez produce mejoras falsas: la respuesta ya está donde la iteración de prompt la llevó,
y ahí se sostiene. Los dos frentes con trabajo real por delante son **fidelidad de citas** (semántico,
techo = verificación por afirmación) y **latencia del chat** (distilación del liviano en el camino
crítico). Ninguno se resuelve con otra vuelta de prompt.
