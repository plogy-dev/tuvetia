# El repo de Luciano, leído

Revisión de `landing-tuvetia-main.zip` (17-ago, 22,6 MB, 447 archivos de fuente) con una regla
encima de todo, dicha por Felipe al pasarlo:

> *"es toda la app y la landing, no te confundas, nuestro Tuvet es más avanzado pero necesitamos el
> UI de ellos, sólo que verde en vez de azul."*

**Se toma la composición. No se toma la funcionalidad.**

---

## 1. Lo primero, porque cambia el tamaño del trabajo: el sistema de tokens es EL MISMO

No es un proyecto ajeno del que haya que traducir nada. Los dos repos declaran los mismos nombres de
token y usan el mismo truco de alcance:

| | Ellos | Nosotros |
|---|---|---|
| Base | `--ink`, `--ink-2`, `--surface`, `--surface-2`, `--border`, `--border-soft`, `--muted`, `--text`, `--text-2` | los mismos |
| Marca | `--accent`, `--accent-bright`, `--brand-deep`, `--on-brand` | los mismos |
| Semánticos | `--danger`, `--ok`, `--warn`, `--info`, `--type-consulta`, `--type-control`, `--type-vacunacion`… | los mismos |
| Alcance de la app | `.app-theme` cambia `--accent` para que la landing conserve el brasa | `.app-theme` / `.app-theme-tokens`, idéntico |

**El "verde en vez de azul" es literalmente una línea.** En su repo:

```css
.app-theme { --accent: #0f3557; }   /* azul profundo */
```

Ahí va nuestro menta. Todo lo demás —`bg-brand`, `hover:bg-brand-deep`, `text-on-brand`— hereda solo,
en los dos repos, porque el mecanismo es el mismo.

> **Consecuencia práctica:** el rediseño no es una traducción de sistemas de diseño. Es un trabajo de
> **densidad y composición**, que es exactamente de lo que se quejó Luciano: *"yo no veo los colores,
> no me quejo de nada"*.

---

## 2. La diferencia real, medida

Su interfaz es **notablemente más densa**. No es una impresión: son números.

| Elemento | Ellos | Nosotros |
|---|---|---|
| `--radius` declarado | **10px** | 12px |
| Radio que se renderiza | 7px (botones), 8px (avatar), 14px (burbuja) | **18px** (`rounded-xl`, en 75 archivos) |
| Texto del chat | **13,5px** | 15px / `leading-7` |
| Avatar del chat | **26px**, `rounded-[8px]` | 32px, `rounded-full` |
| Alto del ítem de nav | **33px**, radio 7px, texto 13,5px | ~32px, `rounded-md`, 14px |
| Ancho del sidebar | **232px** | ~256px |
| Columna de lectura del chat | **780px** | (recién corregida) |
| Botón chico | **h-30px**, radio 7px, 12,5px | h-8/h-9, `rounded-md` |
| Escala de tipo del notch | 9 / 9,5 / 10 / 10,5 / 11 / 11,5 / 12,5 / 13 / 13,5 / 14,5 px | mucho más plana |

**El hallazgo que ya teníamos medido queda confirmado por su lado:** nuestras superficies son ~80%
más redondas de lo que el sistema declara (18px contra 10px suyos), y nuestro texto es ~11% más
grande en las superficies densas. Sumado, eso es el "efecto ladrillo".

---

## 3. Dos cosas de arquitectura que ellos resolvieron mejor

No son UI, así que **no las toco sin que se decida** — pero callarlas sería peor.

### 3.1 Su notch sobrevive a una recarga; el nuestro no

Su `ConsultationBar` es un **server component** que rehidrata de la base:
`getActiveConsultation`, `listTranscriptSegments`, `listVetNotes`, `listActiveSuggestions`,
`getClinicalNote`.

