# Comparativa de calidad entre modelos — DeepSeek · Gemini · Claude

**Ítem 2.5 del contrato** ("pruebas comparativas de calidad entre modelos"). Corte 2026-07-30.
Instrumento: `athos-service/scripts/calidad/respuestas_ab.py`, pareado — el retrieval corre **una vez
por caso** y los dos modelos redactan sobre **la misma literatura** y con **el mismo prompt de
producción**, así que la diferencia que queda es del modelo y no del azar de la recuperación.

Banco: golden ampliado, casos clínicos reales del corpus veterinario. Los casos donde el sistema se
abstiene se descartan (no hay redacción que comparar).

---

## Resultado 1 — DeepSeek vs Gemini (28 casos, juez `claude-sonnet-5`)

El juez es **neutral**: no es ninguno de los dos competidores.

| | deepseek-v4-flash | gemini-3.6-flash |
|---|---|---|
| **gana** | **24** | 2 *(2 empates)* |
| utilidad | **8,5** | 3,7 |
| seguridad | **7,0** | 5,1 |
| fidelidad | **6,2** | 5,4 |
| "confiaría en esta respuesta" | **24/28** | 7/28 |
| citas (mediana) | 6 | 3 |

**DeepSeek gana con claridad.** El motivo se repite caso a caso en los fallos del juez: DeepSeek da
diferenciales priorizados, umbrales numéricos concretos (`Hto<15%`, `plaquetas<20.000`) y criterios de
alarma; Gemini responde más corto y genérico, y cita la mitad.

**Consecuencia práctica:** valida el orden de la cascada. Que DeepSeek atienda primero y Gemini sea la
alternativa no es una elección arbitraria — es la que mide mejor.

---

## Resultado 2 — DeepSeek vs Claude, y por qué hay que mirarlo dos veces

Acá el juez **no puede ser neutral**: `claude-sonnet-5` es a la vez el competidor B y el juez por
defecto del banco. El propio código lo advierte — *"un juez idéntico al redactor es el peor evaluador
de sí mismo"*. Así que se corrió **dos veces**, con jueces sesgados en direcciones opuestas.

| | juez `claude-sonnet-5` *(sesgado hacia B)* | juez `deepseek-v4-pro` *(sesgado hacia A)* |
|---|---|---|
| gana **Claude** | **21** | **16** |
| gana **DeepSeek** | 2 | 14 |
| casos | 24 | 30 |

> **El titular se mueve 19 casos según quién juzga.** Es la magnitud del sesgo de autopreferencia, y
> es la razón por la que este documento no reporta un ganador a partir de una sola corrida. Si sólo se
> hubiera corrido la primera, el informe habría dicho "Claude aplasta a DeepSeek 21-2" y habría sido
> un artefacto del evaluador.

### Lo que SÍ sobrevive a los dos jueces

Estas diferencias apuntan en la misma dirección con el juez sesgado a favor **y** con el sesgado en
contra, así que son las defendibles:

| Dimensión | juez Claude | juez DeepSeek | Dirección |
|---|---|---|---|
| **fidelidad** | 5,3 → **7,2** | 6,8 → **7,5** | Claude mejor en ambos |
| **seguridad** | 6,2 → **7,8** | 7,5 → **7,9** | Claude mejor en ambos |
| **"confiaría"** | 8/24 → **23/24** | 15/30 → **21/30** | Claude mejor en ambos |
| **utilidad** | 7,6 = 7,6 | **7,9** → 7,5 | empate o DeepSeek |

**Conclusión honesta:** Claude es **moderadamente** mejor en fidelidad y seguridad; DeepSeek se
sostiene igual o mejor en utilidad. La ventaja es real pero **no es aplastante** — el 21-2 lo era el
sesgo, no el modelo.

---

## Qué significa para la decisión de costos

El cliente eligió DeepSeek por precio. Esta medición **no obliga a cambiar esa decisión, y ahora se
puede defender con datos en vez de con intuición**:

- Contra **Gemini**, DeepSeek es netamente superior: no hay razón para moverse.
- Contra **Claude**, DeepSeek pierde algo de fidelidad y seguridad, y empata o gana en utilidad. La
  diferencia existe pero es de grado, no de categoría — y Claude cuesta un orden de magnitud más.

La arquitectura ya permite cambiar de opinión sin tocar código: es una variable de entorno. Y si en
algún momento se quiere lo mejor de los dos, el camino natural es **escalar a Claude sólo los casos
difíciles** en vez de moverlo todo.

## Lo que esta comparativa NO cubre

- **Latencia y costo por consulta**, que son la otra mitad de la decisión. Medidos por separado:
  DeepSeek 1,1 s, Gemini 3,9 s, Claude 3,7 s en la misma pregunta.
- **La nota del Fantasma.** Todo esto mide el **chat**. La nota tiene su propio banco
  (`phantom_eval.py`) y su propia comparativa pendiente.
- **Un tercer juez independiente.** Con dos jueces sesgados en direcciones opuestas se acota el
  resultado, pero un juez ajeno a los tres (o un panel) lo cerraría mejor.

## Cómo reproducirlo

```bash
# DeepSeek vs Gemini, juez neutral
python scripts/calidad/respuestas_ab.py \
  --a deepseek-v4-flash@openai --b gemini-3.6-flash@google --n 30

# DeepSeek vs Claude, con el juez sesgado EN CONTRA de Claude
python scripts/calidad/respuestas_ab.py \
  --a deepseek-v4-flash@openai --b claude-sonnet-5@anthropic --n 30 \
  --juez-modelo deepseek-v4-pro --juez-proveedor openai
```

> **Regla de método que vale para cualquier comparativa futura de este proyecto:** nunca reportar un
> ganador con un juez que sea uno de los competidores. Si no hay un tercero disponible, correr dos
> veces con los sesgos invertidos y reportar sólo lo que sobrevive a ambos.
