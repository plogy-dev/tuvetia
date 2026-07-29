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
