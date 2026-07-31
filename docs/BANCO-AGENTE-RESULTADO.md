# Banco de calidad del agente — resultado

**Modelo:** `claude-sonnet-5` · **Casos:** 16 · **Corte:** 2026-07-31

Generado por `e2e/banco-agente.e2e.ts`. Todas las métricas son determinísticas —contar
preguntas, medir longitud, detectar marcadores—: no interviene ningún juez LLM.

> El banco declara **tools de mentira con datos fijos** (agenda, horarios, titular, evidencia).
> ("¿qué tengo mañana?") salen cortas o vacías: en producción el modelo llamaría a una tool y
> Los datos son fijos a propósito: se mide la FORMA de la respuesta, no si el dato es correcto.

> ⚠️ **Una corrida no es una medición.** Se hicieron 3 y los números se mueven: "desarrolla de más"
> con input pobre dio 1/6, 1/6 y 0/6; el modelo no es determinista. Lo que sí es estable y es lo que
> vale citar es la **separación**: con input pobre la respuesta ronda los 150 chars y con anamnesis
> completa supera los 900 — una diferencia de 6-7×, consistente en las tres corridas.

## P1 · Input POBRE — debe preguntar, no desarrollar

| chars | preguntas | ¿desarrolla? | ¿narra proceso? | duplicadas | caso |
|---|---|---|---|---|---|
| 151 | 3 | no | no | 0 | un perro que vomita |
| 138 | 2 | no | no | 0 | tengo un gato que no come |
| 206 | 3 | no | no | 0 | vino un perro cojeando |
| 152 | 3 | no | no | 0 | una gata con diarrea |
| 172 | 1 | no | no | 0 | perro decaído |
| 117 | 2 | no | no | 0 | me llegó un conejo raro |

- **pregunta:** 6/6
- **desarrolla de más:** 0/6
- **longitud mediana:** 152 chars

## P1 · Input RICO — acá sí debe desarrollar

| chars | preguntas | ¿desarrolla? | ¿narra proceso? | duplicadas | caso |
|---|---|---|---|---|---|
| 1304 | 1 | sí | no | 0 | Perro macho castrado de 6 años, 22 kg, vomita  |
| 919 | 1 | sí | no | 0 | Gata hembra de 12 años, 3.8 kg, poliuria y pol |
| 1096 | 1 | sí | no | 0 | Perro de 4 años, 15 kg, prurito intenso hace u |
| 713 | 1 | no | no | 0 | Cachorro de 3 meses, 4 kg, diarrea sanguinolen |

- **desarrolla:** 3/4
- **longitud mediana:** 1096 chars

## P1 · Operativo — no debe pedir datos clínicos

| chars | preguntas | ¿desarrolla? | ¿narra proceso? | duplicadas | caso |
|---|---|---|---|---|---|
| 84 | 0 | no | no | 0 | ¿qué tengo mañana? |
| 143 | 1 | no | no | 0 | muéstrame la agenda de hoy |
| 93 | 0 | no | no | 0 | ¿cuáles son los horarios de la clínica? |
| 27 | 0 | no | no | 0 | búscame el titular con teléfono 3001234567 |

- **pide datos clínicos indebidamente:** 0/4

## P5 · Literatura tangencial — debe descartar en una frase

| chars | preguntas | ¿desarrolla? | ¿narra proceso? | duplicadas | caso |
|---|---|---|---|---|---|
| 298 | 3 | no | no | 0 | ¿Qué dice la evidencia sobre osificación heter |
| 99 | 0 | no | no | 0 | ¿Hay evidencia sobre el manejo de gangliogliom |

- **longitud mediana:** 298 chars

## Resumen sobre 16 respuestas

- **P2 · narra su proceso interno:** 0/16
- **P3 · repite una pregunta:** 0/16

---

## Anexo — respuestas completas

### una gata con diarrea

```
¿Hace cuánto empezó y con qué frecuencia? ¿Alguna edad aproximada y si sigue comiendo/bebiendo normal? ¿Es diarrea con sangre o moco, o vómito asociado?
```

### perro decaído

```
¿Hace cuánto lo notás decaído y de qué edad es el perro? También me sirve saber si sigue comiendo/tomando agua normal y si tiene algún otro signo (vómito, diarrea, fiebre).
```

### tengo un gato que no come

```
¿Hace cuánto no come y qué edad tiene? ¿Está haciendo algún otro signo (vómito, letargo, decaimiento) o sigue tomando agua con normalidad?
```

### me llegó un conejo raro

```
¿Qué tiene de raro? Contame: ¿qué signos está mostrando y desde cuándo, y sigue comiendo/tomando agua con normalidad?
```

### vino un perro cojeando

```
¿Hace cuánto empezó la cojera y de qué pata es? ¿Hubo algún trauma o salto reciente que lo relacione, o el dueño no identifica causa? Y ¿carga algo de peso en la pata o la mantiene completamente en el aire?
```

### un perro que vomita

```
¿Hace cuánto empezó y con qué frecuencia? ¿Sigue comiendo y bebiendo agua, o hay otros signos (diarrea, decaimiento, dolor abdominal)? ¿Qué edad tiene?
```

### Cachorro de 3 meses, 4 kg, diarrea sanguinolen

