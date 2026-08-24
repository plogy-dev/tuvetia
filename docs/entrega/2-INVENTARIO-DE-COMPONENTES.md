# Inventario de componentes presentados — Entrega Final

**Contrato:** COT-2026-TUV-001 · **Fecha:** 18 de agosto de 2026
**Entorno:** producción, accesible al cliente
**Cifras medidas el 23 de agosto de 2026** contra el proyecto principal y el repositorio.

> **Toda cifra de este documento lleva fecha y definición.** No es formalidad: la versión anterior
> decía "33 pantallas" sin decir que contaba las del dashboard, y "en las últimas 48 horas" sin decir
> desde cuándo. Un número sin fecha envejece sin que se note, y este documento es evidencia.

> Este documento existe porque el 28 de julio no se entregó y el cliente lo usó como argumento.
>
> **Cada línea corresponde a algo desplegado y demostrable en vivo.** Lo que no está operando en el
> entorno del cliente no figura acá — y lo que falta está en la última sección, dicho por su nombre.

---

## 1. Superficie del producto

**34 pantallas del producto** (las del dashboard; 52 contando panel de plataforma, marketing, legales
y las páginas públicas sin sesión), **37 rutas de API**, **68 tablas** con seguridad a nivel de fila.

### Módulo Consulta *(clínico)*

| Pantalla | Qué hace |
|---|---|
| Asistente (Athos) | Chat clínico con literatura citada |
| Consultas · listado | Consultas de la clínica, con filtro y búsqueda |
| Consulta · detalle | Transcripción, nota SOAP, aprobación |
| Pacientes · listado | Búsqueda por mascota o titular |
| Paciente · ficha | Historia, alergias, medicación, adjuntos, citas |
| Importar pacientes | Carga masiva desde CSV |

### Módulo CRM

| Pantalla | Qué hace |
|---|---|
| Inicio | Conversación con Athos + riel "La clínica hoy" |
| Tablero | Métricas: consultas, pacientes, citas, notas por revisar |
| Agenda | Calendario de citas, con arrastrar y soltar |
| Titulares · listado y ficha | Dueños y sus mascotas |
| Comunicaciones | Bandeja de WhatsApp y de correo |
| Conexiones | WhatsApp, correo y calendario |
| Configuración | Clínica, horarios, equipo, logo |
| Ayuda | Guía por secciones y canal de contacto |
| Plan | Plan de la clínica |

### Módulo Ventas

| Pantalla | Qué hace |
|---|---|
| Ventas · inicio y detalle | Facturas y tiquetes POS |
| Nueva venta | Emisión con catálogo y cálculo de IVA |
| Imprimir | Representación gráfica con CUFE y QR |
| Cartera | Cobranza, antigüedad, casos escalados |
| Catálogo | Servicios y productos, con categorías |
| Inventario | Existencias, movimientos, importación |
| Compras | Proveedores, órdenes, edición |
| Finanzas | Ingresos y egresos |
| Configuración fiscal | Resolución, numeración, datos del emisor |

---

## 2. Inteligencia artificial

### Base de conocimiento

**519.999 chunks** indexados y consultables. *(Ya reconocido cumplido por el cliente.)*

### Recuperación en cascada

Determinística y sin costo de tokens: glosario ES→EN → filtros → léxico y MeSH → vector semántico.
Documentado en `athos-service/CLAUDE.md`.

### Mecanismos que impiden inventar

| Mecanismo | Dónde |
|---|---|
| **Abstención por bandas de evidencia** — `none` / `limited` / `sufficient` | `evidence_judge.py`, medido sobre 188 casos |
| **Verificación de procedencia** — un `[n]` que no está en lo recuperado se descarta | `citations.py`, determinística |
| **Verificación de fidelidad** — ¿el pasaje sostiene lo afirmado? | `citation_fidelity.py` |
| **Sin dosis si faltan datos** (especie, peso, edad) | `dose_guard.py` — en código, no en el prompt |
| **Gate de alergia severa** — bloqueante antes de cualquier plan | Determinístico, desde `allergies` |
| **Ninguna nota entra a la historia sin firma** del veterinario | `clinical_notes.status` + migración 0054: inmutable tras aprobar |

