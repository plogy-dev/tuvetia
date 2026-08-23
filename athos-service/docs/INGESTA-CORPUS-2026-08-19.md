# Ingesta de corpus — entregas «lote final» y «corpus nuevo 2» (2026-08-19)

Documento de decisión y método para la ingesta de las dos entregas incrementales recibidas por
WeTransfer el 2026-08-19. Cada afirmación de números sale de contar los `manifest.csv` de cada
entrega; el conteo del corpus vivo sale de una consulta de solo lectura al proyecto principal.

## Qué llegó

| Entrega | Archivo | Documentos | Contenido |
|---|---|---|---|
| **A — «lote final» (lote 3)** | `wetransfer_corpus_lote_final_2026-08-19_1427.zip` (822 MB) → `tuvet_corpus_lote3_20260819.zip` anidado | 67.482 | companion 11.957 · producción/granja 51.530 · no-clínico 3.995. **56 % (`38.097`) marcados `qc_verdict=reject`** por el control de calidad del propio proveedor. |
| **B — «corpus nuevo 2» (delta)** | `22NuPQY…archivos` (= `corpus_nuevo_2_tuvetia_20260813.zip`, 483 MB) | 41.761 | **companion (mascotas) 3.842** en `documentos/` · producción/equino 37.919 en `documentos_tier2/`. |

Ambas traen `manifest.csv` con facetas nuevas y ricas: `alcance` (companion | tier2_produccion |
otros_no_clinico), `qc_verdict` (keep | borderline | reject), `tipo_documento`
(case_report / review / rct / clinical_study / guideline / drug_label / article), `categorias`
(multi-etiqueta) y `mesh`/`mesh_rich` donde PubMed los provee.

## La decisión (final, 2026-08-21): se indexa el núcleo COMPANION, sin `reject`

**Historia de la decisión — importa registrarla.**
1. Recomendación inicial: indexar solo companion (mascotas), ~15.800 docs.
2. El usuario pidió ampliar a los dos zips completos («indexa los 2 zips… ~80 mil»).
3. Al medir, aparecieron dos hechos que cambiaron el cuadro:
   - De los 109.243 docs totales, **63.964 (58%) están marcados `reject`** por el QC del proveedor.
   - El **costo real de embedding era ~2,5x mi estimación**: la corrida ya medía **~20.900
     tokens/documento** (los `word_count` del manifest subestiman los tokens de Cohere). El set
     no-reject completo (45.279 docs) costaba **~US$100–110**, no ~US$40.
4. Con el costo real sobre la mesa, el usuario delegó la decisión («sigo tu recomendación»).

**Alcance ingerido: `alcance = companion` (mascotas), sin `reject` — ≈ 14.432 documentos**
(11.957 del lote A `documentos_mascotas` + 2.475 companion no-reject del corpus nuevo 2). Costo
esperado **~US$25–30**.

**Por qué NO el set completo.** Athos es un asistente de **clínica de mascotas**. Los ~29.500
documentos de producción/granja/equino (`tier2_produccion`) y no-clínicos (`otros_no_clinico`) son
literatura **fuera de dominio** para perro/gato: costarían ~US$80 extra para material que el
asistente rara vez debería recuperar. Lo que expande su capacidad real es la literatura companion,
que entra completa. **Decisión reversible y aditiva**: los 45.279 no-reject ya están extraídos en
`_ingesta_work/ingest_A` y `ingest_B`; si Athos amplía su alcance a producción, se ingieren en su
momento.

**Ajuste de retrieval hecho igualmente (defensa a futuro).** En `app/retrieval/cascade.py` se añadió
una **penalización suave de score por `alcance`** (`ALCANCE_PENALTY = -0.15` para `tier2_produccion`
y `otros_no_clinico`). Hoy es inocua (no hay docs de producción indexados), pero deja el retrieval
listo para que, si se indexan, no compitan de igual a igual con la literatura companion en una
consulta de mascotas. El corpus PubMed original (sin `alcance`) y los `companion` no se penalizan.
**Pendiente**: calibrar la magnitud contra un golden ampliado antes de endurecerla.

**Infraestructura.** El núcleo companion (~14k docs) corre sobre el compute **Micro** del principal
(termina en pocas horas); **no se resizea a XL** — el reinicio de producción no se justifica para
este volumen. (El resize a XL, vía dashboard, sería la vía si algún día se ingiere el set completo.)

### Por qué

1. **Athos es hoy un asistente de clínica de mascotas** (companion animals). Los pacientes reales
   y de demostración son perros y gatos; el producto no atiende producción/granja.
2. **Instrucción explícita del proveedor.** El README de la entrega B dice, textual: *«Si el RAG es
   de mascotas, indexar SOLO `documentos/` (o filtrar `alcance=companion`)»*, y marca
   `documentos_tier2/` como *«NO es clínica de mascotas»*. La guía del lote 3 pide excluir
   `qc_verdict=reject`.
3. **Calidad de retrieval.** Hoy la cascada de recuperación **no filtra por `alcance`**. Si se
   embebieran los documentos de producción, un paper de engorde de pollos o de reproducción bovina
   competiría en la búsqueda con la consulta de un gato — degradando la respuesta para el caso de
   uso real. Los 38.097 `reject` están marcados como ruido por el propio QC: embeberlos baja la
   señal y cuesta dinero.
