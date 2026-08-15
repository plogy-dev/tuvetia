# Antifraude del free trial y las vistas que faltan en el admin panel

**Fecha:** 15 de agosto de 2026
**Origen:** §7 y §9.3 del acta del sync («Optimización de Datos y Costos», 12-ago).
**Contra:** `/admin` en `master`, el esquema real y la Ley 1581.

---

## Lo que pidió el acta

> **Problema:** de cada 20 cuentas creadas, quizá 2 se usan de verdad; y hay riesgo de clientes
> creando cuentas en loop para tener free trial infinito.
>
> **Enfoque acordado: implementar ambos mecanismos.**
> 1. **Automático** — desactivar (eliminar) cuentas sin uso recurrente después de X tiempo.
> 2. **Manual** — revisión "de ojo" desde el admin panel, con la última fecha de ingreso visible.
>
> **Detección de abuso:** por IP (estándar) y por nomenclaturas de correo.

Y §9.3 lista cinco vistas del panel. **Dos ya están construidas** (lo verificó el diagnóstico del
12-ago); las otras tres son el objeto de este estudio.

| Vista de §9.3 | Estado real hoy |
|---|---|
| Monitoreo de requests | ✅ `/admin/costos` (migración 0046, costo real por tokens) |
| Listado de usuarios con última fecha de ingreso | ✅ `/admin/usuarios` (con flag «nunca entró») |
| **Desactivación manual** | ✗ |
| **Desactivación automática** | ✗ |
| **Señales de abuso** | ✗ |

---

## 1. Los tres hallazgos que cambian el plan

### 1.1 `profiles.is_active` existe, se muestra… y no bloquea nada

La columna está desde el esquema base (`is_active boolean not null default true`) y `/admin/usuarios`
ya la lee. Pero **ninguna policy de RLS, ninguna función `private.*`, ningún proxy y ninguna ruta la
consultan**. Verificado con búsqueda exhaustiva sobre las policies, las migraciones 0001–0058 y
`src/proxy.ts`.

O sea: **hoy poner `is_active = false` no le impide entrar a nadie.** Un botón de "desactivar" sobre
esa columna sería un botón que no desactiva — el mismo error que ya evitamos con el «Deshacer» de la
tarjeta de Athos.

**Esto reordena el trabajo:** la desactivación manual no es una vista, es primero un **gate**. La
vista es la parte fácil.

### 1.2 La IP no se guarda en ningún lado

`audit_logs.ip_address inet` existe en el esquema base y **nadie la escribe**: cero llamadas en todo
el repo. Los `audit()` de las acciones de Athos, de facturación y del equipo insertan sin ella.

O sea que la señal que el acta llama "estándar" **no existe como dato**. Antes de decidir si se
bloquea por IP hay que empezar a capturarla, y eso son semanas de acumulación antes de que sirva
para algo.

Hay una fuente alternativa que ya está poblada y nadie mira: **`auth.audit_log_entries` de Supabase**,
que registra los eventos de autenticación con su IP. No hace falta construir la captura — hace falta
leerla. Conviene verificar su retención antes de apoyarse en ella.

### 1.3 «Eliminar cuentas sin uso» no es una decisión de producto

El acta dice *desactivar (eliminar)*. Borrar una clínica borra **historias clínicas de mascotas de
terceros**: los titulares tienen derechos sobre esos datos bajo la Ley 1581 con independencia de que
el veterinario pague o no.

El diagnóstico del 12-ago ya lo marcó y sigue sin resolverse. **Desactivar y eliminar tienen que ser
dos cosas distintas**, y la segunda necesita criterio legal, no de producto.

---

## 2. El bloqueo por IP: el acta ya sospechaba, y con razón

§7.1 dice *"investigar bien el bloqueo por IP antes de implementarlo — una misma clínica veterinaria
comparte IP"*. La preocupación es correcta y hay más:

- **Una clínica ES varios usuarios en una IP.** Es el caso normal, no la excepción: el vet, la
  recepcionista y el administrador entran desde el mismo router. Bloquear por IP repetida marca como
  fraude al cliente que mejor está usando el producto.
- **Los móviles rotan IP.** Un vet que entra desde datos móviles cambia de IP entre consultas; el
  mismo humano se ve como varias IP.
- **El CGNAT colombiano agrupa miles de abonados detrás de una IP pública.** Dos clínicas sin
  relación pueden compartir IP sin saberlo.

**Conclusión: la IP no sirve como señal de bloqueo.** Sirve, como mucho, para **ordenar una lista de
revisión** — y sólo cuando se cruza con otras señales.

La otra señal que el acta menciona —**nomenclaturas de correo**— es mucho más específica y **ya
tenemos el dato**: `auth.users.email` está disponible vía la API Admin, que `/admin/usuarios` ya usa.
`juan+1@gmail.com`, `juan+2@gmail.com`, `juanaa@gmail.com` son detectables hoy, sin capturar nada
nuevo.

---

## 3. Las señales que YA existen, sin construir nada

Todas salen de datos que el panel ya trae:

