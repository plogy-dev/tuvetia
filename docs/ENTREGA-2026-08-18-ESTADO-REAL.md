# Entrega Final del 18-ago — qué está verificado y qué no

> **Contraste del checklist interno contra producción**, hecho el 2026-08-17 consultando la base y
> leyendo el código. Aplica la regla que el propio checklist pone arriba de todo: *"solo cuenta lo
> que esté integrado y operando en el entorno accesible al cliente"*.
>
> **Cada afirmación de acá sale de una medición**, no de leer el código y suponer que corre.

---

## 🔴 Lo que NO se puede demostrar mañana

### 1. Los tres modelos respondiendo en producción

El checklist lo pide explícito: *"los tres modelos (Gemini, DeepSeek, Claude) respondiendo de verdad
en producción, no solo cableados. Verificar que el log muestre respuestas reales de los tres, no solo
de DeepSeek."*

**Los dos logs del sistema dicen que sólo DeepSeek ha respondido. Nunca.**

`athos_agent_usage` — el agente del front, 64 llamadas del 2-ago al 17-ago:

| proveedor | modelo | llamadas |
|---|---|---|
| deepseek | `deepseek-v4-flash` | **64** |

`rag_answer_log` — el chat clínico de athos-service, 20 respuestas desde el 24-jul:

| modelo | respuestas |
|---|---|
| `deepseek-chat` | 11 |
| `deepseek-v4-flash` | 5 |
| `deepseek-v4-flash@openai` | 4 |

**Claude: 0 respuestas. Gemini: 0 respuestas.** En ninguno de los dos servicios, nunca.

#### La traza de qué pasó, que es lo que hace accionable el hallazgo

La cascada **sí estuvo configurada con Claude de primario**. Hay dos registros de fallback:

| cuándo | cayó desde | respondió |
|---|---|---|
| 2026-08-02 15:13 | `claude-sonnet-5` | `deepseek-v4-flash` |
| 2026-08-02 17:05 | `claude-sonnet-5` | `deepseek-v4-flash` |

