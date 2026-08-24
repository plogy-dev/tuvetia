# La capa agéntica de Athos — qué hace hoy en producción

**Corte:** 2026-08-02 · **Commit:** `60379d8` · **URL:** `tuvetia.vercel.app/dashboard/asistente`

Este documento dice qué sabe hacer el asistente **hoy, en producción**, y cómo comprobarlo sin
ayuda del equipo técnico. Cada capacidad trae **una frase para escribirle** y **qué debe pasar**.

Si algo no está al 100%, se dice por qué y qué falta.

---

## Cómo funciona, en una frase

El asistente **nunca escribe solo**. Cuando algo hay que crear, modificar o enviar, deja una
**propuesta** y aparece una tarjeta; el veterinario aprueba o rechaza. La ejecución corre con la
**sesión del veterinario que aprueba**, no con permisos del sistema.

> Eso significa que el asistente no puede tocar datos de otra clínica ni saltarse un permiso: hace
> exactamente lo que el veterinario podría hacer a mano, ni más.

Son **21 habilidades**: 12 de consulta (leen y responden en el momento) y 9 de acción (proponen y
esperan aprobación).

---

## Lo que está al 100% — verificable ahora

Estas habilidades tienen datos reales en producción y se pueden probar hoy mismo.

### Pacientes y titulares

| Habilidad | Escribile esto | Qué debe pasar |
|---|---|---|
| Buscar pacientes | «buscá a Luna» | Lista con especie, raza y titular |
| Resumen clínico | «resumime la ficha de Luna» | Ficha + **alergias** + medicación + últimas consultas |
| Buscar por teléfono | «¿quién es el 3001234567?» | El titular y sus mascotas |

**Datos en producción:** 40 pacientes · 35 titulares · 33 con teléfono · 10 alergias registradas.

> Las alergias severas son **bloqueantes**: el sistema las calcula desde la ficha, no las decide el
> modelo. Si un paciente tiene una alergia severa, aparece antes que cualquier plan.

### Agenda

| Habilidad | Escribile esto | Qué debe pasar |
|---|---|---|
| Ver el día | «¿qué citas hay mañana?» | Las citas de ese día con hora y paciente |
| Horarios | «¿a qué hora abre la clínica los martes?» | El horario configurado |
| Cupos libres | «¿qué horarios tengo libres el jueves?» | Huecos reales: horario menos citas ocupadas |
| **Agendar** | «agendá control para Luna el martes 10am por dermatitis» | **Tarjeta de aprobación** → al aprobar, la cita existe |
| **Modificar o cancelar** | «cancelá la cita de Luna del martes» | Tarjeta de aprobación |

**Datos en producción:** 17 citas reales · 5 días con horario configurado.

> El agendado exige **paciente, titular y motivo**. Si le pedís «agendá algo para mañana» sin
> decir para quién, va a preguntar — no inventa. Es una regla impuesta por la base de datos, no por
> el prompt.

### Historia clínica

| Habilidad | Escribile esto | Qué debe pasar |
|---|---|---|
| Buscar consultas | «¿qué consultas hubo por vómitos?» | Consultas pasadas con fecha y motivo |
| Ver una consulta | «mostrame la consulta de Luna del 28» | Nota SOAP completa + transcripción |
| **Actualizar ficha** | «anotá que Luna pesa 12,4 kg» | Tarjeta de aprobación |

**Datos en producción:** 54 consultas · 37 notas clínicas · 48 transcripciones.

> Las notas se **agregan**, nunca reemplazan lo anterior. La historia clínica no se pisa.

### Literatura veterinaria

| Habilidad | Escribile esto | Qué debe pasar |
|---|---|---|
| Buscar evidencia | «¿qué dice la literatura sobre dermatitis atópica canina?» | Extractos **con fuente y localizador** |

**Datos en producción:** 519.999 fragmentos, el 100% indexados.

> **Cita o se calla.** Si la literatura no cubre la consulta, lo declara en vez de inventar. El
> modelo no puede escribir una fuente: sólo emite un número, y el título, año y enlace los
> reconstruye el código desde el documento recuperado.

### Crear titulares y pacientes

| Habilidad | Escribile esto | Qué debe pasar |
|---|---|---|
| **Titular + mascota** | «creá a María Gómez con su gata Michi, siamés, 3 años» | Una sola tarjeta para ambos |
| **Sólo titular** | «creá el titular Juan Pérez, tel 3001112233» | Tarjeta de aprobación |
| **Sólo paciente** | «agregale a María un perro llamado Toby» | Tarjeta de aprobación |

---

## Lo que funciona pero está vacío

Estas habilidades **están implementadas y probadas**, pero no tienen datos porque nadie conectó el
canal todavía. No fallan: responden «no encontré nada».

