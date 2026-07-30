# Banco de calidad de Athos

Herramientas para **medir** la calidad del retrieval y del glosario, no para adivinarla. Todas
corren contra el corpus real (`CORPUS_DATABASE_URL`) y ninguna escribe a la DB salvo las de
glosario, que lo dicen explícitamente.

## Por qué existe este banco

El golden original (`tests/golden/cases.json`, 11 casos) está **saturado**: fue curado alrededor de
los 41 términos del glosario, 10 de sus 11 casos ya resuelven ≥3 conceptos y da 11/11 casi pase lo
que pase. Sirve como prueba de humo de que nada se rompió; no sirve para detectar mejoras ni
regresiones finas.

`tests/golden/ampliado.json` (146 casos) resuelve eso **anclando la verdad de terreno al corpus**:
por cada condición con 100-1.700 chunks se generó una transcripción realista en español, y el
criterio no es una opinión sino un hecho verificable — ¿los chunks recuperados llevan ese
descriptor MeSH en su `metadata->mesh`?

`tests/golden/ampliado_negativos.json` (42 casos) es el control negativo: consultas sobre
condiciones **ausentes del corpus o con 1-3 chunks**. Athos debería abstenerse en éstas.

> **Limitación consciente:** el banco mide RECUPERACIÓN de la literatura correcta, no si la
> redacción final es clínicamente buena. Además la etiqueta "el chunk lleva ese descriptor" es
> estricta: un pasaje puede responder la consulta sin llevar ese tag exacto, así que las cifras
> absolutas subestiman. Para comparar ANTES/DESPUÉS de un cambio es sólido, porque el sesgo es el
> mismo de los dos lados.
>
> Esa limitación es lo que vino a cubrir el banco de **calidad de respuestas** (más abajo): mide lo
> que el veterinario realmente lee, no lo que el buscador recupera.

## Calidad de las RESPUESTAS (2026-07-29)

El mandato de producto es que hablar con Athos se parezca a consultar a un clínico con décadas de
experiencia. Eso no lo mide el retrieval: una respuesta puede apoyarse en la literatura correcta y
aun así ser un resumen genérico que el veterinario ya sabía.

```bash
python scripts/calidad/respuestas_eval.py --etiqueta baseline --n-pos 24 --n-neg 10 \
       --juez-modelo deepseek-v4-pro --juez-proveedor openai
```

Corre el flujo REAL del chat (importa `CHAT_SYSTEM`/`_chat_prompt`/`_cited_from_answer` de
`app.chat`; una copia mentiría en cuanto el prompt cambie) en modo consulta general — sin paciente
y **sin escribir** `athos_messages` ni `rag_retrieval_log`. Redacta con el modelo de producción y
califica con un juez fuerte y distinto del redactor (`--juez-modelo`; nunca el mismo flash que
redacta: un modelo es el peor evaluador de sí mismo). **Mantener el mismo juez entre corridas**, o
las cifras dejan de ser comparables.

Rúbrica 0-10: `pertinencia`, `fundamentacion` (¿el pasaje citado sostiene lo afirmado?),
`seguridad`, `utilidad` (lo que agrega un veterano: diferenciales priorizados, siguiente paso
concreto, criterios de urgencia) y `honestidad`, más un binario: *¿un veterinario experimentado
seguiría esta recomendación tal cual?*

En los **negativos** (condiciones ausentes del corpus) lo correcto es callar o declarar el límite;
responder con confianza es el modo de falla más peligroso que puede tener el sistema.

### A/B de prompts

```bash
python scripts/calidad/respuestas_ab.py --a actual --b clinico --n 16 \
       --juez-modelo deepseek-v4-pro --juez-proveedor openai
```

Recupera **una sola vez** por caso y hace redactar a las dos variantes sobre la MISMA literatura:
así la diferencia medida es del prompt y no del retrieval (que además es la etapa cara). El juez ve
las dos respuestas juntas y elige — comparar es más fiable que puntuar por separado. Las variantes
viven en `prompts_variantes.py`; la `actual` se importa de `app.chat` y solo se mueve una candidata
a producción **después** de ganar la medición.

