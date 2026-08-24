---
titulo: El tablero
seccion: guias
orden: 10
resumen: La pantalla de entrada. Cada persona arma la suya, y el admin define con cuál entra la clínica.
---

# El tablero

`/dashboard/tablero` — la pantalla con la que se entra.

## Qué muestra

Dos capas:

1. **La tira de cifras** de arriba: consultas del mes, pacientes, citas de los próximos 7 días,
   notas en borrador, y más.
2. **Los bloques**: listas y gráficos debajo.

## Cada quien arma el suyo

Tanto los bloques como las cifras se eligen. El botón **Personalizar** abre el panel donde se
prenden, apagan y reordenan arrastrando.

- Los bloques se guardan en `tablero_preferencias.widgets`.
- Las cifras, en `tablero_preferencias.metricas` — **la misma fila**, porque son la misma
  preferencia, de la misma persona, para la misma pantalla.

### Las cifras disponibles

Hay once en el catálogo (`src/lib/tablero/metricas.ts`), de las cuales unas pocas vienen encendidas
de fábrica:

`consultas-mes` · `pacientes` · `citas-7d` · `notas-borrador` · `consultas-hoy` · `citas-hoy` ·
`titulares` · `pacientes-nuevos-mes` · `vacunas-por-vencer` · `facturado-mes` · `por-cobrar`

Las dos últimas **sólo se ofrecen si la clínica factura desde Tuvetia**: a una que no activó el
módulo serían ceros permanentes.

### Restablecer

El botón devuelve tanto los bloques como las cifras al estado de fábrica. Restablecer sólo los
bloques dejaría la tira con las cifras de antes, que no es lo que promete el botón.

## Las pastillas se abren

Cada cifra es un botón: al tocarla se abre una **vista rápida** con la lista detrás del número, sin
sacarte de la pantalla. Cada fila lleva a su ficha.

> **El acuerdo que sostiene esto:** la cifra la cuenta la página y la lista la trae
> `/api/tablero/detalle`. Son dos archivos distintos, y nada obliga a que sigan de acuerdo — salvo un
> test que lee los dos y compara los filtros. Una tarjeta que dice 9 y una vista que muestra 11 es
> peor que no tener la vista: una cifra que se contradice a sí misma al tocarla deja de ser creíble
> entera.

La misma mecánica está en la pantalla de **Pacientes**, que tiene su propia fila de cifras.

## El tablero con el que entra la clínica

Un **administrador** puede guardar una disposición como punto de partida de la clínica
(`tablero_default_clinica`).

Cómo se combinan las dos:

- Quien **todavía no armó el suyo** entra con el de la clínica.
- En cuanto alguien acomoda el propio, **el suyo manda**, siempre.
- **No se mezclan.** Si la persona tiene su fila, el default de la clínica no le toca nada: mezclarlos
  haría que un bloque se moviera solo un día cualquiera, y eso se lee como un error, no como una
  novedad.

Esto salió de dos frases contradictorias dichas en la misma llamada —*"¿qué tal si el administrador
es el único que lo puede modificar?"* y *"mi cuenta y mi dashboard es mío"*— y las dos tenían razón
sobre algo distinto: el admin quiere poder poner algo delante de todos, y cada quien quiere su vista.

**La RLS es asimétrica a propósito:** todos los de la clínica pueden **leer** esa fila —si no, no
podría ser el punto de partida de nadie— y sólo un `admin` puede **escribirla**.

## El riel de bienvenida

Mientras la clínica está a medio configurar, aparece un riel con lo que falta (conectar WhatsApp,
cargar horarios, etc.). Se retira solo al 100 %.

Hay un acceso permanente a ese riel desde la barra lateral, en cualquier pantalla: el vet pasa el día
en la agenda o en una consulta, y si la única señal estuviera en una pantalla que no visita,
"llenar la plataforma progresivamente" no pasaría nunca.
