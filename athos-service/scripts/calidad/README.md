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

## Retrieval

```bash
python scripts/calidad/golden_eval.py --etiqueta baseline --k 15
```
Mide `hit@k`, `precision@k` y el rank del primer acierto. Correr antes y después de tocar la
cascada. Referencia: al activar el rerank, el target en el top-15 pasó de 37,8% a 69,7% y la
mediana del primer acierto del puesto 15 al 2.

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