### ⚠️ Cuánto ruido tiene una corrida (leer antes de comparar dos números)

Dos corridas con **el mismo prompt, el mismo modelo, el mismo banco y el mismo juez** dieron:

| | corrida A | corrida B |
|---|---|---|
| fundamentación | 7,0 | **5,8** |
| "un vet experimentado seguiría esto" | 16/24 (67%) | **7/22 (32%)** |
| utilidad | 9,0 | 8,7 |
| pertinencia | 8,8 | 9,0 |

Nada cambió entre las dos: la diferencia es variabilidad del redactor y del juez. **Una diferencia
de ±1 punto en una dimensión, o de 20 puntos porcentuales en el binario de confianza, puede ser
puro ruido.** Consecuencias prácticas:

- **Lo robusto es el A/B pareado** (`respuestas_ab.py`): el juez ve las dos respuestas del MISMO
  caso en el MISMO llamado y elige. Un 15-0 ahí sí significa algo.
- **Lo robusto son los cambios grandes y repetidos**: la utilidad subió de 5,9 a 9,0 y a 8,7 en dos
  corridas independientes — esa ganancia es real.
- **Lo robusto es lo determinístico**: "0/24 cifras de dosis" no pasa por ningún juez.
- Para dimensiones sutiles (fundamentación), una sola corrida de 24 casos **no alcanza**. Hay que
  parear o repetir.

### Lo que encontró la primera corrida (2026-07-29)

Línea base con el prompt viejo, 24 positivos + 10 negativos contra producción:

| | baseline | con prompt de clínico |
|---|---|---|
| pertinencia | 8,1 | **9,1** |
| fundamentación | 6,3 | 6,8 |
| seguridad | 8,0 | **8,6** |
| **utilidad** | 5,9 | **9,0** |
| honestidad | 7,8 | 8,3 |
| **"un vet experimentado seguiría esto"** | **3/23** | **13/23** |
| respuestas con ≥1 cita infiel | 18/23 | 18/23 |
| largo mediano | 1.656 chars | 4.972 chars |

> Leer estas cifras con la sección de ruido arriba: la **utilidad** (+3, reproducida en dos corridas)
> y el A/B pareado 15-0 son sólidos; el binario de confianza oscila entre 32% y 67% **sin que nada
> cambie**, así que sirve como señal de dirección, no como nota.

El A/B directo (misma literatura) dio **15-0** a favor del prompt de clínico. La ganancia viene de
lo que el juez pedía en 23 de 24 casos: **diferenciales priorizados, siguiente paso concreto y
criterios de urgencia**.

**Dos hallazgos que NO se arreglan con prompt:**

1. **Cifras de dosis.** El prompt viejo ya prohibía dosificar sin datos y aun así dejaba pasar
   cifras en 2/23; con el prompt resolutivo subió a **9/23** (pedirle que decida lo empuja a
   dosificar) y endurecer el texto de la regla no alcanzó — escribía el rango y advertía después.
   Por eso existe `app/generation/dose_guard.py`, determinístico, igual que el gate de alergia.
2. **Citas infieles: 18/23 en ambas variantes.** El modelo redacta desde su conocimiento y luego
   "decora" con números; `_cited_from_answer` verifica que el `[n]` exista, no que el pasaje
   sostenga la afirmación. Es el hueco de confianza más grande que queda abierto y necesita una
   verificación de fidelidad por afirmación, no otra vuelta de prompt.

### Por qué la fidelidad de las citas NO se arregla con prompt (medido, no repetir)

Se probó una variante `citas_estrictas` (en `prompts_variantes.py`, conservada como evidencia) que
pedía citar por cláusula, prohibía la cita múltiple decorativa y nombraba los casos de la tabla de
datos y del caso único. **Empeoró todas las dimensiones**: fundamentación 7,0 → 6,3, utilidad
9,0 → 8,6, honestidad 8,4 → 7,9, y "un vet experimentado seguiría esto" **16/24 → 8/23**. Las citas
infieles ni se movieron (18/24 → 19/23).