```
La literatura disponible no cubre este cuadro en particular, así que me guío por manejo clínico estándar.

Prioridad inmediata: este paciente es de **riesgo alto** por edad, peso bajo (4 kg) y deshidratación probable por vómito + diarrea de 2 días. Antes de cualquier otra cosa:

- **Aislamiento** (altísimo contagio, no debe pasar por sala común).
- Test rápido de antígeno parvo (SNAP o similar) para confirmar.
- Evaluar grado de deshidratación y estado hemodinámico ya mismo — si hay signos de shock, fluidoterapia IV es lo primero, antes de esperar resultado de test.

¿Ya le hiciste el test de parvo o lo tenés programado, y cómo está el paciente ahora mismo de hidratación/perfusión (mucosas, TLLC, pulso)?
```

### Perro de 4 años, 15 kg, prurito intenso hace u

```
La literatura disponible no cubre este cuadro en particular, así que me apoyo en lo que ya tenés clínicamente.

Un mes de prurito intenso con lesiones en pliegues que no responde a corticoides es un patrón que apunta a algo más allá de una simple alergia estacional. Vale la pena descartar en orden:

- **Malassezia/piodermia secundaria** en los pliegues — muy común como causa de que el corticoide "no funcione" (la infección secundaria sigue activa). Un citológico rápido (cinta acetato) te lo confirma en el consultorio.
- **Demodicosis** — si no se hizo raspado profundo antes de iniciar corticoide, vale repetirlo; el corticoide puede haber enmascarado o agravado un Demodex subclínico.
- **Dermatitis alérgica (atópica o alimentaria)** de base, con los pliegues como zona típica — pero antes de etiquetarla hay que limpiar la infección secundaria, porque mientras haya Malassezia o bacterias activas, ningún antiinflamatorio va a rendir bien.

¿Ya tenés citología o raspado hechos, o el corticoide se dio empíricamente sin diagnóstico previo? Con eso te ayudo a priorizar el siguiente paso.
```

### Gata hembra de 12 años, 3.8 kg, poliuria y pol

```
Cuadro clásico de gata geriátrica con PU/PD subaguda, pérdida de peso y deshidratación — los diferenciales principales a descartar son **enfermedad renal crónica, diabetes mellitus e hipertiroidismo**, y en menor medida enfermedad hepática o piometra si no está esterilizada (vale confirmar estado reproductivo).

La literatura disponible no cubre este cuadro en particular, así que esto va con base en tu criterio clínico y guías estándar.

Para diferenciar necesitás mínimo:
- Hemograma + bioquímica completa (urea, creatinina, ALT, glucosa)
- Urianálisis con densidad urinaria (clave para distinguir renal vs. prerrenal vs. diabetes)
- T4 total (hipertiroidismo es muy prevalente en gatas de esta edad)

Con 5% de deshidratación conviene arrancar fluidoterapia de corrección mientras salen los resultados. ¿Ya tenés algo de esos paraclínicos o querés que te ayude a armar la orden/ficha con lo que lleva hasta ahora?
```

### Perro macho castrado de 6 años, 22 kg, vomita 

```
Cuadro de **abdomen agudo** — vomita hace 3 días, anorexia, mucosas pálidas y abdomen tenso al 6 años, 22 kg. La combinación de mucosas pálidas + abdomen tenso es lo que manda la conducta: sugiere compromiso hemodinámico (shock, hemoabdomen, peritonitis séptica) más que un cuadro digestivo simple, así que antes de pensar en diferenciales priorizaría estabilización:

- **TRC, frecuencia cardíaca, pulso y temperatura** — para confirmar si ya está en shock compensado/descompensado.
- Acceso IV y considerar bolo de cristaloides si hay signos de shock.
- **PCV/proteínas totales y lactato** en el momento — te dan si es anemia real (hemoabdomen) vs hemoconcentración, y severidad de la hipoperfusión.
- Imagen abdominal (rx y/o eco) para buscar cuerpo extraño, líquido libre, masa esplénica/torsión, neumoperitoneo.

Diferenciales a priorizar según esos hallazgos: obstrucción por cuerpo extraño, peritonitis séptica (perforación), hemoabdomen (masa esplénica/torsión, coagulopatía), pancreatitis grave. No encontré literatura específica sobre este cuadro puntual en la base disponible, así que esto va sobre criterio clínico, no cito fuente.

¿Cómo está el TRC y la frecuencia cardíaca en este momento? Con eso te ayudo a acotar si es candidato a cirugía de urgencia o si alcanza a estabilizar primero.
```

### búscame el titular con teléfono 3001234567

```
Ana Gómez, titular de Lola.
```

### ¿qué tengo mañana?

```
Mañana tenés dos citas:

- **9:00** — Rocco, control
- **11:30** — Michi, vacunación
```

### ¿cuáles son los horarios de la clínica?

```
Lunes a viernes de 8:00 a.m. a 6:00 p.m., y sábados de 9:00 a.m. a 1:00 p.m. Domingo cerrado.
```

### muéstrame la agenda de hoy

```
Hoy tenés dos citas:

- **9:00** — Rocco, control
- **11:30** — Michi, vacunación

Tranquilo el día. ¿Necesitás algo más sobre alguna de estas?
```

### ¿Qué dice la evidencia sobre osificación heter

```
La literatura disponible no cubre este cuadro en particular.

Para orientar mejor el caso, necesito más contexto: ¿qué edad tiene el perro y hace cuánto notás el hallazgo (crónico o reciente)? ¿Hubo trauma previo en esa pata o cirugía reciente? ¿Está cojeando o es un hallazgo incidental en imagen?
```

### ¿Hay evidencia sobre el manejo de gangliogliom

```
No hay evidencia suficiente en la literatura disponible para el manejo de ganglioglioma en caninos.
```

