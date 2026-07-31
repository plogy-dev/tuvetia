# La abstención de Athos: cómo se mide y cuánto acierta

**Corte:** 2026-07-30 · **Banco:** 188 casos (146 con literatura + 42 sin ella) · **Contra:** el
corpus de producción (520.000 chunks)

Este documento existe para que **nadie tenga que creernos**. Todo lo que dice se puede volver a
correr con un comando, y la verdad contra la que se mide no es una opinión nuestra ni de un modelo.

---

## El resultado, primero

| | seguridad | utilidad |
|---|---|---|
| Antes (cortes 4/7, sólo el juez) | 82,4 % | 63,3 % |
| **Ahora (cortes 2/6 + corroboración determinística)** | **92,6 %** | **65,5 %** |
| Sobre la mitad del banco **que no se usó para elegir la regla** | **94,5 %** | 67,1 % |

Mejora en **las dos** métricas. No es un intercambio de una cosa por otra.

**Qué significa cada una:**

- **Seguridad** — el porcentaje de consultas donde Athos **no comete un fallo grave**. Son dos, y
  los dos hacen daño: responder con confianza cuando la literatura no cubre el caso, y callarse
  cuando sí la hay.
- **Utilidad** — de las consultas que **sí** tienen literatura, cuántas se responden sin la
  advertencia de evidencia limitada.

**Por qué se reportan las dos.** Una regla que respondiera siempre *"evidencia limitada"* nunca
cometería un fallo grave: sacaría una seguridad altísima y sería inservible. La utilidad es lo que
impide esconderse detrás de la cautela. Cuando calibramos esto, la primera versión de la métrica
tenía justamente ese agujero y daba 96,8 % — un número inflado que descartamos.

---

## Por qué hubo que cambiar el instrumento de medición

El banco etiquetaba cada caso según **si el corpus contiene el descriptor**. Pero la abstención
decide otra cosa: **si los pasajes que el buscador trajo cubren la consulta**. Son preguntas
distintas, y medir la segunda con la primera castigaba al sistema por acertar:

> `neg-hepatitis-viral-animal` estaba marcado como caso **sin** literatura. El buscador trajo
> hepatitis infecciosa canina por adenovirus — que **es** hepatitis viral animal. El juez puntuó 9.
> Tenía razón; la etiqueta estaba mal.

> `bone-neoplasms` estaba marcado como caso **con** literatura. El buscador trajo displasia de codo.
> El juez puntuó 2. Tenía razón otra vez.

No eran dos casos sueltos: **las etiquetas del banco sólo coinciden con la realidad en ~74 %**. Todo
número anterior medía en parte el etiquetado, no la abstención.

## La verdad contra la que se mide ahora

Para cada caso se pregunta un **hecho comprobable**, sin opinión de ningún modelo:

> ¿Alguno de los pasajes recuperados está indexado con el descriptor MeSH de la consulta, o con uno
> que cuelgue de él en el árbol MeSH?

Los descriptores vienen con el corpus (`metadata->mesh`); no los pone una IA ni los ponemos nosotros.
El árbol MeSH es un estándar publicado: cualquiera puede verificar que `C14.280.484.048.750`
(*Mitral Valve Insufficiency*) cuelga de `C14.280.484` (*Heart Valve Diseases*).

Se llegó a esa definición **corrigiendo dos errores propios**, y los dos quedan documentados porque
son la parte más frágil del trabajo:

1. **La primera versión exigía coincidencia exacta** e ignoraba la jerarquía. Marcaba como "no
   cubierto" casos donde el buscador había traído exactamente la enfermedad, pero indexada con el
   descriptor hijo. Lo delató la lista de discrepancias: `heart-valve-diseases`,
   `cardiomyopathy-dilated`, `liver-diseases`, `renal-insufficiency-chronic`.
2. **La segunda versión aceptaba la mención literal en el texto** para cubrir los huecos del
   etiquetado MeSH — pero eso hacía pasar descriptores genéricos: la palabra *"recurrence"* o
   *"syndrome"* aparece en cualquier texto clínico y no prueba cobertura de nada. Se restringió a
   los descriptores que nombran una **condición concreta** (994 de 6.145). Se descartaron así 12
   coberturas falsas.

### El límite, dicho sin adornos

El etiquetado MeSH del corpus es **incompleto**: un documento puede tratar la condición sin llevar el
descriptor. Por eso *"no cubierto"* significa exactamente **"ningún documento recuperado está
indexado con ese descriptor ni nombra la condición"** — ni más ni menos. Es una vara **conservadora**:
tiende a subestimar la cobertura y, por lo tanto, **a subestimar el acierto de Athos**, no al revés.

Los casos donde el sistema y esta verdad discrepan **se listan uno por uno** al final de cada
corrida, para revisarlos a mano.

---

## Qué cambió en el sistema

