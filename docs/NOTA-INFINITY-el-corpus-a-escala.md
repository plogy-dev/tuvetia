# Nota para Infinity — qué pasa cuando el corpus se multiplica

Contexto: vas a indexar más archivos. Esto es lo que el código ya sabe sobre escala y lo que cambia
cuando el corpus crece. Análisis de código (`athos-service/app/retrieval/cascade.py`), no medición:
el corpus vive en el proyecto de dev y desde acá sólo tengo lectura del principal.

**Titular: la latencia está protegida. La exhaustividad no, y su caída es invisible.**

---

## Lo que ya se aprendió a los 520k chunks

Está documentado en `cascade.py:200-210` y conviene no repetirlo:

- El Tier 1 con `where mesh ?| ... or tsv @@ ...` tardaba **15 segundos de servidor**, justo en el
  `statement_timeout` de 15s (`app/db.py:17`): **en producción se cancelaban consultas.**
- Motivo: el `or` traía al heap todos los matches de ambas ramas —1.692 por MeSH y 17.147 por
  full-text en una consulta típica— y calculaba `ts_rank_cd` sobre los ~19k antes del `LIMIT`.
- Separadas en dos ramas: **42 ms, los mismos 40 chunks.**

## El hallazgo: los topes son absolutos y se aplican antes de rankear

Mirá el orden real en `TIER1_SQL` (`cascade.py:172`):

```sql
from (select ... from corpus_chunks
      where tsv @@ websearch_to_tsquery(...) and not (metadata->'mesh' ?| ...)
      limit 3000) c          -- ← TIER1_FTS_SCAN_CAP, sin ORDER BY
order by lex desc limit 40   -- ← el ranking corre DESPUÉS, sólo sobre esas 3.000
```

El tope está en la subconsulta **interna**. Postgres toma 3.000 filas *arbitrarias* —las que el
índice entregue primero— y sólo entonces las ordena por relevancia.

Como el tope es una constante y no una proporción:

| | hoy (520k) | a 5× (2.6M) |
|---|---|---|
| matches full-text de una consulta típica | 17.147 | ~86.000 |
| filas que llegan a rankearse | 3.000 | 3.000 |
| **fracción de candidatos considerada** | **17,5 %** | **3,5 %** |

**La latencia se queda plana —para eso está el tope— y la exhaustividad cae unas 5×.** El mejor
pasaje para una pregunta puede quedar fuera antes de que el ranking exista. Nada lo reporta: desde
afuera se ve un sistema rápido, no uno que está mirando menos.

Lo mismo aplica a la rama MeSH con `TIER1_MESH_SCAN_CAP = 20000`. Hoy una consulta normal trae 1-3k
—muy por debajo del tope, así que no se pierde nada— pero a 5× serían 5-15k y empieza a rozarlo.

**Lo más barato que se puede hacer:** loguear el conteo de matches *antes* del tope. Si
`matches > CAP`, esa consulta perdió candidatos. Convierte una degradación invisible en un número.

## La stoplist está calibrada a un tamaño de corpus

`TIER1_MESH_STOPLIST` (`cascade.py:83`) son 22 descriptores excluidos del Tier 1. La razón está
escrita en la línea 79:

> `Dogs` está en **43.033 de los 520k chunks**: si el A→B lo agrega, la rama MeSH pasa a 43k filas y
> revienta el `statement_timeout`.

O sea: el umbral de peligro está por encima de `TIER1_MESH_SCAN_CAP` (20.000). La lista es
**estática y hecha a mano**. A 5×, un descriptor que hoy tiene ~9k chunks llegará a ~45k — territorio
`Dogs` — y **no hay ningún mecanismo que lo detecte**. Se descubriría por consultas lentas o por
resultados peores.

Esta consulta, corrida contra dev después de indexar, encuentra a los próximos candidatos:

```sql
select termino, count(*) as chunks,
       round(100.0 * count(*) / (select count(*) from corpus_chunks), 2) as pct
from corpus_chunks, jsonb_array_elements_text(metadata->'mesh') as termino
group by termino
having count(*) > 15000
order by chunks desc;
```

Lo que salga y no esté ya en `TIER1_MESH_STOPLIST` es un candidato a sumar.

## Lo que no cambia

- Los índices están puestos: GIN sobre `tsv`, GIN sobre `metadata`, GIN dedicado sobre `mesh`
  (migración 0003), y HNSW sobre `embedding` (migración 0002). HNSW escala bien; no es la
  preocupación.
- Los topes de la fusión (`TIER1_KEEP = 24`, `TIER2_KEEP = 16`, 40 chunks a la generación) son de
  presupuesto de contexto, no de escala. No hay que tocarlos.

## Qué no verifiqué

- No medí el corpus: no tengo acceso al proyecto de dev desde acá. Los números de 5× son
  extrapolación lineal de los que el propio código documenta.
- No corrí `scripts/calidad/latencia_db.py`, que es la herramienta que mide exactamente el SQL de
  producción. Vale la pena correrlo antes y después de indexar: la comparación es el dato que esta
  nota no puede dar.