### Capa agéntica

**21 herramientas**: 12 de lectura y **9 ejecutables tras aprobación humana** — enviar WhatsApp,
enviar y responder correo, crear y modificar citas, crear titular y paciente, actualizar ficha.

El asistente está montado en **todas** las pantallas del CRM (`dashboard/layout.tsx`), con el
contexto de la pantalla donde se lo invoca.

### Enrutamiento y respaldo

Cascada entre proveedores por superficie, con registro de qué modelo respondió de verdad y de qué
primario cayó (`athos_agent_usage.fell_back_from`).

> ⚠️ **Estado real al 17-ago:** los logs registran respuestas **sólo de DeepSeek**. Ver la sección 6.

---

## 3. Integraciones operando

| Integración | Estado |
|---|---|
| WhatsApp (Evolution) | Operando · **6.666 mensajes** procesados |
| Correo transaccional (Resend) | Operando · facturas y cobranza |
| Correo del agente (Composio) | Operando · Gmail y Outlook, por persona |
| Calendario (Google) | **3 cuentas** conectadas |
| Supabase | 65 tablas con RLS por clínica |

---

## 4. Datos en producción

| | |
|---|---|
| Clínicas | 16 |
| Usuarios | 18 |
| Titulares / Pacientes | 47 / 49 |
| Consultas | 74 |
| Notas clínicas | 45 (**23 aprobadas**) |
| Citas | 25 |
| Mensajes de WhatsApp | 6.924 |
| Chunks del corpus | 640.193 |

*Medido el 23-ago-2026. Las 16 clínicas son pruebas cerradas del equipo, no clientes en producción.*

---

## 5. Calidad y trazabilidad

- **1.876 pruebas automatizadas** en cada cambio (1.563 del producto y 313 del servicio de IA),
  junto con typecheck, lint y build
- **81 migraciones** versionadas; **17 con script de verificación propio** — obligatorio desde la
  0059, y cada verificación se corre contra el principal después de aplicar
- **Auditoría completa del 16-ago**: 9 hallazgos, los 9 cerrados —
  `docs/AUDITORIA-COMPLETA-2026-08-16.md`
- **Traza de acciones humanas** (migración 0063): quién editó un paciente o canceló una cita, con el
  antes y el después
- **Banco de pruebas del agente**: `docs/AGENT-SMOKE-TESTING.md`, `docs/BANCO-AGENTE-RESULTADO.md`

### Corregido entre el 16 y el 18 de agosto

| | |
|---|---|
| **Citas superpuestas** | 6 dobles reservas medidas; ahora imposible por accidente, con válvula deliberada |
| Facturación inalcanzable | 0 de 15 clínicas tenían servicios en catálogo: entró al onboarding |
| Canales que morían en silencio | WhatsApp caído 5 días sin avisar: ahora es señal visible |
| Contraste ilegible | `fg-faint` reprobaba WCAG AA en 216 usos |
| Índices faltantes | `owners` y `clinical_notes` hacían escaneo completo |

### Corregido entre el 21 y el 23 de agosto

Todo esto salió de **recorrer el producto como lo recorre un cliente**, no de leer el código. Ninguno
fallaba: los cinco pasaban los tests y no aparecían en ningún log.

| | |
|---|---|
| **La nota del Fantasma no se generaba** | El estado decía "Generando nota" y en realidad esperaba un clic. Cuatro consultas quedaron sin nota, de cuatro días distintos |
| **Athos se descubría chocando** | Dos de las tres superficies del copiloto no miraban el plan: una clínica sin Pro recibía un error rojo en vez de la invitación |
| **La edad del paciente discrepaba** | La lista decía 6 meses y la ficha 5, por zona horaria. En un cachorro, la edad en meses ordena el plan de vacunación |
| **El catálogo se leía cortado en 500** | Sin aviso. El export de inventario a Excel salía incompleto pareciendo completo |
| **Cartera se quedaba con mensajes ajenos** | Lo que no era cobranza no llegaba a nadie |

