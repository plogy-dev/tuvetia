# El dashboard, con OkVet como referente — investigación y definición

**Fecha:** 15 de agosto de 2026
**Origen:** al cliente le parece que el dashboard de OkVet es un buen referente.
**Contra:** `/dashboard/tablero` en `master`, el mockup «Tuvetia App v2» y los KPIs de la industria.

---

## Antes que nada: el límite de esta investigación

**No pude entrar al producto.** OkVet no tiene demo público ni capturas en su sitio; la sección
«Pantallas de Okvet» de los directorios que lo listan está vacía. Todo lo que sigue sobre su
dashboard sale de **páginas de marketing y fichas de directorios**, que son vagas a propósito.

O sea: sé **qué dicen que muestra**, no **cómo se ve ni cómo está organizado**. Si el cliente tiene
una cuenta, un video de demo o dos capturas, con eso esta investigación pasa de "qué dicen" a "qué
hace", y algunas de las conclusiones de abajo pueden cambiar. **Vale la pena pedirlas antes de
construir.**

---

## 1. Qué es OkVet

Software veterinario **colombiano** (`okvet.co`) — el mismo mercado que Tuvetia, con integración
DIAN incluida. Dicen tener **más de 6.000 veterinarios en 20 países**. Modelo: versión gratuita
con **OkVet Pro** de pago encima.

Ese modelo importa más de lo que parece, porque **es casi exactamente el que el cliente acordó en
el sync**: base gratis, módulos de valor arriba. Sólo que ellos cobran facturación, inventario,
hospitalización, marketing e informes; nosotros acordamos cobrar el consumo de IA y regalar todo lo
demás. **Somos gratis en lo que ellos cobran.**

| | OkVet gratis | OkVet Pro (pago) |
|---|---|---|
| Historia clínica, agenda, recordatorios, CRM | ✅ | |
| Facturación electrónica (DIAN) | | 💲 |
| Ventas e inventario | | 💲 |
| Hospitalización / kardex | | 💲 |
| Marketing segmentado (SMS/WhatsApp) | | 💲 |
| **Informes especializados** | | 💲 |

**Los informes son producto de pago para ellos.** Es un dato para el pricing, no sólo para el
diseño.

---

## 2. Qué muestra su dashboard, según lo que publican

Las tres cifras que ponen al frente en su home:

- **Agendamientos por mes**
- **Recibos por mes**
- **Documentos electrónicos mensuales**

Y en Pro, «Informes especializados», con lo único concreto que nombran:

- Segmentación **por tipos de mascota**
- **Exámenes realizados**
- **Total de ventas**

Repiten en varios lados una frase que probablemente sea la clave: **«cuadros de mando
personalizables»** — el usuario arma su propio panel.

### Mi lectura de qué le gustó al cliente

Tres cosas, en orden de probabilidad:

1. **Que el panel sea configurable.** «Cuadros de mando personalizables» es lo único que OkVet
   repite en todas sus fichas. Que cada clínica elija qué mirar.
2. **Que el dashboard hable de PLATA y de volumen**, no sólo de clínica. Recibos, documentos
   electrónicos, total de ventas.
3. **Que sea el centro del producto**, no un anexo.

Las tres son verificables con una captura. Sin ella, es lectura mía.

---

## 3. Qué muestra el nuestro hoy

`/dashboard/tablero`: cuatro cifras, un gráfico de 12 semanas y las próximas 8 citas.

| Tarjeta | De dónde sale |
|---|---|
| Consultas este mes | `consultations` del mes |
| Pacientes | conteo de `patients` |
| Citas (próx. 7 días) | `appointments` pendientes |
| Notas por revisar | `clinical_notes` en borrador |

**Ninguna de las cuatro es dinero.** Y no es que falte el dato: tenemos el módulo de facturación
entero —16 rutas, facturas, pagos, gastos, cartera con antigüedad— y hasta un agregado ya escrito,
`getDashboardKpis()` en `lib/facturacion/queries.ts`, que calcula **facturado**, **recaudado** y
**documentos emitidos**. Vive dentro de `/dashboard/facturacion` y **nunca llega al tablero**.