Lo que lo explica: el modelo pasó a citar **más** (mediana 6 → 8 fuentes). Insistirle sobre las
citas le sube la ansiedad por citar y le diluye las instrucciones clínicas, que es de donde venía
la ganancia.

Antes de construir el verificador se midió también la hipótesis barata — que el problema fueran
**cifras inventadas** con cita — y quedó descartada: de 14 cifras duras (`%`, "X de cada Y")
presentadas con cita, **11 estaban en el pasaje citado**, y los 3 fallos son de una sola respuesta.
Un guard determinístico de cifras habría resuelto un problema que casi no existe. Los fallos reales
son semánticos (extrapolar el pasaje, citar tablas como narrativa, cita múltiple decorativa), y eso
exige LEER: verificación por afirmación con el LLM liviano.

### Calibración del auditor de fidelidad (2026-07-29, con revisión humana)

```bash
python scripts/calidad/fidelidad_calibrar.py --entrada respuestas_final.json --n 12 --ver 6
```

Reusa las respuestas **ya generadas** por `respuestas_eval.py` en vez de volver a llamar al redactor:
así dos umbrales se comparan sobre EL MISMO texto, que es lo único que los hace comparables. Mide la
tasa de descarte, marca las respuestas que quedarían sin ninguna referencia e **imprime cada descarte
junto al pasaje citado**, porque un número agregado no alcanza para decidir un umbral.

| | primera versión | recalibrada |
|---|---|---|
| fuentes descartadas | **58 %** (81/140) | **18 %** (16/90) |
| respuestas que quedan sin ninguna referencia | 1 | **0** |
| respuestas intactas | — | 4/12 |
| latencia del auditor | 1,8 s | 1,6 s |

Lo que cambió el prompt: invertir la carga de la prueba (*"EN CASO DE DUDA, LA CITA SOSTIENE"*, y
decir explícitamente que descartar una cita legítima le quita al veterinario una fuente válida),
enumerar 6 casos que NO debe marcar y limitar los `false` a 4 casos claros.

**Señal de que el umbral quedó bien:** las respuestas que el juez de calidad puntúa alto quedan
**intactas** — `ehrlichiosis` (F=8) conserva sus 11 fuentes, `hip-dysplasia-canine` (F=8) sus 7,
`parasitemia` (F=7) sus 9. Los descartes se concentran en las de fundamentación baja
(`craniosynostoses` F=4 pierde 3 de 8).

#### Revisión humana de los 6 descartes impresos

| caso | fuente | veredicto | por qué |
|---|---|---|---|
| `heart-valve-diseases` | [1] | ✅ correcto | la afirmación habla de síncope y arritmia; el pasaje son generalidades sobre tratamiento de MMVD, no menciona ninguno de los dos |
| `craniosynostoses` | [1] | ✅ correcto | la afirmación es sobre siringomielia; el pasaje es la **demografía de los encuestados** de un estudio de dueños (edad, país, género) |
| `intervertebral-disc-degeneration` | [3] | ✅ correcto | la afirmación es sobre signos clínicos de mielopatía; el pasaje es **embriología y anatomía** del disco |
| `intestinal-diseases` | [6] | ✅ defendible | el pasaje sí respalda que el cuadro es típico (con cifras), pero **no** el pronóstico favorable que la afirmación agrega |
| `flea-infestations` | [6] | ⚠️ discutible | el pasaje relaciona la paja en descomposición con *Pelodera*; sostiene la idea de limpieza ambiental sólo de forma tangencial |
| `rickettsia-infections` | [8] | ❌ **falso positivo** | la afirmación es "se ha reportado coinfección" y el pasaje trae cifras de *R. conorii* **y** *E. canis* en el mismo estudio: sí la respalda |

**4 de 6 claramente correctos, 1 defendible, 1 falso positivo.** El único error tenía un patrón
identificable — un conjunto de datos que prueba la **coocurrencia** de dos entidades — y se corrigió
añadiendo esa excepción al prompt, distinguiéndola del caso legítimo (una tabla de valores **no**
puede sostener un pronóstico, pero **sí** la existencia o la frecuencia de un hallazgo).