| Habilidad | Por qué está vacía | Qué falta |
|---|---|---|
| Buscar en WhatsApp | 0 mensajes en producción | Que entre al menos un mensaje |
| Buscar correos | 0 hilos | Que un miembro conecte su Gmail |
| Leer un hilo de correo | 0 hilos | Ídem |
| **Enviar WhatsApp** | hay 1 integración conectada | Un mensaje de prueba |
| **Enviar correo** | ninguna cuenta conectada | Conectar Gmail desde **Conexiones** |
| **Responder correo** | ninguna cuenta conectada | Ídem |

> **Cómo conectarlo:** el veterinario entra a **Conexiones** y vincula su Gmail. Desde el
> 2026-08-02 la conexión es **por miembro**, no por clínica: cada uno usa su propia cuenta.

---

## La evidencia de que el ciclo completo funciona

No es una promesa: hay acciones **ejecutadas de verdad** en producción.

| Fecha | Acción | Estado | Modelo que la propuso |
|---|---|---|---|
| 30-jul | Agendar cita | ✅ ejecutada | `claude-sonnet-5` |
| 31-jul | Agendar cita | ✅ ejecutada | `claude-sonnet-5` |
| 31-jul | Agendar cita | ✅ ejecutada | `claude-sonnet-5` |
| 02-ago | Enviar correo | ❌ falló | `deepseek-v4-flash` |

**Las dos filas dicen algo importante.**

El fallo del 2 de agosto **es el comportamiento correcto**: el mensaje fue *«No tenés el correo
conectado. Se conecta desde Conexiones.»* No se cayó ni dejó la acción a medias — explicó qué hacer.

Y la columna del modelo muestra la **cascada de proveedores funcionando sola**: hasta el 31 de julio
respondía Claude; el 2 de agosto la cuenta de Anthropic se quedó sin crédito y el sistema pasó a
DeepSeek **sin intervención de nadie**. Esa columna es la traza de que la cascada no es teórica.

---

## Cómo comprobarlo usted mismo, en 5 minutos

1. Entrá a `tuvetia.vercel.app` e iniciá sesión.
2. Abrí **Asistente** en el menú.
3. Escribí: **«buscá a Luna y resumime su ficha»** → debe traer la ficha con alergias.
4. Escribí: **«¿qué horarios libres hay el jueves?»** → debe listar huecos reales.
5. Escribí: **«agendá control para Luna el jueves a las 10 por seguimiento»** → **debe aparecer una
   tarjeta de aprobación**, no una confirmación. Aprobala y verificá en el calendario.
6. Escribí: **«¿qué dice la literatura sobre dermatitis atópica canina?»** → debe citar fuentes.
7. **Recargá la página (F5)** → la conversación debe seguir ahí.

Si el paso 5 confirma sin pedir aprobación, eso **sí** sería un defecto. No debería pasar.

---

## Lo que el asistente NO hace, a propósito

- **No ejecuta nada sin aprobación.** Ninguna excepción, ni para acciones «inofensivas».
- **No da diagnóstico cerrado.** Usa lenguaje de posibilidad («compatible con», «sugestivo de»).
- **No da dosis si faltan datos** (especie, peso, edad). Lo impone el código, no el prompt: medido,
  pedírselo por prompt fallaba en 2 de 23 casos y con un prompt más resolutivo empeoraba a 9 de 23.
- **No inventa fuentes.** No está representado en el camino de datos.
- **No ve datos de otra clínica.** Aislamiento por clínica, cubierto por pruebas automáticas.

---

## Garantías técnicas y cómo se sostienen

| Garantía | Cómo se impone |
|---|---|
| Aprobación humana | El agente sólo inserta filas `proposed`; la ejecución corre con la sesión del vet |
| Aislamiento por clínica | RLS en base de datos + `clinic_id` explícito, con pruebas cross-tenant en CI |
| Trazabilidad | Cada propuesta guarda qué modelo la generó, quién la aprobó y cuándo se ejecutó |
| Continuidad de servicio | Cascada de 3 proveedores (DeepSeek → Gemini → Claude) en las dos superficies |
| Calidad | 432 pruebas automáticas · 22 casos de humo en integración continua |

---

## Estado honesto, en una tabla

| | |
|---|---|
| Habilidades implementadas | **21** |
| Al 100% con datos reales | **15** |
| Implementadas pero sin datos | **6** (correo y WhatsApp) |
| Acciones ejecutadas en producción | **3** |
| Pruebas automáticas | **432**, todas en verde |

**Lo que falta para el 100% de las 21 no es desarrollo: es conectar un Gmail y que entre un
WhatsApp.** Ambas cosas las hace el propio veterinario desde **Conexiones**, sin equipo técnico.
