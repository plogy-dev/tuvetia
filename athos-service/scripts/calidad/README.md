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

`passes_threshold` da True en **187/187** casos: la regla "cita o se calla" hoy no protege nada.
Tres hipótesis medidas, dos muertas:

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