**Decisión: se enciende.** El intercambio es favorable para el mandato de confianza clínica — se
retiran ~13 citas engañosas por cada ~3 legítimas, ninguna respuesta queda sin fuentes, y es
reversible con `FIDELITY_ENABLED=false` sin redespliegue.

### Historia: por qué estuvo apagado

`app/generation/citation_fidelity.py` parte la respuesta en afirmaciones citadas y le pregunta al
LLM liviano, por cada una, si el pasaje la sostiene; las fuentes que nunca sostuvieron nada no se
ofrecen como referencia. Falla abierta y tiene 12 tests.

**Funciona pero descarta demasiado**: medido contra producción audita 8,7 afirmaciones por respuesta
en 1,8 s y tira el **58% de las referencias** (81 de 140). El problema no es que falle, es que su
umbral castiga la reformulación legítima igual que la extrapolación: en `heart-valve-diseases`, que
el juez de calidad puntuó con fundamentación **9**, descartó 4 de 5 fuentes; en
`intervertebral-disc-degeneration` (fundamentación 8) descartó las 8 y dejó la respuesta sin ninguna
referencia.

Por eso `FIDELITY_ENABLED` viene en `false`. Para calibrarlo: pedirle al verificador que marque sólo
lo que **claramente** no sostiene (con un "en caso de duda, sostiene"), y validar a mano una muestra
de descartes antes de encenderlo. Encenderlo como está degradaría las referencias que el veterinario
usa para verificar.

## Retrieval

```bash
python scripts/calidad/golden_eval.py --etiqueta baseline --k 15
```
Mide `hit@k`, `precision@k` y el rank del primer acierto. Correr antes y después de tocar la
cascada.

**Línea base de PRODUCCIÓN (2026-07-28)** — la primera; todas las cifras anteriores se habían
tomado contra dev, que tiene 67k chunks y 41 términos de glosario contra 520k y 818. Por eso salen
bastante mejor de lo que creíamos:

| métrica | dev (medición vieja) | producción, 146/146 |
|---|---|---|
| hit@15 (el target en el top-15) | 69,7% | **83,6%** |
| precision@15 | 23,6% | **30,5%** |
| rank del primer acierto (mediana) | 2 | **2** |
| pasa el umbral | 100% | **100%** |
| pidió distilación al LLM | — | 45/146 |

La primera corrida (antes de la stoplist de especie) sólo pudo evaluar **137 de 146**: nueve casos
murieron por `statement_timeout`. Con la stoplist corren los 146 sin un solo fallo, en ~13 min en
vez de ~20, y las métricas SUBEN (82,5% → 83,6%; precision 29,9% → 30,5%): sacar la especie del
criterio de búsqueda no cuesta calidad, la mejora.

El umbral determinístico pasa en el 100% de los casos también en producción: confirma que la
abstención real es el juez semántico, no el umbral.

De los casos que fallan, buena parte es **ruido de etiquetas del banco**: los descriptores sin
acierto son en su mayoría paraguas abstractos (`Inflammation`, `Disease Progression`, `Recurrence`,
`Disease Susceptibility`, `Bacterial Infections`) que ningún veterinario consulta como tales.

### El "recall ciego" es casi todo artefacto del banco (revisado el 2026-07-29)

El pendiente estaba abierto desde el 2026-07-27 como *"condiciones con literatura abundante que el
retrieval NUNCA trae: Distemper (1.338 chunks), Lymphoma, Tick Infestations, Coccidiosis,
Toxocariasis"*. Al revisar la última corrida, **ninguno de esos cinco sigue fallando**: los arregló
la stoplist de especie y el A→B por especificidad. Lo que queda son **24 fallos de 146**, y al
abrirlos uno por uno casi todos son límites del banco, no defectos de Athos:

