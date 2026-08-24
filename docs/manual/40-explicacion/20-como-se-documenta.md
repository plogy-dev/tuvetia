---
titulo: Cómo funciona esta documentación
seccion: explicacion
orden: 20
resumen: De dónde sale cada página, cómo agregar un documento, y por qué el histórico está separado.
---

# Cómo funciona esta documentación

## Dónde vive, y por qué ahí

Bajo **`/admin/docs`**, el panel de plataforma, detrás de la allowlist `PLATFORM_ADMIN_EMAILS`.
Quien no está en ella recibe un 404: el panel entero es invisible.

No está bajo `/dashboard` a propósito. Esa es el área de los **clientes** —cualquier veterinario
de cualquier clínica con sesión entra— y esto describe la arquitectura, los servicios y los
nombres de los secretos del producto. Es documentación interna, y su lugar es el panel interno.

## No es un CMS

**Cada página de este sitio es un archivo `.md` del repositorio.** Se edita donde vive, con git, y
acá se lee. No hay base de datos, no hay panel de edición y no hay una segunda copia que pueda quedar
vieja.

Por eso cada documento muestra **su ruta** debajo del título: quien encuentre algo mal sabe exactamente
qué archivo abrir.

## Cómo se arma

```
  archivos .md del repo
          │
          ▼
  lib/docs/catalogo.ts     ← lee el disco (server-only)
          │
          ▼
  lib/docs/documento.ts    ← la REGLA: título, sección, orden, slug, búsqueda (pura, con tests)
          │
          ▼
  /admin/docs          ← el visor
```

La separación es la convención del repositorio: **la lógica que se puede probar vive en un `.ts`
puro**. `documento.ts` no toca el disco y tiene 28 tests; `catalogo.ts` sólo lee archivos.

## Qué se indexa

| Raíz | Recursivo |
|---|---|
| La raíz del repositorio | No |
| `docs/` | Sí |
| `athos-service/` | Sí |

Se ignoran `node_modules`, `.git`, `.next`, `dist`, `build` y **`.agents`**.

> **`.agents` no es documentación de Tuvetia.** Son skills de terceros instalados —los paquetes que
> publica Supabase—: 40 archivos que hablan de Postgres en general y que nadie de este equipo escribió
> ni mantiene. Son una dependencia vendorizada. Publicarlos junto a la referencia del producto haría
> que la mitad del sitio fuera documentación ajena.

## Las secciones

Las cuatro primeras son **Diátaxis**, el estándar con el que se organiza documentación técnica:

| Sección | Para quién | Forma de escribir |
|---|---|---|
| **Empezar** | Alguien que llega por primera vez | Pasos en orden, sin decisiones |
| **Guías** | Alguien que quiere hacer algo concreto | Orientada a la tarea |
| **Referencia** | Alguien que busca un dato exacto | Tablas, listas, sin narrativa |
| **Explicación** | Alguien que quiere entender el porqué | Discursiva, con las alternativas descartadas |

La división importa porque son cuatro formas distintas de escribir, y mezclarlas es lo que vuelve
ilegible un manual: quien está aprendiendo no quiere una tabla de variables, y quien busca una
variable no quiere un tutorial.

Las otras dos son de este repositorio:

| Sección | Qué contiene |
|---|---|
| **Documentos del repositorio** | Los `.md` vigentes que viven junto al código, tal como están |
| **Histórico** | Fotos con fecha |

## Por qué el histórico está separado

Buena parte de los `.md` del repositorio son **instantáneas**: `REVIEW-2026-08-03`,
`AUDITORIA-2026-07-30`, `DIAGNOSTICO-2026-08-16`. Dicen cómo estaba el sistema ese día, y hoy varias
de sus afirmaciones son falsas **a propósito**, porque lo que describían se arregló después.

Publicarlos junto a la referencia vigente sería peor que no publicarlos: alguien buscando cómo
funciona el calendario encontraría primero un diagnóstico de julio diciendo que está roto.

Van a su propia sección, con un aviso arriba, y **no se pierde ninguno**. En la búsqueda pesan menos
a igualdad de coincidencia, por el mismo motivo.

Se clasifican por la **fecha en el nombre**. Los que son instantáneas y no la declaran están en una
lista corta y explícita en `documento.ts` — inferirlo de palabras como "PLAN" o "NOTA" archivaría de
más: `PLAN-ADMIN` describe algo que se construyó y sigue en pie.

## Agregar un documento

Creá un `.md` bajo `docs/manual/<sección>/` con frontmatter:

```markdown
---
titulo: Cómo hacer X
seccion: guias
orden: 40
resumen: Una línea que se muestra en el índice y en los resultados.
---

# Cómo hacer X
```

| Clave | Qué hace |
|---|---|
| `titulo` | El título. Sin él se toma el primer `# encabezado`; sin ninguno, el nombre del archivo |
| `seccion` | `empezar`, `guias`, `referencia`, `explicacion`, `repositorio`, `historico` |
| `orden` | Dentro de su sección. Sin él va al final |
| `resumen` | Una línea |

**El frontmatter es opcional.** Un `.md` sin él igual aparece: es el caso normal, porque ninguno de
los que ya existían lo tiene.

El slug sale de la ruta: `docs/manual/30-referencia/10-secretos.md` → `referencia/secretos`. Los
prefijos numéricos y `docs/manual/` se recortan; el resto del repositorio conserva su carpeta para
que tres `README.md` distintos no colapsen en el mismo slug.

## La búsqueda

Dos niveles:

- **El campo de la barra lateral** filtra los títulos al instante, en el navegador. Al navegador
  viaja sólo el índice —slug, título, sección, fecha—, nunca el cuerpo.
- **Con Enter** va a `/admin/docs?q=`, que busca **dentro del texto** en el servidor. Es la que
  importa: casi todo lo que alguien viene a buscar acá —el nombre de una variable, una tabla, el
  número de una migración— aparece en el cuerpo y no en el título.

## La trampa del despliegue

Los `.md` se leen del disco en tiempo de petición. Vercel **no sube el repositorio entero**: sube lo
que el rastreo de dependencias encuentra siguiendo los imports, y un `readFile` con una ruta armada
en tiempo de ejecución es invisible para ese rastreo.

`outputFileTracingIncludes` en `next.config.ts` los mete a la fuerza. Sin eso, la documentación
saldría **vacía en producción y sin ningún error** — el modo de fallo más caro, porque en desarrollo
funciona perfecto.

**Si algún día se agrega documentación en una carpeta nueva, hay que sumarla en dos lugares:**
`RAICES` en `catalogo.ts` y `outputFileTracingIncludes` en `next.config.ts`.

## Por qué no se instaló un gestor de documentación

Se evaluó Nextra, que es el estándar del ecosistema Next. Acepta Next ≥14 y React ≥18, así que la
versión no era el problema: su tema renderiza **su propio `<html>` y `<body>`**, y esta app ya tiene
un root layout con temas, fuentes y proveedores. Montarlo obligaba a sortear eso, y `AGENTS.md`
advierte que esta versión de Next tiene cambios de ruptura respecto de lo conocido.

Docusaurus y VitePress son otra aplicación y otro despliegue: no pueden vivir en `/admin/docs`.

Lo que se hizo es **estándar donde importa** —Markdown con frontmatter, estructura Diátaxis— y
propio sólo en el visor, que son unas pocas centenas de líneas. Si mañana se quiere Docusaurus, se
alimenta de los mismos archivos sin tocar una coma.