O sea: las tres cifras que OkVet pone al frente —agendamientos, recibos, documentos electrónicos—
**las tenemos calculadas y guardadas en el módulo de al lado.**

---

## 4. La tensión que hay que resolver antes de diseñar nada

Esto no es un detalle: **OkVet y el mockup del propio cliente empujan en direcciones opuestas.**

| | El mockup «Tuvetia App v2» | OkVet |
|---|---|---|
| Pantalla de inicio | **Athos** — la conversación | El dashboard |
| El tablero | Un riel de 320px al lado, «reducido a lo que se puede leer sin dejar de conversar» | El centro del producto |
| Qué mide | 3 filas: consultas hoy, ventas del mes, cartera vencida | Volumen mensual y ventas |
| Personalizable | No lo plantea | Sí, es su bandera |

El cliente escribió en su brief: *«en el consultorio tiene el athos y el phantom… y en el CRM tiene
lo demás»*, y su mockup hizo de Athos la pantalla de inicio. Eso ya está construido (#87).

**Adoptar el modelo OkVet sin decidir esto significa volver el dashboard el centro, que es
exactamente lo que su mockup quitó de en medio.** Hay que elegir:

- **(A) OkVet como referente del CONTENIDO, no de la arquitectura.** Athos sigue siendo el inicio;
  el tablero se vuelve mucho más rico y sigue a un clic. Es lo que recomiendo.
- **(B) OkVet como referente completo.** El dashboard vuelve a ser la pantalla de inicio y Athos
  pasa a ser una sección. Contradice #87 y el brief original.

No es una pregunta de diseño, es de posicionamiento: **si el dashboard es el centro, Tuvetia es un
PMS con IA adentro; si Athos es el centro, es un copiloto clínico con un PMS adentro.** Lo segundo
es lo que diferencia, y es lo que el cliente pidió en julio.

---

## 5. Los KPIs que sí valen, y cuáles podemos calcular HOY

La industria veterinaria tiene un set bastante estable (Provet, entre otros). Contrastado contra
nuestro modelo de datos:

| KPI | ¿Tenemos el dato? | De dónde sale | Esfuerzo |
|---|---|---|---|
| **Facturado / recaudado del mes** | ✅ ya calculado | `getDashboardKpis()` | **0,25 d** — es exponerlo |
| **Documentos electrónicos emitidos** | ✅ ya calculado | `getDashboardKpis()` | **0,25 d** |
| **Cartera vencida** | ✅ ya calculado | `lib/facturacion/domain/aging` | **0,25 d** |
| **Transacción promedio (ACT)** | ✅ | facturado ÷ nº de facturas | **0,5 d** |
| **Pacientes activos** (12 meses) | ✅ | `consultations` por `patient_id` | **0,5 d** |
| **Titulares nuevos del mes** | ✅ | `owners.created_at` | **0,25 d** |
| **Tasa de retención** | ✅ con cuidado | titulares con ≥2 visitas separadas en 12 m | **1 d** |
| **Ingresos por veterinario** | ◐ parcial | `invoices.created_by` — pero es **quien facturó**, no quien atendió | **0,5 d** + decidir si sirve |
| **Costo de personal / ingresos** | ✗ | `expenses` existe, pero nadie categoriza nómina | **1–2 d** + que la clínica lo cargue |
| **Segmentación por especie** | ✅ | `patients.species` | **0,5 d** |
| **Exámenes realizados** | ✗ | no existe la entidad | no estimado |

**Lo barato y de mayor impacto son las cuatro primeras**: ya están calculadas y sólo hay que
llevarlas al tablero. Un día entero, contando pruebas.

### Una salvedad honesta sobre «ingresos por veterinario»

`invoices.created_by` es **quien emitió la factura**, que en una clínica chica suele ser la
recepcionista, no el vet que atendió. Publicar eso como «productividad por veterinario» es un número
que se lee mal y puede generar conflicto interno. Para que sirva hay que atarlo a
`consultations.vet_id` o a `appointments.vet_id`. **No lo pondría hasta resolver eso.**

---

## 6. Propuesta concreta

### Fase 1 — el tablero deja de ser ciego al dinero (~1 día)

Seis tarjetas en vez de cuatro, sumando lo que ya está calculado:

```
Facturado del mes    Recaudado del mes   Cartera vencida
Consultas este mes   Pacientes activos   Citas (próx. 7 días)
```

«Pacientes» pasa a **«Pacientes activos»** (con consulta en 12 meses). El conteo total de fichas no
dice nada de la clínica: sólo crece.

Las tres de dinero **se ocultan si el módulo de facturación está sin activar**, con la misma regla
que ya usa el riel: un «$ 0» inventado se lee como un dato malo, no como un módulo apagado.

### Fase 2 — lo que OkVet cobra y nosotros podemos regalar (~2 días)

- **Transacción promedio** y **titulares nuevos del mes**.
- **Segmentación por especie** — el único «informe especializado» que OkVet nombra y que podemos
  calcular con una línea.
- **Tasa de retención**, que es el KPI que más dice de la salud del negocio y que OkVet **no
  menciona en ningún lado**. Ahí hay una diferencia real a favor.

### Fase 3 — el panel configurable (~3–4 días)

Es la bandera de OkVet y lo más probable que le haya gustado al cliente. Ocultar y reordenar
tarjetas, guardado por usuario.

**Yo lo dejaría para el final, y con una condición:** que primero haya tarjetas que valga la pena
reordenar. Un panel configurable con cuatro tarjetas es una preferencia sin contenido. Además,
guardar layout por usuario pide una tabla nueva y una migración — no es sólo interfaz.

### Lo que NO haría

- **Mover el inicio al dashboard.** Contradice #87 y el brief del propio cliente. Si se decide, que
  sea una decisión explícita de producto, no un efecto colateral de copiar a un competidor.
- **«Ingresos por veterinario» con `created_by`.** Mide otra cosa.
- **«Costo de personal / ingresos»** hasta que haya una categoría de nómina que alguien cargue. Un
  KPI que siempre da cero es peor que no tenerlo.
- **Copiar «documentos electrónicos mensuales» como tarjeta destacada.** Para OkVet es un
  diferenciador porque la facturación electrónica es su módulo de pago estrella. Para nosotros es
  gratis y de costo marginal cero: ponerlo al frente le da protagonismo a lo que no nos diferencia.

---

## 7. Lo que hay que preguntarle al cliente

1. **¿Capturas o demo de OkVet?** Sin ver el producto, el punto 2 es lectura de marketing.
2. **¿Qué le gustó exactamente?** ¿Que sea configurable, que hable de plata, o que sea el centro?
   Las tres llevan a construcciones distintas.
3. **¿Athos sigue siendo el inicio?** Es la pregunta de la §4 y bloquea todo lo demás.
4. **¿Quiere retención?** Es lo que OkVet no tiene y lo que más dice del negocio de una clínica.

---

## Fuentes

- [okvet.co](https://okvet.co/) — home, métricas destacadas y módulos
- [okvet.co/okvet-pro](https://okvet.co/okvet-pro/) — qué entra en el plan de pago
- [okvet.co/funcionalidades](https://okvet.co/funcionalidades/) — desglose gratis vs. Pro
- [softwaredoit.es — ficha de Okvet](https://www.softwaredoit.es/okvet/okvet.html) — «cuadros de mando personalizables»
- [softwareseleccion.com — Okvet](https://www.softwareseleccion.com/okvet-p-5180) — lista de módulos
- [comparasoftware.com — Okvet](https://www.comparasoftware.com/okvet) — opiniones de usuarios
- [Provet — 6 KPIs veterinarios](https://www.provet.com/blog/metrics-that-matter-6-veterinary-kpis-every-practice-should-track) — el set de referencia de la industria