| grupo | casos | por qué no es un fallo real |
|---|---|---|
| paraguas abstractos | 12 | `Inflammation`, `Syndrome`, `Recurrence`, `Heart Diseases`… nadie consulta eso |
| aves indistinguibles | 3 | `influenza-in-birds`, `circoviridae-infections` y `west-nile-fever` son **el mismo loro** ("no come, plumas erizadas, decaído") con tres diagnósticos distintos. Ni un clínico los separaría del texto |
| solapamiento sindrómico | 4 | `enteritis`, `gastroenteritis`, `escherichia-coli-infections` y `ancylostomiasis` son el mismo cuadro de diarrea aguda con cuatro etiquetas. Traer `Enteritis` en vez de `E. coli Infections` no es un error clínico |
| término humano, no veterinario | 2 | `Breast Neoplasms` (lo veterinario es `Mammary Neoplasms, Animal`, que **sí funciona**) y `Coronavirus Infections` en gato (sería peritonitis infecciosa felina) |
| probable sinónimo | 1 | `staphylococcal-infections` es un pioderma; el retrieval trae `Pyoderma`, que es lo correcto |
| **candidatos a fallo real** | **2** | `lyme-disease` y `cardiomyopathies` (felina) — ver diagnóstico abajo |

Diagnosticados los dos con `recall_ciego.py`:

- **`cardiomyopathies` ya NO falla**: llega en el **puesto 3** del top-15. El A→B nombró
  `Cardiomyopathies` (distiló) y el Tier 1 lo trajo primero. El fallo era de una corrida anterior.
- **`lyme-disease` es el único fallo real y el culpable es el RERANK**: el Tier 2 (vector) lo traía
  en el puesto 36 de 40 candidatos y el reranker de Cohere lo dejó fuera de los 15. El Tier 1 no lo
  trae porque el A→B nunca nombra `Lyme Disease` — la consulta es "fue al campo, cojea, decaído" y
  el glosario resuelve `Fever`, `Lameness, Animal`, `Lethargy`, `Anorexia`, `Pain`: signos, ninguna
  condición. **Dos arreglos posibles**, ambos medibles: sembrar en el glosario el puente
  "campo/garrapata + cojera → borreliosis", o revisar por qué el reranker hunde un pasaje que el
  vector puntuó como pertinente.

**Del "recall ciego" queda entonces UN caso de 146.**

**Consecuencia para leer las cifras:** el `hit@15` de 83,6% **subestima** el retrieval, porque exige
el tag exacto. Lo confirma el banco de respuestas: la pertinencia es 8,8–9,1 sobre 10. Para comparar
antes/después sigue sirviendo (el sesgo es el mismo de los dos lados); como nota absoluta, no.

```bash
python scripts/calidad/recall_ciego.py                    # los que fallan, con literatura
python scripts/calidad/recall_ciego.py --casos lyme-disease,cardiomyopathies
```
Abre la cascada por etapas y dice **en qué paso** se pierde el target (A→B, Tier 1, Tier 2, rerank o
filtros duros), que es lo que convierte "el recall es ciego" en algo accionable.

`golden_generar.py` regenera el banco de positivos (sólo si hace falta: regenerarlo rompe la
comparabilidad histórica).

## Abstención

`passes_threshold` da True en **187/187** casos: por sí sola, la regla "cita o se calla" no protege
nada. Cuatro hipótesis medidas, tres muertas:

| señal | positivos | negativos | veredicto |
|---|---|---|---|
| score determinístico | 1.701 | 1.700 | imposible: idénticos |
| score del reranker | 0.532 | 0.499 | cortar silencia tantos buenos como malos atrapa |
| nº de citas verificadas | 6,0 | 6,0 | inútil: el modelo cita igual sin cobertura |
| juez semántico (LLM liviano) | 7,0 | 5,0 | **separa**; cuesta ~1,8s |

El resultado de las citas es el más grave: la verificación confirma que cada `[n]` mapea a un chunk
recuperado, pero no puede saber que ese chunk **no responde la pregunta**. Produce apariencia de
fundamento. "Cita o se calla" está roto por partida doble.

```bash
python scripts/calidad/abstencion_roc.py     # compara scores determinístico y de rerank
python scripts/calidad/abstencion_juez.py    # juez semántico + latencia
python scripts/calidad/abstencion_citas.py   # ¿discrimina el nº de citas? (señal gratis)
```