Y **desde el 2 de agosto no hay un solo fallback registrado** — o sea que la configuración cambió:
Claude dejó de ser primario. Concuerda con la nota del propio checklist (*"el código lo excluía de la
cascada por falta de saldo"*).

#### Qué haría falta para demostrarlo

1. **Crédito de producción en Anthropic.** Es la causa raíz: Claude falló las dos veces que se
   intentó.
2. **`GEMINI_API_KEY` cargada** — Gemini no aparece ni una vez, así que probablemente nunca estuvo
   en la cadena efectiva.
3. **Las tres cadenas apuntando a los tres**: `ATHOS_AGENT_CASCADE`, `ATHOS_AUTO_CASCADE`,
   `ATHOS_VISION_CASCADE`, en formato `modelo@proveedor,…`.
4. **Redesplegar** y hacer una llamada real con cada uno.

> ⚠️ **Ojo con `/api/health`**: reporta `cascada_con_credenciales: true` aunque **no haya cascada
> configurada** — con el conjunto vacío, `[].every()` da `true`. Está documentado como deliberado en
> el propio endpoint, pero significa que **ese verde no prueba que los tres estén cableados**. La
> única prueba es el log de respuestas.

**Lo demostrable hoy:** que la cascada **funciona** —cayó de Claude a DeepSeek sin cortar la
respuesta, dos veces, con registro— y que el routing por superficie opera. Lo que no se puede
demostrar es que los tres modelos *respondan*.

### 2. El onboarding no recorre lo que el checklist describe

El checklist pide: *identificación de clínica → servicios y productos → esquema de facturación →
conexión de calendario → conexión de WhatsApp → instrucción sobre el asistente*.

El wizard real (`welcome-wizard.tsx:46`):

```
["Clínica", "Horarios", "Servicios", "Primer paciente", "Ejemplo", "Equipo"]
```

| lo que pide el checklist | está |
|---|---|
| identificación de clínica | ✅ paso 1 |
| servicios y productos | ✅ paso 3 (servicios; productos no) |
| esquema de facturación | ❌ |
| conexión de calendario | ❌ |
| conexión de WhatsApp | ❌ |
| instrucción sobre el asistente | 🟡 hay un panel de Athos al lado, no un paso |

**Cero coincidencias** de calendario, WhatsApp o Conexiones en el wizard. Los pasos que sí están
—horarios, primer paciente, ejemplo, equipo— son buenos, pero no son los que el documento describe.

**Contexto:** los pasos de Horarios y Servicios se agregaron ayer, porque la auditoría midió que
**0 de 15 clínicas podían facturar** y 14 de 15 no podían agendar. Eso sí se resolvió.

---

## ✅ Lo verificado y demostrable

| Ítem del checklist | Evidencia |
|---|---|
| Corpus indexado y consultable | ~520k chunks; ya reconocido cumplido por el cliente |
| Mecanismo de abstención | `evidence_judge.py`, medido sobre 188 casos; tres bandas en `clinical_notes.evidence_level` |
| Verificación de citas | Dos capas: procedencia determinística + fidelidad por LLM |
| Agent smoke testing documentado | `docs/AGENT-SMOKE-TESTING.md` y `docs/BANCO-AGENTE-RESULTADO.md` |
| Renombres: Calendario → **Agenda**, Facturación → **Ventas** | `app-sidebar.tsx:82-83` — etiquetas cambiadas, rutas conservadas |
| Inventario: categorías | Tabla `catalog_categories` + `catalog_items.category_id` |
| Ventas: documento por **correo** | `sendInvoiceByEmail` → Resend, disparado desde el panel de la factura |
| Ventas: documento por **WhatsApp** | Vía cartera (`channels.ts`), no desde el panel de la factura |
| **Citas superpuestas** | 🆕 Resuelto ayer: trigger que bloquea el solape del mismo vet, con válvula deliberada |
| Historia clínica: adjuntos | `patient-attachments.tsx` |
| Migración sin pérdida de datos | 0063–0067 aplicadas y verificadas contra el principal |

### Lo que se cerró en las últimas 48 h

- **9 hallazgos de auditoría**, todos cerrados (PR #105–#113)
- **Doble reserva de citas** — 6 pares medidos en producción, ahora imposible por accidente
- **Índices faltantes** en `owners` y `clinical_notes` (eran seq scans)
- **Traza de acciones humanas** — quién editó un paciente o canceló una cita
- **1058 tests** en verde

---

## 🟡 Un riesgo latente encontrado al reverificar

Existe una tabla **`appointments_importadas_respaldo`** con **19.649 filas de 2 clínicas**, huérfana
—ningún código la lee— y creada a mano durante una importación entre el 31-jul y el 2-ago. No sale
de ninguna migración del repo.

**No tiene RLS.** Pero **no es una exposición**, y conviene decirlo con precisión porque casi lo
reporto mal:

| tabla | `authenticated` | `anon` | RLS |
|---|---|---|---|
| `appointments` | ✅ | ✅ | ✅ |
| **`appointments_importadas_respaldo`** | **❌** | **❌** | ❌ |
| `patients` | ✅ | ✅ | ✅ |

**Nadie puede leerla**: sin `SELECT` otorgado a ningún rol, la RLS faltante es irrelevante. El riesgo
es *latente* — si alguien corriera un `grant select on all tables in schema public to authenticated`,
esas 19.649 citas quedarían visibles entre clínicas.

**Lo que corresponde**, y no hoy: borrarla si el respaldo ya no hace falta, o activarle RLS. No toca
nada que esté funcionando.

> Nota de método: la primera consulta que usé decía que **tampoco `appointments` era legible**, lo
> cual es falso — la aplicación la lee todo el tiempo. Esa contradicción invalidaba el método, no los
> permisos. La tabla de arriba sale de `has_table_privilege`, que es la función autoritativa.

---

## 🟠 Riesgos para el acto de entrega

### La política de tratamiento de datos no existe

`/legal/privacidad` y `/legal/terminos` están publicadas **diciendo "Documento en preparación"**,
mientras el sistema ya almacena cédulas, direcciones, teléfonos, conversaciones de WhatsApp y **voz
con su transcripción**.

El checklist la pide *"entregada para revisión antes de la entrega"*. **Bloquea, y no se resuelve
técnicamente**: la Ley 1581 exige nombrar un responsable del tratamiento —persona jurídica con NIT—
y eso sigue sin definirse.

Lo que sí está bien: el consentimiento de grabación es bloqueante, guarda qué texto se aceptó, y lo
exige un trigger de base de datos.

### WhatsApp: la sesión persistente no se puede afirmar

El checklist pide *"sesión persistente verificada durante varios días"*. Lo medido en producción es
lo contrario: las dos integraciones **duraron 7 y 8 días** y cayeron. Evolution es WhatsApp Web y la
sesión expira sola.

Desde ayer **el sistema avisa** cuando se cae —señal en el riel, la tira móvil, el prompt de Athos y
el briefing, con los días que lleva—. Pero *"persistente durante varios días"* es una afirmación que
los datos no sostienen.

### Documentación técnica

El checklist pide arquitectura, esquema de base, guía de despliegue, manual de administración y
recomendaciones de escalabilidad. Hay bastante hecho:

| pide | tenemos |
|---|---|
| Arquitectura | `docs/ARQUITECTURA.md` |
| Esquema de base | `docs/SEGURIDAD-DB.md` + las migraciones |
| Guía de despliegue | `docs/traspaso/RUNBOOK.md` + `CONFIGURACION-PRODUCCION.md` |
| Manual de administración | 🟡 parcial — `docs/PLAN-ADMIN.md` |
| Recomendaciones de escalabilidad | 🟡 el análisis existe, sin documento propio |
| **Accesos** (repo, Supabase, Railway, Vercel) | `docs/traspaso/INVENTARIO.md` — las 15 cuentas mapeadas |

### El inventario escrito de componentes

El checklist marca que **esto falló la vez pasada y costó caro**. No existe todavía como documento.
Es lo primero que armaría hoy: es barato y es exactamente lo que el cliente usó como argumento.

---

## Lo que conviene decir antes de que pregunten

El checklist ya lo tiene bien identificado, y los datos lo confirman:

- **Facturación electrónica DIAN**: el andamiaje está —reglas de UVT, umbral POS, motivos de nota
  crédito, CUFE y QR en el documento— y hay una **costura lista** (`fiscal/factory.ts`) que hoy
  devuelve un sandbox. Falta **elegir el aliado** (el código nombra MATIAS, Dataico, Factus). Sin
  proveedor contratado y resolución de numeración, no hay validez fiscal.
- **Capa agéntica en todas las secciones**: el widget **ya está en todas las pantallas del CRM**
  (`dashboard/layout.tsx:123`) con 21 herramientas, 9 de ellas ejecutables tras aprobación. Lo que
  es Fase II es ampliar el alcance por sección.

---

## Prioridad para las próximas horas

1. **🔴 Los tres modelos.** Es el único ítem del Milestone 2 que hoy no se puede demostrar, y depende
   de cargar crédito y variables — no de código. Si se resuelve hoy, mañana se demuestra en vivo
   forzando un fallback.
2. **🔴 El inventario escrito de componentes.** Barato, y el checklist dice que su ausencia ya costó
   caro una vez.
3. **🟠 Decidir el responsable del tratamiento**, o llevar la política redactada con ese campo
   marcado y acordar plazo.
4. **🟡 El onboarding**: decidir si se agregan los pasos que faltan o se acuerda por escrito que el
   flujo entregado es el que está.

**Lo que no recomiendo:** tocar código hoy salvo el punto 4, y sólo si se decide agregarlo. A un día
de la entrega, el riesgo de romper algo verificado supera lo que se gana.
