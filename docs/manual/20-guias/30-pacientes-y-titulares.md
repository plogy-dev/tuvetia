---
titulo: Pacientes y titulares
seccion: guias
orden: 30
resumen: El CRM clínico: quién es quién, qué guarda cada ficha y cómo se importan datos de otro sistema.
---

# Pacientes y titulares

## La distinción que hay que tener clara

| | **Titular** (`owners`) | **Paciente** (`patients`) |
|---|---|---|
| Qué es | La persona dueña de las mascotas | El animal |
| ¿Tiene cuenta? | **No.** Nunca entra a Tuvetia | — |
| Cómo se comunica | WhatsApp, correo, invitaciones de calendario, enlaces con token | — |
| Relación | Uno tiene muchos pacientes | Pertenece a un titular |

Un titular no es un usuario del sistema: es un cliente de la clínica. Los usuarios son los
**perfiles** del equipo.

## Titulares — `/dashboard/owners`

Guarda nombre, teléfono, correo, documento, dirección y notas.

- **El correo importa más de lo que parece:** sin él no se le puede invitar a las citas del
  calendario, no le llegan las facturas y el canal EMAIL de cobranza no lo alcanza. La cita se crea
  igual, pero sin invitación.
- El teléfono es lo que ata al titular con su hilo de WhatsApp. La coincidencia se hace por los
  **últimos 10 dígitos**, para no depender de cómo esté escrito el prefijo.

Al borrar un titular hay una migración dedicada a que no falle (`0064_borrar_un_titular_no_falla`):
las referencias desde citas y facturas se resuelven en vez de bloquear la operación.

## Pacientes — `/dashboard/patients`

La ficha reúne:

| Bloque | Qué guarda |
|---|---|
| Datos | Nombre, especie, raza, sexo (`male` / `female` / `unknown`), fecha de nacimiento, `is_deceased` |
| Alergias | Con severidad (`mild` / `moderate` / `severe`) |
| Medicaciones | Tratamientos |
| Vacunas | Con `next_dose_at`, que alimenta la cifra "vacunas por vencer" |
| Consultas | El historial clínico |
| Citas | Las de ese paciente |
| Adjuntos | Archivos |
| Resumen clínico | Redactado, con IA |

### Las alergias no son decorativas

Se cruzan con lo que Athos propone: la nota del **Modo Fantasma** resalta los alérgenos registrados
dentro del plan. Es una de las guardas clínicas del sistema.

### La fila de cifras

Pacientes tiene su propia tira de cuatro cifras, con la misma mecánica de vista rápida que el
tablero: `pacientes-activos`, `citas-hoy`, `consultas-revision`, `pacientes-nuevos-mes`.

`pacientes-activos` filtra `is_deceased = false`, **igual que su detalle**. La tarjeta decía
"Pacientes activos" y contaba todos: hoy no se nota porque no hay ninguno marcado, y el día que lo
haya la cifra habría empezado a mentir sin que nada fallara.

## Importar desde otro sistema

`/dashboard/patients/import`

Acepta un archivo (CSV / Excel) y lo mapea a las columnas de Tuvetia. Las importaciones quedan
registradas en `import_batches`, así que se puede saber de dónde salió cada fila.

La lógica de mapeo de columnas está en `src/lib/importar/` y tiene tests: adivinar mal una columna
mete un teléfono en el campo del documento sin que nada falle.

## Exportar todo

`/api/export` devuelve **todos** los datos de la clínica en JSON abierto: pacientes, titulares,
consultas, transcripciones, notas, citas y mensajes. Está en Configuración → Tus datos.

Es una decisión de producto explícita, no una casilla que llenar: los datos son del cliente y se los
puede llevar cuando quiera, sin pedirle permiso a nadie.

## Datos de demostración

`/api/onboarding/demo-data` crea un juego de datos de ejemplo (y `DELETE` los borra). Sirve para que
una clínica nueva vea la app con contenido antes de cargar lo suyo.