Al mirar los desacuerdos del juez se ve que buena parte del solapamiento es **ruido de etiquetas**:
los positivos que puntúa bajo (Distemper, Lymphoma, Tick Infestations) son condiciones que el
retrieval **no trae** aunque el corpus las tenga — el juez acierta. Mide "¿los pasajes recuperados
cubren la consulta?", que es justo lo que la abstención debe decidir.

### Por qué el juez "dejó de discriminar" contra producción (2026-07-29)

El banco de respuestas mostró que **9 de 10 negativos reciben banda `sufficient`**, contra la
medición del 2026-07-27 que separaba 7,0 vs 5,0. Se contrastó cada negativo con un **árbitro fuerte**
(`deepseek-v4-pro`), preguntándole sólo si con esos pasajes un veterinario podría fundamentar una
respuesta. Resultado: **dos problemas distintos, no uno**.

**(1) La mitad de los "negativos" NO son negativos.** El árbitro dice que la literatura **sí
alcanza** en 5 de 10, con 8-9 sobre 10:

| caso | árbitro | qué trae el corpus en realidad |
|---|---|---|
| `neg-impetigo` | 9 | tratamiento del impétigo canino con clorhexidina (bajo `Pyoderma`) |
| `neg-neck-injuries` | 9 | lesión cervical, inestabilidad y hernia discal en perros |
| `neg-rheumatic-heart-disease` | 9 | enfermedad valvular crónica canina (el cuadro real; el descriptor es humano) |
| `neg-ossification-heterotopic` | 9 | osificación heterotópica en perros: etiología y presentación |
| `neg-exophthalmos` | 8 | espacio retrobulbar, exoftalmos, tumores y abscesos |

Los negativos se eligieron por **ausencia del descriptor MeSH exacto**, pero el corpus tiene la
literatura bajo otro descriptor (o el descriptor era humano). Así que la métrica "respondió con
confianza (peligro)" **sobreestima el problema**: en esos 5, responder era lo correcto.

**(2) Pero el juez liviano sí es demasiado blando.** En los 5 casos donde el árbitro confirma que la
literatura NO alcanza, el juez liviano se equivocó en **4**:

| caso | juez liviano (flash) | árbitro (pro) |
|---|---|---|
| `neg-ganglioglioma` | 8,0 → `sufficient` | 2 → no alcanza |
| `neg-hepatitis-viral-animal` | 8,0 → `sufficient` | 2 |
| `neg-granular-cell-tumor` | 7,0 → `sufficient` | 1 |
| `neg-pneumonia-atypical-interstitial-of-cattle` | 6,0 → `sufficient` | 2 |
| `neg-fascioloidiasis` | 2,0 → `none` ✅ | 3 |