El nuestro vive en un módulo de JavaScript (`consulta-viva/sesion.ts`), que muere con el documento.
El bug que Luciano demostró en vivo lo arreglamos quitando la recarga (PR #122), pero su diseño hace
que la recarga **no importe**.

> Es un cambio de fondo, no cosmético: exige persistir la sesión de grabación en la base. Vale la
> pena, y no cabe antes del 24.

### 3.2 Ya tienen pausa y sugerencias en vivo, persistidas

`Notch.tsx`, `SuggestionsPanel.tsx`, `NotebookPanel.tsx`, `EditableVetNotes.tsx`, y una consulta con
estado *activa/pausada* en la base. O sea que el punto 3 de la reunión, para ellos, **ya existe** —
lo que explica que Luciano lo pidiera con tanto detalle: lo estaba describiendo, no imaginando.

Nuestra versión (PR #125) llega al mismo resultado con el estado en memoria y el disparo por
contenido. La suya es más robusta; la nuestra es más barata de operar.

---

## 4. Lo que NO hay que copiar

- **Toda la capa de datos y de negocio.** Nuestro RAG, la capa agéntica, el juez de evidencia, el
  guard de dosis, la traza y la facturación DIAN tienen 1097 tests JS + 281 Python detrás.
- **La paleta.** Su app es azul; la nuestra es menta, y su contraste ya está corregido a AA.
- **Las 33 rutas extra.** Su repo tiene 66 pantallas (inventario, compras, proveedores, finanzas,
  admin de marketing, archivos y contactos por paciente). Es más superficie, no mejor producto, y
  nada de eso salió en la reunión.

---

## 5. Lo que sí, y en qué orden

Sigue el orden que se acordó — Athos, Modo Fantasma, Pacientes — ahora con números concretos:

1. ~~**Bajar el radio.**~~ **DECIDIDO EN CONTRA el 22-ago — no se hace.** Ver §5.1 abajo.
2. ✅ **Bajar la densidad del chat de Athos** — #131 (pantalla completa) y #162 (el hilo del widget,
   que se había quedado atrás con burbujas de 16px y la respuesta dentro de un recuadro).
3. ✅ **Apretar el sidebar** — #163: 232px, ítems de 33px, texto 13,5px, radio 7px.
4. ✅ **La escala de tipo del notch** — #164. El defecto no era falta de letra chica: dos de los
   cuatro rótulos del panel estaban a 14px, el mismo tamaño que el texto que encabezaban.

✅ Y la que salía gratis: **`prefetch` en los enlaces del nav**, en el mismo #163.

También se depuró **Pacientes** (#161), que no estaba en esta lista: la tabla a 13px, `rounded-lg`,
`px-[14px]` y avatar de 32px, medido contra su `PatientTable.tsx`. La **segmentación** sigue sin
tocarse — ver §6.

### 5.1 Por qué el radio se decidió EN CONTRA

Este punto era el primero de la lista y el que "más cambia la percepción". No se hace, y conviene
que quede escrito para que nadie lo reabra sin el contexto.

**Este documento recomienda volver exactamente a lo que el cliente ya rechazó.** El 12-ago, en
revisión, David dijo que la app se veía *"demasiado cuadrada, ladrilluda, muy rígida — muy
AI-based"* y pidió bordes **más redondos**. El radio se subió por eso, el 15-ago, en el commit
`619bfba` — tres días ANTES de que se escribiera este documento. El porqué quedó anotado en
`globals.css` junto al token.

Y hay una trampa de vocabulario: los dos textos dicen "ladrillo" para cosas opuestas. David lo usó
para la versión **cuadrada** (la que seguía el mockup al pie); §2 de este documento lo usa para la
nuestra **redonda**. Leer §2 sin saber eso lleva derecho a deshacer el pedido del cliente.

**Y la señal más reciente es positiva.** En las reuniones del 19 y del 21-ago nadie mencionó la
forma; Luciano dijo *"las pastillitas quedan bien, qué elegancia"* y *"está quedando muy chingón"*.
Este documento es del 17: anterior a las dos.

Lo que sigue valiendo de §2 es todo lo demás — densidad, escala de tipo, anchos —, y eso ya se
aplicó. El radio es la excepción, y la excepción tiene dueño: lo decide David mirando la pantalla,
no la comparación con el repo.

---

## 6. Lo que queda por decidir

- **La segmentación de pacientes** (especie → tamaño → raza) sigue sin cerrarse: Luciano la propuso,
  Jesús objetó que son muchos botones para llegar a un paciente, y Luciano lo concedió. Hasta que se
  cierre, no conviene tocar Pacientes.
- **Si se adopta la persistencia del notch** (3.1). Es la diferencia entre un arreglo y una solución.
