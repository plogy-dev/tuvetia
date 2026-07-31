# Entornos: qué apunta a dónde, qué está en riesgo y qué cuesta arreglarlo

**Corte:** 2026-07-30 · **Para:** todo el equipo — no hace falta ser del backend para entenderlo

---

## En una frase

Se borró la base de datos de desarrollo. Sin ella, la única forma de trabajar era **apuntar a
producción**, y la suite de pruebas —que crea y borra clínicas— empezó a correr ahí. Ya está
contenido con dos cortafuegos, pero **la solución de fondo es recrear el entorno de desarrollo**, y
eso cuesta menos de lo que parece porque **el esquema completo ya está en el repositorio**.

---

## La cadena, contada de principio a fin

```
1. Se borra el proyecto tuvetia-athos-dev
              ↓
2. Un dev que necesita una base real tiene dos opciones:
   no trabajar  ·  apuntar su .env a producción
              ↓
3. Elige la segunda — es lo razonable cuando hay entregas
              ↓
4. La suite de pruebas corre contra producción.
   Aparecen en los logs del principal:
   invalid input syntax for type uuid: "clinic-a"
```

**Esto no fue un descuido de nadie.** Fue la única salida que quedaba cuando desapareció la base de
desarrollo. Por eso la solución no es «tener más cuidado», es **devolverle al equipo el lugar donde
trabajar**.

---

## Qué estaba en riesgo, y qué tan grave era

| # | Riesgo | Qué podía pasar | Gravedad | Estado |
|---|---|---|---|---|
| 1 | La suite de pruebas **crea y borra clínicas** en producción | `seeded_tenants` hace `insert` de clínicas y al terminar `delete from clinics`, que **arrastra en cascada** todo lo que cuelgue | 🔴 alta | ✅ **cortado** |
| 2 | Cualquier **agente de IA** tenía **escritura** sobre producción | El `.mcp.json` de la raíz apuntaba a producción **sin** modo solo-lectura | 🔴 alta | ✅ **cortado** |
| 3 | La **única protección** del repo apuntaba a una base **que ya no existe** | El `.mcp.json` de `athos-service/` tenía solo-lectura… sobre el proyecto borrado | 🟠 media | ✅ **corregido** |
| 4 | Ids de prueba **ensuciando las trazas** de producción | `rag_retrieval_log` con `clinic-a` en vez de clínicas reales | 🟡 baja | ✅ **verificado: sin residuo** |
| 5 | **No hay dónde desarrollar** | Cada dev vuelve a tener que elegir entre no trabajar o apuntar a producción | 🔴 **alta** | ❌ **ABIERTO** |

**Sólo queda el 5.** Los cuatro primeros están resueltos.

### Daño real: cero

Se revisaron 13 tablas buscando los identificadores de prueba: `clinics`, `owners`, `patients`,
`allergies`, `consultations`, `transcripts`, `clinical_notes`, `athos_messages`, `rag_retrieval_log`,
`rag_answer_log`, `patient_embeddings`, `appointments` y `athos_actions`. **Sin residuo.**

Los identificadores de las pruebas son fijos y sintéticos (`a1a1a1a1-…`), así que el borrado **no
puede alcanzar una clínica real**. Tuvimos suerte en el diseño, no en el proceso.

> Aparte se borraron 3 clínicas vacías que sí quedaron de una verificación del enlace de invitación:
> al borrar un usuario, **la clínica que le crea el sistema automáticamente no se borra sola**. Es una
> trampa que conviene recordar para cualquier prueba futura que cree usuarios.

---

## Los dos cortafuegos que ya están puestos

### 1. Una prueba no puede abrir la base de producción

El primer intento fue ponerlo en las pruebas que declaran usar la base. **No alcanzaba**, y esto es lo
más importante de entender:

> `test_chat.py` y `test_phantom.py` llegan a la base **a través de mocks** (piezas simuladas). Un
> mock que deja de aplicar **no avisa**. Hoy mismo pasó tres veces con el cliente de IA: las pruebas
> empezaron a llamar a la API real y nadie lo notó hasta ver la factura de tiempo.

Por eso el cortafuegos bajó al **único punto por el que pasa todo: abrir la conexión**. No importa qué
mock se rompa; si la base es la de producción y estamos en pruebas, **no se abre**.