El patrón: el liviano premia que los pasajes **mencionen la entidad** ("los pasajes discuten
específicamente gangliogliomas caninos"); el árbitro exige que **respondan al caso** ("ninguno aborda
el diagnóstico diferencial ni el manejo de una masa cerebral con estos signos"). Es la misma
distinción que el juez debía hacer y que el modelo flash no hace.

**Arreglo, de una variable — MEDIDO Y ADOPTADO:** `JUDGE_MODEL` apuntado al modelo grande.

| negativos (10) | juez liviano | juez grande |
|---|---|---|
| se abstuvo | 0-1 | **2** |
| respondió declarando evidencia limitada | 1 | **3** |
| **respondió con confianza** | **8-9** | **5** |
| sobre-abstención en positivos | 2/24 | **2/24** (no sube) |
| latencia del juez | 1,7 s | 2,1 s (corre en paralelo: no se paga) |

Los 5 que siguen respondiendo con confianza son **exactamente** los 5 donde el árbitro dijo que la
literatura sí alcanza. O sea que el juez grande queda alineado con el criterio correcto.

Se setea como variable de Railway (sin redeploy). Rollback: borrar `JUDGE_MODEL` y vuelve al liviano;
`JUDGE_ENABLED=false` apaga el juez entero.

### Ya implementada (2026-07-28)

El juez vive en `app/generation/evidence_judge.py` y devuelve una **banda** en vez de un binario:
`none` (0-2) → abstención dura, `limited` (3-5) → se responde declarando evidencia limitada,
`sufficient` (6+) → normal. Cortes y modelo por env (`JUDGE_*`); falla abierta.

```bash
python scripts/calidad/abstencion_validar.py            # muestra de 12 + 12 (regresión rápida)
python scripts/calidad/abstencion_validar.py --n 0      # banco completo (187 casos)
```

Este script corre el pipeline REAL (incluido `judge_evidence`), no una copia: es el que hay que
correr después de tocar el prompt del juez, el modelo liviano, los cortes o el reranker. Corrida de
referencia (muestra 12+12, dev): positivos `sufficient` 9 / `limited` 1 / `none` 2, mediana 8,0;
negativos `none` 2 / `limited` 3 / `sufficient` 7, mediana 6,0; latencia mediana 2,0s. Los dos
positivos que abstienen (`bone-neoplasms`, `spinal-cord-injuries`) son **recall ciego**: el
retrieval trajo displasia de codo y signos neurológicos genéricos: callar ahí es lo correcto.

### Latencia: por qué el juez va en paralelo y no encadenado

Desglose del chat medido en dev (una consulta cubierta, contra el corpus remoto):

| etapa | seg |
|---|---|
| `build_query` (A→B; distila con el LLM liviano si el glosario no llega a 3 conceptos) | 4,3 |
| `retrieve` (Tier 1 + Tier 2 en paralelo + rerank) | 4,4 |
| juez de evidencia | 2,3 |
| 1er token del redactor | 1,1 |

El redactor arranca rápido (1,1s), así que **encadenar** el juez habría sumado sus 2,3s enteros al
tiempo hasta el primer token. Corriendo los dos a la vez y reteniendo tokens, el costo real es
`max(2,3; 1,1) − 1,1 ≈ 1,2s`. Se puede apagar con `JUDGE_ENABLED=false` (sin deploy) y el tope de
espera es `JUDGE_CHAT_TIMEOUT_S`.

Hallazgo lateral: el mayor costo antes del primer token no es el juez sino **`build_query` (4,3s)**,
que es el LLM liviano distilando porque el glosario no resuelve. Ampliar el glosario (arriba) ataca
esa latencia además de la calidad.

## Latencia: el Tier 1 tardaba 15 segundos (2026-07-28)

```bash
python scripts/calidad/latencia_db.py    # tiempo de SERVIDOR de las 2 consultas del hot-path
```

Medir desde una notebook mezcla la latencia de red con el costo real; Railway corre al lado de la
DB, así que lo que importa es el tiempo del servidor. `EXPLAIN ANALYZE` lo separa:

| consulta | antes | después |
|---|---|---|
| Tier 1 (full-text + MeSH sobre 520k) | **15.397 ms** | **143 ms** |
| Tier 2 (pgvector HNSW) | 3 ms | 3 ms |

El Tier 1 estaba **al filo del `statement_timeout` de 15s**: en producción se cancelaban consultas
(se veía como "canceling statement due to statement timeout" al correr el banco). El vector, en
cambio, siempre estuvo perfecto — el problema era la consulta "gratis", no la cara.

Causa: `where tsv @@ ... or metadata->'mesh' ?| ...` obliga a un BitmapOr que trae al heap TODOS los
matches de las dos ramas (1.692 por MeSH + 17.147 por full-text en una consulta típica) y calcula
`ts_rank_cd` sobre los ~19k **antes** del LIMIT — aunque el orden primario (`mesh_hit desc`) ya
garantice que los de MeSH van primero. Separando las ramas sólo se rankea la que puede quedar
arriba. Verificado sobre 8 casos del golden: **99% de solapamiento** en el top-40, speedup mediano
de 5x en pared (dominado por la red del que mide) y 108x del lado del servidor.

El SQL vive en `cascade.TIER1_SQL` y el script lo importa de ahí a propósito: una copia en el script
de medición mentiría en cuanto uno de los dos cambiara.

**La especie ya no se usa para buscar** (`cascade.TIER1_MESH_STOPLIST`). Aun con las ramas
separadas quedaban casos que reventaban el timeout: el prompt de distilación pide *"incluye la
especie como MeSH si se conoce"*, así que el A→B agregaba `Dogs` — que está en **43.033 de los 520k
chunks**— y la rama MeSH pasaba a 43k filas. En el caso `pain` del banco eso son 43.072 chunks; sin
`Dogs`, 963. Además de la latencia, arregla un problema de calidad ya documentado: el MeSH de
especie contaba como "evidencia temática" para el umbral, una de las razones por las que
`passes_threshold` daba True en 187/187. La especie sigue viva como **preferencia** (el boost de
`score_chunk` vía `preferred_species_mesh`), que es lo que el diseño siempre dijo que debía ser.

## A->B: especificidad en vez de cantidad (2026-07-28)

`build_query` decidía si llamar al LLM liviano **contando** conceptos (`MIN_CONFIDENT_CONCEPTS=3`).
Contar no es entender: "toma muchísima agua, orina mucho y bajó de peso" resuelve tres signos
genéricos, pasaba el umbral y el retrieval nunca recibía `Diabetes Mellitus`.

```bash
python scripts/calidad/ab_decision_diff.py              # qué casos cambian de decisión (segundos)
python scripts/calidad/ab_decision_diff.py --retrieval  # + hit@15 real, sólo en los que cambian
```

Medir sólo los casos que cambian es lo que hace la comparación barata: de 146 casos, la decisión
cambia en 31, y **son los únicos donde el resultado puede diferir**. Los dos brazos NO fueron en la
misma dirección (hit@15 contra producción):

| brazo | casos | mejora | empeora | igual |
|---|---|---|---|---|
| exigir que nombre una condición (distila **más**) | 20 | **7** | 2 | 11 |
| relajar la cantidad si ya nombró una (distila **menos**) | 8 | 3 | 3 | 2 |

Por eso la regla adoptada es la **unión**, no el reemplazo: se exigen las dos cosas (cantidad Y
especificidad). Distilar de más sólo cuesta latencia —la distilación es aditiva, nunca reemplaza lo
del glosario— mientras que distilar de menos cuesta respuestas. El segundo brazo ahorraba ~4,3s en
el 6% de las consultas, pero a cambio de regresiones impredecibles: no vale la pena.

Costo: 22 de 146 consultas (15%) pasan a pagar la distilación que antes se salteaban. La forma de
recuperar esa latencia sin perder la calidad es **solapar la distilación con el Tier 2**, que no
depende de los conceptos (embebe el texto crudo) — pendiente.

La clasificación signo/condición sale del árbol MeSH y se regenera con
`mesh_especificidad_generar.py` (rama C23 = "Pathological Conditions, Signs and Symptoms"). Ojo: 124
descriptores son **ambiguos** (MeSH cruza-lista `Renal Insufficiency, Chronic` como enfermedad *y*
como signo); se los trata como signo a propósito, porque el error barato es distilar de más.

## Glosario

Pipeline en 4 pasos. **Sembrar es inerte** (`resolve.py` sólo lee `approved`); aprobar es lo que
toca producción, y va por tandas con gate.

```bash
python scripts/calidad/glosario_generar.py --min-chunks 5   # ES técnico + coloquial (LLM liviano)
python scripts/calidad/glosario_validar.py --max-chunks 2000 # guardas determinísticas
python scripts/calidad/glosario_sembrar.py                   # siembra como candidate
python scripts/calidad/glosario_gate.py --etiqueta antes
python scripts/calidad/glosario_sembrar.py --aprobar-tanda 250
python scripts/calidad/glosario_gate.py --etiqueta despues   # + eval_golden.py: exigir 11/11
python scripts/calidad/glosario_sembrar.py --revertir-tanda  # deshace lo aprobado por el script
```

El gate propio existe porque el golden no ve el riesgo real: con `MIN_CONFIDENT_CONCEPTS=3`, un
glosario más rico puede resolver 3 conceptos *incidentales* y **saltarse la distilación con el LLM**
que habría inferido el síndrome. `glosario_gate.py` avisa si algún caso deja de distilar.

`corpus_mesh_clasificado.tsv` es el mapa `descriptor → chunks → clase → ramas MeSH` de los 6.145
descriptores del corpus (traído de la SPARQL del NLM). De ahí salen los candidatos y los filtros.