El juez solo —un modelo que lee los pasajes y puntúa de 0 a 10— llegaba a 82,4 %. Se le agregó una
**corroboración determinística** que no cuesta ni una llamada de IA:

> ¿Alguno de los descriptores a los que destiló la consulta está indexado en la literatura recuperada?

Con eso se corrigen los dos errores del juez, en las dos direcciones:

| | Qué pasa | Por qué |
|---|---|---|
| **Freno** | Dice "suficiente" pero **ningún** documento recuperado está indexado con la condición → baja a *evidencia limitada* | En un corpus de 520k chunks siempre hay algo que **suena** parecido. El modelo premia plausibilidad temática. |
| **Rescate** | Dice "abstenerse" pero **sí** hay un documento indexado con la condición → sube a *evidencia limitada* | Callarse del todo teniendo literatura del tema es el error más caro: el veterinario deja de usar la herramienta. |

Ni el freno ni el rescate son opinables: son una intersección de conjuntos sobre metadatos del
corpus. Están cubiertos por 16 pruebas automáticas.

Si el juez está en su certeza máxima (10) **no se le contradice** — ese tope se calibró junto con los
cortes.

---

## Cómo verificarlo usted mismo

```bash
cd athos-service

# 1. La verdad mecánica sobre el banco completo (no gasta IA, sólo búsqueda)
python scripts/calidad/abstencion_verdad.py --n 0 --sin-juez

# 2. La medición completa, juez incluido
python scripts/calidad/abstencion_verdad.py --n 0
```

La salida incluye, para cada caso, **por qué** se lo consideró cubierto o no
(`VERDAD_porque`: *"descriptor exacto"*, *"X (C14.280.484.048.750) cuelga de C14.280.484"*, …) y la
lista completa de discrepancias. El detalle por caso queda en
`scripts/calidad/abstencion_verdad_final.json`.

**La regla se eligió usando sólo la mitad del banco** — partición por hash del identificador, así que
es reproducible y no la elegimos a dedo — y se reporta el resultado sobre la mitad restante. Que la
mitad no vista dé **mejor** (94,5 %) que la de ajuste (90,7 %) es lo que descarta que la regla esté
amoldada a los datos.

---

## Por qué no es 100 %, y qué costaría subirlo

Quedan **14 fallos** de 188, muy desbalanceados hacia el lado menos malo:

| Tipo de fallo | Cuántos | Cuáles |
|---|---|---|
| **Responde con confianza** sin que la vara vea cobertura | 12 | `ancylostomiasis`, `disease-progression`, `mycoplasma-infections`, `neg-edema`, `neg-neck-injuries`, `prostatic-neoplasms`, `recurrence`, `syndrome`, … |
| **Se calla** teniendo literatura | **2** | `adenocarcinoma`, `sepsis` |

Las abstenciones indebidas bajaron a **2 de 188 (1,1 %)**, que era el error que más molesta al
veterinario: un Athos que dice "no sé" de más deja de usarse, y entonces no protege a nadie.

Cómo queda repartido lo que ve el veterinario, sobre los 188 casos:

| Banda | Casos | Qué ve |
|---|---|---|
| Respuesta normal | 103 | la respuesta citada, sin advertencia |
| Evidencia limitada | 82 | la respuesta **más** el aviso de que la literatura sólo roza el caso |
| Abstención | 3 | "no hay evidencia suficiente" |

Vale la pena contrastarlo con el punto de partida que reportó el cliente: **0 activaciones en 187
casos**. Hoy la abstención se activa, y en la gran mayoría de los casos dudosos lo hace por la vía
suave —declarar la limitación— en vez de negarse a responder.

De los 12 "responde de más", una parte no son fallos reales sino huecos del etiquetado MeSH del
corpus (la vara es conservadora, como se explicó arriba). Separar unos de otros **no se puede hacer
mecánicamente**: hace falta que un veterinario mire los pasajes y dictamine.

**Lo que subiría el número, en orden de rendimiento:**

1. **Validación clínica de las discrepancias** (~2 h de un veterinario sobre 14 casos). Convierte la
   vara conservadora en una verdad clínica y dice cuánto del 7,4 % restante es error real.
2. **Completar el etiquetado MeSH** de los documentos que tratan una condición sin llevar su
   descriptor. Es trabajo sobre el corpus, no sobre el juez.
3. **Ampliar el banco.** Con 188 casos, un caso vale 0,5 puntos porcentuales; la diferencia entre
   92,6 % y 94,5 % son **tres casos**. Reportar más precisión que ésa sería falsa exactitud.

Y una honestidad de fondo que no cambia con el esfuerzo: **"¿esta literatura cubre este caso?" admite
grados**. Dos veterinarios expertos discrepan en los casos de borde, que son justamente donde el
sistema falla. El 100 % no es una meta alcanzable en un juicio semántico; lo alcanzable es que el
sistema **se equivoque siempre hacia el lado seguro** y que el error quede **declarado en pantalla**,
que es lo que hace hoy.