---

## 6. Lo que NO se presenta hoy, y por qué

Dicho antes de que se pregunte.

### Los tres modelos respondiendo

Los logs muestran **sólo DeepSeek**. Claude falló las dos veces que se intentó (2-ago) por falta de
saldo; Gemini nunca aparece. **No es código** —los tres están cableados y no hay exclusión— sino
crédito y variables. Procedimiento en `docs/entrega/1-TRES-MODELOS-como-encenderlos.md`.

**Sí se puede demostrar** que la cascada funciona: hay registro de la caída de Claude a DeepSeek sin
cortar la respuesta.

### Facturación electrónica con validez DIAN

El andamiaje está —UVT, umbral POS, motivos de nota crédito, CUFE y QR en el documento— y hay una
costura lista (`fiscal/factory.ts`) que hoy devuelve un sandbox. **Falta elegir el proveedor fiscal**
y la habilitación ante la DIAN, que es calendario de terceros.

### Política de tratamiento de datos

Redactada y entregada para revisión, **pendiente de nombrar al responsable del tratamiento** —
persona jurídica con NIT, que exige la Ley 1581. Ver `docs/entrega/3-POLITICA-DE-DATOS.md`.

### Onboarding: el flujo entregado

Recorre **clínica → horarios → servicios → primer paciente → datos de ejemplo → equipo**. No incluye
pasos de conexión de calendario ni de WhatsApp — esas dos se configuran desde **Conexiones**, y el
riel de configuración del inicio las señala como pendientes hasta que se hagan.

### Sesión de WhatsApp

Las dos instalaciones duraron **7 y 8 días** antes de expirar. Evolution es WhatsApp Web y la sesión
caduca por diseño del canal. Lo que se agregó es que **el sistema avise** cuando pasa, con los días
que lleva caído.

### Fase II

Ampliación de la capa agéntica por sección, con plazo propio.

---

## 7. Accesos que se otorgan en este acto

| Servicio | Para qué |
|---|---|
| GitHub `plogy-dev/tuvetia` | Código: front + `athos-service` |
| Supabase (principal) | Base de datos de producción |
| Supabase (dev) | Corpus del RAG y desarrollo |
| Vercel | Aplicación web |
| Railway × 2 | Backend de IA y servidor de WhatsApp |
| Entorno desplegado | La aplicación en producción |

El mapa completo de las **15 cuentas** —titular actual, cómo se traspasa cada una y qué se rompe
mientras— está en `docs/traspaso/INVENTARIO.md`.

---

## 8. Documentación entregada

| Documento | Contenido |
|---|---|
| `docs/ARQUITECTURA.md` | Arquitectura del front y por qué |
| `docs/API.md` | Las rutas de API |
| `docs/SEGURIDAD-DB.md` | RLS, `service_role`, advisors |
| `docs/traspaso/RUNBOOK.md` | Desplegar, migrar, rotar credenciales, reconectar WhatsApp |
| `docs/traspaso/INCIDENTES.md` | Fallos conocidos: cuáles son normales y cuáles no |
| `docs/traspaso/INVENTARIO.md` | Las 15 cuentas y cómo se traspasan |
| `docs/traspaso/RESUMEN-EJECUTIVO.md` | Qué es, qué cuesta, a quién llamar |
| `docs/AUDITORIA-COMPLETA-2026-08-16.md` | Los 9 hallazgos con su evidencia |
| `athos-service/CLAUDE.md` | Reglas no negociables del RAG |
| `athos-service/docs/MIGRACIONES.md` | Runbook de migraciones y entornos |
