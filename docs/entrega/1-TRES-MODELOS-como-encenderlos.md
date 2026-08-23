# Encender los tres modelos — procedimiento y verificación

> **Para qué.** El Milestone 2 pide *"los tres modelos respondiendo de verdad en producción, no solo
> cableados"*. Hoy los logs muestran **sólo DeepSeek**: Claude 0 respuestas, Gemini 0.
>
> **La buena noticia: no es código.** Los tres proveedores están cableados
> (`model.ts :: PROVEEDORES`) y **no hay ninguna exclusión de Claude en el código** — se verificó
> buscándola. Es crédito y variables de entorno.

---

## Lo que dicen los datos, para saber qué se arregla

| cuándo | qué pasó |
|---|---|
| **2026-08-02 15:13** | `claude-sonnet-5` era el primario, **falló**, respondió DeepSeek |
| **2026-08-02 17:05** | ídem — segundo fallo |
| **desde entonces** | **cero fallbacks registrados** → Claude dejó de ser primario |

Gemini **nunca aparece** en ninguno de los dos logs, así que probablemente nunca estuvo en la cadena
efectiva o le falta la credencial.

---

## Paso 1 · Crédito (es lo que tarda, hacerlo primero)

- **Anthropic** — cargar crédito de producción. Es la causa raíz: las dos veces que se intentó, falló.
- **Google Gemini** — verificar que `GEMINI_API_KEY` exista y tenga cuota.

## Paso 2 · Las tres cadenas, en Vercel

Los valores exactos, tal como los documenta `model.ts:144-146`. Formato `modelo@proveedor`, en orden
de preferencia:

```
ATHOS_AGENT_CASCADE  = deepseek-v4-flash@deepseek,gemini-3.6-flash@google,claude-sonnet-5@anthropic
ATHOS_AUTO_CASCADE   = deepseek-v4-flash@deepseek,gemini-3.6-flash@google,claude-haiku-4-5@anthropic
ATHOS_VISION_CASCADE = claude-haiku-4-5@anthropic,gemini-3.6-flash@google
```

Y las credenciales que cada uno necesita: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`.

> **El orden importa para la demo.** Con DeepSeek primero, Claude y Gemini **sólo responden si
> DeepSeek falla** — y entonces seguirían sin aparecer en el log. Ver el paso 4.

## Paso 3 · Redesplegar

Sin esto no toma efecto. Vercel → Deployments → el último → ⋯ → **Redeploy**.

---

## Paso 4 · Demostrar que los tres responden

Éste es el punto: **el checklist no pide que estén configurados, pide que el log muestre respuestas
reales de los tres.**

### La forma honesta y rápida

Con la cascada de arriba, DeepSeek responde siempre y los otros dos nunca aparecen. Para que cada uno
responda de verdad hay que **ponerlo de primero**, hacer una consulta, y mirar el log.

Tres rondas, cambiando una variable y redesplegando entre cada una:

| ronda | `ATHOS_AGENT_CASCADE` | qué debe quedar en el log |
|---|---|---|
| 1 | `claude-sonnet-5@anthropic,deepseek-v4-flash@deepseek` | `anthropic / claude-sonnet-5` |
| 2 | `gemini-3.6-flash@google,deepseek-v4-flash@deepseek` | `google / gemini-3.6-flash` |
| 3 | la cadena definitiva de arriba | `deepseek / deepseek-v4-flash` |

En cada ronda: abrir `/dashboard/asistente` y hacer **una** pregunta clínica.

### Demostrar el fallback en vivo

El checklist también pide *"forzando un fallback en vivo"*. La forma limpia, sin romper nada: poner
de primero un modelo **que no existe** en un proveedor que sí:

```
ATHOS_AGENT_CASCADE = modelo-que-no-existe@anthropic,deepseek-v4-flash@deepseek
```

El primario falla, responde DeepSeek, y queda registrado en `fell_back_from`. Es exactamente lo que
pasó el 2 de agosto, pero provocado a propósito.

---

## La verificación, en una consulta

```sql
select
  provider,
  model,
  count(*)                                           as respuestas,
  count(*) filter (where fell_back_from is not null) as fueron_respaldo,
  max(created_at at time zone 'America/Bogota')      as ultima
from athos_agent_usage
where created_at > now() - interval '1 day'
group by provider, model
order by ultima desc;
```

**Está demostrado cuando esa consulta devuelve tres filas**: una `anthropic`, una `google` y una
`deepseek`. Hoy devuelve sólo la última.

Para el chat clínico —que corre en `athos-service` y tiene su propia cascada— la consulta equivalente
es sobre `rag_answer_log`, agrupando por `model`.

---

## ⚠️ Lo que NO sirve como prueba

**`/api/health` responde `cascada_con_credenciales: true` aunque no haya ninguna cascada
configurada.** Con el conjunto vacío, `[].every()` da `true` — está documentado como deliberado en el
endpoint, pero significa que ese verde **no prueba nada** sobre los tres modelos.

La única prueba es el log de respuestas.
