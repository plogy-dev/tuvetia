# `supabase/bootstrap/` — Esquema base (SOLO para el proyecto de DEV)

> Estos archivos **NO son migraciones nuestras** y **NUNCA** se aplican al proyecto principal.
> El proyecto principal (`auxlnexhkmtoedrzfsnz`) **ya tiene** el esquema base.

## Qué va aquí
El **script original** que crea las tablas **generales** del equipo (las que ya existen en el
proyecto compartido): `clinics`, `memberships`, `patients`, `allergies`, `medications`,
`transcripts`, `consultations`, `consents`, `clinical_notes`, `corpus_chunks`,
`patient_embeddings`, etc. Lo entrega Santiago/Pipe.

- **Formato:** SQL DDL plano (`.sql`).
- **Nombre sugerido:** `000_base_schema.sql`.

## Para qué sirve
Un proyecto Supabase de dev **separado** NO hereda el esquema del principal (eso solo lo haría
*Branching*). Este script **bootstrapea** las tablas base en dev para que luego
`supabase db push` aplique **encima** nuestras migraciones del RAG
(`supabase/migrations/0001_rag_corpus_glossary_trace.sql`, que hace `ALTER` sobre esas tablas).

## Cómo se usa (una sola vez, en dev)
Ver **`docs/MIGRACIONES.md` → "Setup inicial del entorno dev"**.

## Reglas
- **Solo dev.** No se PR-ea al principal. No se recrean tablas generales en el principal.
- La **fuente de verdad** del esquema base es el equipo (Santiago/Pipe). Esta copia es un
  *snapshot* para reproducir dev; si el esquema base cambia, actualízalo aquí anotando la fecha.