4. **El costo es real, y mayor de lo estimado.** El embedding se paga por token a Cohere (embed-v4).
   La corrida midió **~20.900 tokens/documento** (los papers companion son texto completo denso; los
   `word_count` del manifest subestiman ~2,5x). El núcleo companion (~14.4k docs) cuesta **~US$25–30**;
   el set no-reject completo (45.279 docs) habría costado **~US$100–110** e implicaba embeber ~30.847
   documentos de producción/equino fuera del dominio de mascotas. El usuario, con el costo real sobre
   la mesa, confirmó quedarse con el companion.

### Qué NO se pierde con esta decisión

- Entra **toda** la literatura de mascotas de calidad de ambas entregas (perro, gato, ave, conejo,
  reptil, roedor, hurón), con sus metadatos ricos (`tipo_documento`, `categorias`, `mesh`) que
  quedan en `metadata` y habilitan **mejores filtros de búsqueda a futuro** (p. ej. priorizar
  `case_report`/`guideline`).
- El corpus de mascotas pasa de **61.544 → 74.063 documentos** (+12.519 nuevos).
- Los documentos de producción/equino **siguen disponibles** (extraídos en `_ingesta_work/ingest_A`
  y `ingest_B`). Si algún día Athos amplía su alcance a animales de producción, se ingieren en su
  momento **con** el filtro de `alcance` ya programado en el retrieval. La decisión es reversible y
  aditiva.

### Aclaración: no existe un "tercer zip de 61 mil documentos"

El 2026-08-21 surgió la duda de si faltaba ingerir un zip adicional «de 61 mil documentos». Se
verificó en todo el disco accesible: **no existe tal archivo**. Los únicos dos zips son los dos de
esta entrega (109.243 docs). El número «61 mil» corresponde al **corpus original de junio**
(`corpus_v2_tuvetia_20260623.zip`, 61.544 docs), que **ya está ingerido** — es la base viva de la
plataforma. No hay nada pendiente por ese lado.

## Método de ingesta

Se reutiliza el pipeline determinístico y probado del servicio (`app/ingestion/`):
`parse_document` (frontmatter YAML → `metadata`) → `chunk_document` (~800 tokens, ~100 de solape,
sin partir tablas ni dosis, `locator` por sección) → `embed_texts` (Cohere embed-v4, dim 1024) →
`_insert_chunk_rows` (a `public.corpus_chunks`, `tsvector` por idioma). **Idempotente por
`content_hash`**: los documentos ya presentes se saltan sin gasto, así que reingerir es seguro y
las entregas que se solapen entre sí (o con el corpus vivo) no duplican.

- **Un único cambio al pipeline:** `parse_document` ahora limpia bytes **NUL (0x00)** — los OA
  scrapeados de PDF los traían y Postgres los rechaza en columnas text (content/title) y jsonb
  (metadata); sin esto la ingesta abortaba el lote entero. Tests del pipeline en verde.
- **Extracción:** de cada `manifest.csv` se arma la lista de rutas `qc_verdict!=reject` y se extraen
  solo esos archivos (companion: `ingest_A/documentos_mascotas` + `ingest_B/documentos`). Se corre
  `python -m app.ingestion.run --path <carpeta>` por cada árbol (driver `_ingesta_work/correr_companion.sh`).
  ⚠️ Detalle: las listas se guardan con fin de línea LF (CRLF rompe el match de rutas de `unzip`).
- Destino: **proyecto principal** (`auxlnexhkmtoedrzfsnz`), corpus GLOBAL sin `clinic_id`.
  `CORPUS_DATABASE_URL` del `.env` apunta ahí desde el 2026-07-28.
- **Compute Micro (sin resize):** para ~14k docs no se justifica el reinicio de producción. El resize
  a XL es Management-API-only (el CLI no lo hace) y el guardrail bloquea el acceso al token → si se
  quisiera, lo dispara el usuario por el dashboard (Settings→Compute).

## Verificación

- **Conteo antes:** 519.999 chunks / **61.544 documentos** (todos `embed-v4.0`).
- **Total companion:** 14.432 archivos → **12.510 únicos** por `content_hash` (1.922 duplicados entre
  las dos entregas; se cuentan una vez). Solape con el corpus de junio: ~0 (entregas delta reales).
- **Conteo después (CONFIRMADO 2026-08-22):** **74.063 documentos distintos / 640.193 chunks**
  (+12.519 docs de mascotas sobre los 61.544 previos, +20%). Coincide exacto con la proyección.
- **Costo real de Cohere:** ≈ **227 M tokens ≈ US$27** (a la tarifa histórica US$0,12/1M; rango
  US$23–34). Incluye el reproceso menor de dos interrupciones (el crash por NUL y la pausa por la
  discusión de alcance/resize); casi todo fue trabajo útil porque lo ya commiteado se salta.
- **Prueba de retrieval — PASA.** Consulta «resistencia a vemurafenib en carcinoma urotelial canino»
  → los **7 primeros chunks son del paper `PM42359562` (2026)** con scores 1,19–1,37, y el 8º es otro
  paper canino de BRAF. El corpus nuevo se usa efectivamente en el retrieval. (`verificar_ingesta.py`,
  correr desde `athos-service` con el venv para que importe `app`.)