| Señal | De dónde | Qué indica |
|---|---|---|
| **Nunca entró** | `auth.users.last_sign_in_at` nulo — ya está en pantalla | Registro que no llegó a usarse |
| **Última entrada** | `last_sign_in_at` — ya está en pantalla | Inactividad |
| **Correos casi iguales** | `auth.users.email`, normalizando `+alias` y puntos de Gmail | Cuentas en loop del mismo humano |
| **Clínica sin datos** | conteos de `patients` / `consultations` que `metrics.ts` ya calcula | Cuenta creada y abandonada |
| **Consumo de IA** | `athos_agent_usage` (0046) | Distingue "no la usa" de "la está exprimiendo" |
| **Alta en ráfaga** | `profiles.created_at` / `clinics.created_at` | Varias cuentas en minutos |

**La combinación que de verdad importa** no es ninguna de ellas sola: es *correo casi igual a otro* +
*clínica sin pacientes* + *consumo de IA alto*. Ése es el patrón del trial infinito. Una cuenta
inactiva con correo único es simplemente alguien que se registró y no volvió — eso no es fraude, es
onboarding.

---

## 4. Propuesta

### Fase 1 — que desactivar signifique algo (~1 día)

Antes de cualquier vista. Un gate real sobre `is_active`, en el único lugar donde no se puede
esquivar: **`private.my_clinic_id()`**, que es de donde cuelga toda la RLS del producto. Con el
perfil inactivo devuelve NULL y el usuario deja de ver datos de su clínica, sin tocar una sola
policy.

Requiere migración y **un test cross-tenant**, que es obligatorio en este repo para todo lo que toca
esa función.

> **Ojo con el efecto colateral:** desactivar al ADMINISTRADOR de una clínica deja a esa clínica sin
> quien invite, configure ni cobre. El gate tiene que ser por persona, y la desactivación de una
> clínica entera es otra operación.

### Fase 2 — la revisión manual, con la señal delante (~1,5 días)

Una vista en `/admin/usuarios` que ordene por **riesgo**, no por fecha. Por fila: última entrada,
pacientes y consultas de su clínica, consumo de IA, y **con qué otras cuentas se parece el correo**.
Más el botón de desactivar, que para entonces ya hace algo.

El acta lo dice bien: *"no basta con listar usuarios; el panel necesita mostrar LA SEÑAL para que la
revisión sea rápida"*.

### Fase 3 — la automática, y sólo desactivando (~1 día)

Un barrido que desactiva —nunca borra— cuentas sin ingreso en N días y sin datos. Con dos guardas:

- **Aviso por correo antes**, no después. Una cuenta que se apaga sin avisar es una queja.
- **Nunca a una clínica con consultas registradas.** Ahí hay historias clínicas de terceros, y el
  umbral de inactividad no puede decidir sobre eso.

⚠️ **Los dos cupos de cron de Vercel ya están usados** (plan Hobby). Esto va como GitHub Action, que
es donde ya corre el barrido de cartera.

### Fase 4 — la IP, si se decide (~0,5 día de lectura + acumulación)

Leer `auth.audit_log_entries` en vez de construir captura. Y **sólo para ordenar la lista de
revisión**, jamás para bloquear automáticamente.

---

## 5. Lo que NO recomiendo

- **Bloquear por IP.** §2. Castiga al cliente legítimo antes que al abusador.
- **Borrar cuentas automáticamente.** Son datos de terceros bajo Ley 1581. Desactivar sí; borrar es
  una decisión con criterio legal y, si se hace, con exportación previa — el export ya existe
  (`/api/export`), así que es decisión y no desarrollo.
- **Construir las vistas antes que el gate.** Un botón "Desactivar" sobre una columna que nadie
  consulta es peor que no tenerlo: da por resuelto un problema que sigue abierto.
- **Un umbral de inactividad único.** Una clínica de un solo veterinario puede pasar tres semanas sin
  entrar en temporada baja y seguir siendo un cliente. El umbral tiene que mirar *actividad*, no
  *ingreso*.

---

## 6. Preguntas que siguen abiertas

1. **¿Cuántos días de inactividad?** El acta duda entre 15 días y 1 mes y no lo cierra.
2. **¿Qué pasa con los datos al desactivar?** ¿Se exportan antes? ¿El titular puede pedirlos?
3. **¿Desactivar a una persona o a una clínica?** Son operaciones distintas con consecuencias
   distintas.
4. **¿Cuál es la retención de `auth.audit_log_entries`** en nuestro plan de Supabase? Si es corta, la
   señal de IP se evapora antes de servir.

---

## Anexo: qué se verificó para este estudio

- `is_active` no aparece en ninguna policy, función `private.*`, migración 0001–0058 ni en
  `src/proxy.ts`. Sólo se lee para mostrar, en `admin/metrics.ts` y `admin/users.ts`.
- `audit_logs.ip_address` existe en `000_base_schema.sql:389` y no tiene una sola escritura en el
  repo.
- `/admin/usuarios` ya expone `createdAt`, `lastSignInAt` y el flag `nuncaEntro`.
- `/admin/costos` ya calcula costo real por tokens desde `athos_agent_usage`.