**Una excepción deliberada:** el **corpus** (los 520.000 fragmentos de literatura) **sí** se puede
leer de producción, porque es de sólo lectura y sólo existe ahí. Sin eso no se podría medir la
calidad de nada. Hay una prueba que fija esa asimetría para que nadie la «arregle» por error.

### 2. Los agentes de IA quedan en solo-lectura sobre producción

Los dos archivos de configuración ahora apuntan a producción **en modo solo-lectura**. Escribir a
producción vuelve a ser un **acto deliberado y revisable**, no el valor por defecto.

---

## Lo que falta: dónde desarrollar

Acá hay una confusión de palabras que conviene deshacer, porque cambia toda la decisión:

> **«Entorno de desarrollo» NO significa «en la máquina de alguien».**
> `tuvetia-athos-dev` era un **proyecto de Supabase en la nube**, igual que producción. Sólo que con
> datos de mentira.

Así que **recrearlo cumple exactamente lo que se pide**: todo en la nube, nada corriendo en local,
y cada cosa apuntando a donde debe.

### Las dos opciones, comparadas

| | **Recrear el Supabase de dev** ← recomendada | Postgres local en Docker |
|---|---|---|
| ¿Corre en la máquina de alguien? | **No**, en la nube | **Sí**, un contenedor por dev |
| ¿Prueba el login de verdad? | **Sí** — es Supabase completo | **No.** Hay que simular usuarios y sesiones |
| ¿Prueba correos, invitaciones, Google? | **Sí** | **No** |
| Mantenimiento | ninguno | cada dev mantiene su contenedor |
| ¿Está listo en el repo? | **Sí** (ver abajo) | **No** — sigue en un PR sin mergear |
| Costo | un proyecto de Supabase | gratis |

La segunda no es mala idea para el CI —donde da igual que el login sea simulado—, pero **no reemplaza
a la primera** para el trabajo del día a día. Y hoy **no existe en el repositorio**: ni el
`docker-compose` ni el archivo de simulación de usuarios están en `master`.

---

## Lo reutilizable: por qué esto es más barato de lo que parece

**El esquema de la base es código y ya está versionado.** No hay que reconstruir nada a mano:

| Qué | Dónde | Para qué sirve |
|---|---|---|
| **43 migraciones** | `athos-service/supabase/migrations/` | recrean todas nuestras tablas, índices y funciones |
| **Esquema base (684 líneas)** | `athos-service/supabase/bootstrap/000_base_schema.sql` | recrea las tablas generales de la plataforma |
| **Runbook del proceso** | `athos-service/docs/MIGRACIONES.md` | el paso a paso, ya escrito |
| **Cortafuegos + 9 pruebas** | `athos-service/app/db.py`, `tests/test_db_guard.py` | ya funcionan, no dependen de qué base sea |
| **Configuración de agentes** | `.mcp.json` (los dos) | ya en solo-lectura |

**Traducción:** crear el proyecto, correr las migraciones, pegar la cadena de conexión en el `.env`.
**Estimado: 1–2 horas**, casi todo esperando a que Supabase levante el proyecto.

Lo único que **no** se recupera es el **contenido**: pacientes y consultas de prueba. No importa —
eran datos inventados, y las pruebas siembran los suyos.

---

## El mapa final: qué debe apuntar a dónde

| Qué | Apunta a | Por qué |
|---|---|---|
| Servicios desplegados (Railway, Vercel) | **producción** | es su trabajo |
| Corpus para mediciones de calidad | **producción, sólo lectura** | los 520k fragmentos sólo viven ahí |
| Agentes de IA (MCP) | **producción, sólo lectura** | mirar sí, escribir no |
| `.env` de cada dev — datos de paciente | **dev** | acá es donde se escribe y se borra |
| Suite de pruebas | **dev** | crea y **borra** clínicas |
| CI | **dev** o Postgres del runner | igual que las pruebas |

**La regla, en una línea:** *lo que sólo lee puede mirar producción; lo que escribe, nunca.*

---

## Estado ahora mismo

- ✅ **250 pruebas pasan.**
- ⚠️ **6 pruebas de base fallan a propósito**, con el arreglo escrito en el mensaje de error.
- ❌ **La suite seguirá roja hasta que exista una base de desarrollo.** No es un problema de código:
  es que no hay dónde apuntar.

**La decisión que hace falta:** recrear `tuvetia-athos-dev`. Es lo único que separa al equipo de
volver a tener la suite en verde y de que nadie más tenga que elegir entre no trabajar o tocar
producción.
