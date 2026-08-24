---
titulo: Qué es Tuvetia
seccion: empezar
orden: 10
resumen: El producto, las piezas de las que está hecho y cómo se relacionan. Empezá por acá.
---

# Qué es Tuvetia

Tuvetia es un **software de gestión para clínicas veterinarias**, multi-inquilino: muchas clínicas
usan la misma instalación y ninguna ve los datos de otra. Cubre el ciclo completo de una clínica
—pacientes, agenda, consulta clínica, comunicación con el titular y facturación— y encima de todo
eso corre **Athos**, un asistente de IA con acceso a literatura veterinaria.

## Los cuatro conceptos que hay que tener claros antes de leer nada más

| Concepto | Qué es | Dónde vive |
|---|---|---|
| **Clínica** (`clinics`) | El inquilino. Todo dato pertenece a una y sólo una. | `clinic_id` en casi todas las tablas |
| **Perfil** (`profiles`) | Una persona del equipo. Pertenece a una clínica y tiene un rol. | espeja `auth.users` |
| **Titular** (`owners`) | El cliente: la persona dueña de las mascotas. **No tiene cuenta.** | `owners` |
| **Paciente** (`patients`) | El animal. Pertenece a un titular. | `patients` |

La confusión más común es entre **perfil** y **titular**. Un perfil es quien *usa* Tuvetia (un
veterinario, un administrador); un titular es a quien la clínica *atiende*. Un titular nunca entra
al sistema: recibe correos, WhatsApp e invitaciones de calendario, y ve informes por enlaces con
token.

## Las piezas

```
                          ┌──────────────────────────┐
   navegador ────────────▶│  Next.js 16 (Vercel)     │
                          │  app + API routes        │
                          └───┬───────────┬──────────┘
                              │           │
              ┌───────────────┘           └──────────────┐
              ▼                                          ▼
   ┌────────────────────────┐              ┌──────────────────────────┐
   │ Supabase (Postgres)    │              │ athos-service (Railway)  │
   │ auth · RLS · storage   │              │ FastAPI · RAG clínico    │
   └────────────────────────┘              └──────────────────────────┘
              ▲                                          ▲
              │                                          │
   ┌──────────┴───────────────────────────────────────────┴──────────┐
   │  Integraciones: Composio (correo y calendario) · WhatsApp       │
   │  (Meta / Evolution / Kapso) · Wompi (pagos) · Resend (correo)   │
   └─────────────────────────────────────────────────────────────────┘
```

### 1. La aplicación Next.js

Es el producto. Vive en `src/` y se despliega en Vercel. Contiene:

- **`src/app/(marketing)`** — la landing pública, la página de producto, seguridad y demo.
- **`src/app/dashboard`** — el producto para las clínicas. Requiere sesión.
- **`src/app/admin`** — el panel interno de Tuvetia. Ajeno al producto: se entra por una allowlist
  de correos, no por el rol de una clínica.
- **`src/app/api`** — las rutas HTTP: webhooks, crons, acciones del agente, integraciones.

### 2. Supabase

Postgres gestionado, y **la frontera de seguridad real del sistema**. No es sólo la base:

- **Auth** — las sesiones. `profiles.id` es el mismo uuid que `auth.users.id`.
- **RLS (Row Level Security)** — el aislamiento entre clínicas se aplica *en la base*, no en el
  código. Ver [Multi-inquilino y RLS](../40-explicacion/10-multitenant-y-rls.md).
- **Storage** — audios de consulta, adjuntos de paciente, logos.

### 3. athos-service

Un servicio **Python/FastAPI** aparte, desplegado en Railway (`athos-service/`). Es el motor
clínico: ingesta un corpus de literatura veterinaria, lo indexa y responde preguntas con citas. La
app Next lo consulta por HTTP (`NEXT_PUBLIC_ATHOS_URL`).

Que sea un servicio aparte no es capricho: la ingesta y el RAG son trabajo de Python, y tienen su
propio ciclo de despliegue y su propio presupuesto de memoria.

### 4. Las integraciones

Cada una está documentada en [Servicios externos](../30-referencia/20-servicios-externos.md):

- **Composio** — correo y calendario de cada miembro, sin que Tuvetia guarde tokens OAuth.
- **WhatsApp** — tres proveedores posibles: Meta Cloud API (oficial), Evolution (no oficial,
  autoalojado) y Kapso (legado).
- **Wompi** — cobros y suscripciones (Colombia).
- **Resend** — correo transaccional: facturas y cobranza.
- **Sentry** — errores.

## Los dos planes

Tuvetia es gratis para todo el CRM y cobra por la IA. La lista de qué es de pago vive en **un solo
archivo**, [`src/lib/planes/index.ts`](../30-referencia/50-roles-y-permisos.md), y el criterio no
es "¿es una función avanzada?" sino **¿gasta plata cada vez que se usa?**

| Plan | Qué incluye |
|---|---|
| `free` | Todo el CRM: pacientes, titulares, agenda, consultas, facturación, inventario, WhatsApp manual. Sin límite de tiempo. |
| `pro`  | Además, las siete capacidades de IA: chat de Athos, Modo Fantasma, sugerencia de WhatsApp, WhatsApp automático, cartera con IA, receta por foto y briefing diario. |

Eso importa porque hay IA corriendo **dentro** de secciones gratis (el modo automático de WhatsApp,
el barrido de cartera). Si el corte fuera por pantalla, una clínica gratis seguiría gastando IA en
las dos superficies que gastan *sin que nadie las mire*.

## Dónde seguir

- ¿Vas a levantarlo? → [Levantar el proyecto](20-levantar-el-proyecto.md)
- ¿Buscás un archivo? → [Mapa del repositorio](30-mapa-del-repositorio.md)
- ¿Vas a configurar un entorno? → [Secretos y variables](../30-referencia/10-secretos.md)
- ¿Querés entender el aislamiento? → [Multi-inquilino y RLS](../40-explicacion/10-multitenant-y-rls.md)
