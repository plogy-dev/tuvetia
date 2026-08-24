---
titulo: Consultas y Modo Fantasma
seccion: guias
orden: 40
resumen: La consulta clínica, la grabación que se transcribe y redacta sola, y las guardas que la rodean.
---

# Consultas y Modo Fantasma

`/dashboard/consultas`

## Qué es el Modo Fantasma

El veterinario **graba la consulta** mientras atiende. Tuvetia la transcribe y redacta la nota
clínica. El vet la revisa, la corrige y la aprueba.

Se llama así porque la idea es que el sistema desaparezca: nadie escribe durante la consulta.

Es **la capacidad más cara** de todas las de IA, y por eso es de plan Pro.

## El ciclo de una nota

```
  draft  ──aprobación del vet──▶  approved  ──▶  locked
```

| Estado | Qué significa |
|---|---|
| `draft` | Redactada por la IA, **sin revisar**. Aparece como "notas por revisar" en el tablero |
| `approved` | El vet la leyó y la aprobó |
| `locked` | Cerrada |

**Nada sale de una nota en borrador.** Hay un trigger, `informe_solo_de_nota_aprobada()`, que impide
generar el informe al titular si la nota no está aprobada. La IA propone; **la firma es del
veterinario**, siempre.

## El consentimiento

No se graba sin consentimiento registrado. Otro trigger lo garantiza:
`enforce_consent_before_audio()` — si no hay fila en `consents`, el audio no entra.

No es una casilla de la interfaz que se pueda saltar: está en la base.

## El audio se borra a los 4 días

`consultation_audios` se purga con el cron de las 03:00. Es una obligación de retención (**Ley
1581**), y es el motivo por el que ese cron es el más crítico de los dos: si no corre, se incumple
**en silencio**.

La transcripción y la nota se conservan; lo que se va es la grabación.

## Las tablas

| Tabla | Qué guarda |
|---|---|
| `consultations` | La consulta |
| `transcripts` | La transcripción |
| `consultation_audios` | El audio, temporal |
| `clinical_notes` | La nota, con su estado |
| `consents` | El consentimiento |
| `client_reports` | El informe al titular |

## El informe al titular

Desde una consulta con nota aprobada se genera un informe en lenguaje llano para el dueño de la
mascota. Se le manda por correo o WhatsApp, y se ve por un **enlace con token** (`/f/[token]`): el
titular no tiene cuenta.

Código en `src/lib/informe-al-titular/`.

## Las guardas clínicas

Esto es un producto médico y el agente tiene límites escritos:

1. **Nunca diagnóstico cerrado.** El sistema resalta el *lenguaje de posibilidad* —"compatible con",
   "sugestivo de", "no hay evidencia suficiente"— y el prompt lo exige.
2. **Citas obligatorias.** Las respuestas clínicas vienen con referencias a la literatura del corpus.
3. **Alérgenos resaltados.** La nota cruza el plan con las alergias registradas del paciente y las
   marca.
4. **Dose guard.** `athos-service` tiene una revisión específica de las dosis.
5. **Abstención.** El servicio está medido para decir que no sabe en vez de inventar; hay documentos
   de medición en `athos-service/docs/`.

## La consulta en vivo

`src/lib/consulta-viva/` maneja la sesión: qué se está grabando, qué se transcribió y en qué estado
está. Es lógica pura y testeable, separada de la pantalla.

`/api/athos/live` es la ruta que la alimenta.
