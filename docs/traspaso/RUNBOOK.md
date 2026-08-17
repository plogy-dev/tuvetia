# Runbook — operar Tuvetia

> **Para quién.** El desarrollador que recibe el proyecto. Asume que sabés Next.js y SQL; no asume
> nada sobre este repositorio.
>
> **Cómo se armó.** Leyendo el código y los workflows, y contrastando con lo que de verdad se hizo
> con las migraciones `0059`–`0064`. Donde la documentación vieja contradice la práctica, manda la
> práctica y se dice cuál era el error.

---

## ⚠️ Las tres cosas que rompen producción

Léelas antes de tocar nada. Las tres están documentadas mal en algún otro sitio del repo.

### 1. `supabase db push` contra el proyecto principal

El principal lleva su propio historial en `supabase_migrations.schema_migrations` con **55 entradas
del equipo original** y **ninguna** con nuestra numeración `00XX`. Un `db push` no reconoce ese
historial: intenta reconciliar dos numeraciones distintas contra una base con datos clínicos reales.

**Las migraciones de este repo se aplican A MANO**, por el editor SQL. Ver la sección de migraciones.

> `athos-service/docs/MIGRACIONES.md` lo **recomendaba** —contradiciendo su propia sección de reglas
> duras dos párrafos más abajo— y se corrigió el 2026-08-17.

### 2. Rotar `WHATSAPP_TOKEN_KEY` como si fuera una API key

**No lo es: es una llave de cifrado.** Cifra `whatsapp_integrations.access_token_enc`. Rotarla deja
los tokens guardados indescifrables y no da error hasta que alguien intenta mandar un mensaje.

Si hay que rotarla: rotar **y reconectar WhatsApp**, en ese orden y avisando a las clínicas.

### 3. Cambiar `CRON_SECRET` en un solo lugar

Vive en **dos**: las variables de entorno de Vercel y los **secretos de GitHub Actions**. Cambiar uno
solo deja dos de los cuatro crons devolviendo 401 — y como los workflows usan `--fail-with-body`, se
ven en rojo, que al menos avisa.

---

## Aplicar una migración

El flujo real, el que se usó de la `0059` en adelante:

1. **Reservar el número.** Mirá el último de `athos-service/supabase/migrations/` **en `master`** —
   no en tu rama— y tomá el siguiente. Acá no se pone un número concreto a propósito: la versión
   anterior de este documento decía "la próxima es `0065`" y para cuando alguien lo leyó ya estaba
   tomado tres veces.
2. **Escribir el `.sql`** con formato `NNNN_nombre_en_snake_case.sql`.
3. **Escribir su verificación** en `athos-service/supabase/verificaciones/`. No es opcional: es lo
   único que confirma que la migración hizo lo que dice.
4. **PR y revisión.**
5. **Aplicar a mano**: editor SQL del proyecto principal → pegar la migración → ejecutar.
6. **Correr la verificación** en el mismo editor.

### El número no puede estar repetido

Ya chocó **tres veces** —`0019`, `0020` y `0065`—, la última con dos personas trabajando en paralelo
el mismo día. Con las migraciones aplicándose a mano, dos archivos con el mismo número hacen ambiguo
el orden: "aplicá la 65" deja de tener una respuesta.

`src/lib/__tests__/numeracion-de-migraciones.test.ts` **falla en CI** si aparece un número repetido
nuevo. Los tres históricos están declarados ahí como excepción y **no se renombran**: ya se aplicaron
con ese nombre, y renombrarlos haría que el repo afirme algo que no ocurrió.

Para **intercalar** entre dos que ya existen, usá el sufijo de letra: `0021b_…` corre después de la
`0021` y antes de la `0022`.

### Cómo se lee el resultado de una verificación

Terminan con `raise exception '=== 00XX OK === ...'`. **Un error `P0001` con el texto `OK` es el
éxito.** Es a propósito: el `raise` aborta el bloque y hace rollback de los datos de prueba que la
verificación creó, así que nada queda en la base.

Cualquier otro mensaje es un fallo real y dice qué falló.

### La regla que no se negocia

Ninguna herramienta con escritura apuntada al principal. El MCP de Supabase, en particular, se
configura **de sólo lectura** contra el principal, o apuntando a dev. Está en
`athos-service/CLAUDE.md` y sobrevive al traspaso.

---

## Desplegar

### El front (Vercel)

`push` a `master` → Vercel construye y despliega. No hay paso manual.

**Las variables `NEXT_PUBLIC_*` se incrustan en el build.** Cambiar una en el panel de Vercel no hace
nada hasta que haya un despliegue nuevo. Si cambiás una y no ves el efecto, es esto: **Deployments →
el último → ⋯ → Redeploy**.

### El backend (Railway)

Dos servicios en Railway, y confundirlos es un clásico:

| Servicio | Qué es | Configuración |
|---|---|---|
| `athos-service` | FastAPI: chat clínico, RAG, Modo Fantasma | *Root Directory* = `athos-service/`, Nixpacks, healthcheck en `/health` |
| Evolution | Contenedor de WhatsApp (open source) | Imagen propia, sin código nuestro |

`athos-service/railway.json` fija el arranque (`uvicorn app.main:app`), el healthcheck y el reinicio
automático ante fallo (3 intentos).

---

## Los cuatro crons, en dos lugares

Vercel Hobby permite **dos** crons diarios. Por eso los otros dos viven en GitHub Actions — no es
desorden, es el límite del plan.

| Cron | Dónde vive | Horario (UTC) | Hora Colombia | Qué hace |
|---|---|---|---|---|
| `purge-audio` | `vercel.json` | `0 3 * * *` | 22:00 (día anterior) | Borra el audio de consultas vencido (retención 4 días, Ley 1581) |
| `cartera` | `vercel.json` | `0 14 * * *` | 09:00 | Barrido de cobranza |
| `briefing` | `.github/workflows/briefing-diario.yml` | `30 11 * * *` | **06:30** | Redacta el resumen del día |
| `cartera` (sweep) | `.github/workflows/cartera-sweep.yml` | `*/15 12-23 * * *` | cada 15 min, 07:00–18:00 | El **mismo** endpoint de cobranza |

### 🟡 Los dos de cartera son el mismo endpoint

`/api/cron/cartera` lo llaman los dos. El sweep de GitHub corre cada 15 minutos entre 12 y 23 UTC,
que **incluye** las 14:00 del cron de Vercel — así que el de Vercel **no aporta nada** y está
ocupando uno de los dos cupos de Hobby.

Liberarlo permitiría mover el briefing a Vercel, o dejar el cupo para algo nuevo. No lo cambié: es
una decisión de operación, y quien opere debería tomarla sabiendo esto.

### 🟡 Los workflows tienen el dominio escrito a mano

`https://tuvetia.vercel.app`, literal, en los dos. **Si el dominio cambia en el traspaso —dominio
propio, o cuenta de Vercel nueva— los crons dejan de funcionar.** Fallan en rojo, que avisa, pero hay
que acordarse de cambiarlos.

### Si un cron sale rojo

1. El job de GitHub muestra el cuerpo de la respuesta (`--fail-with-body`), así que el error está ahí.
2. **401** → `CRON_SECRET` desincronizado entre Vercel y los secretos de Actions.
3. **503** → falta una variable de entorno; el cuerpo dice cuál.
4. **500** → mirar los logs de Vercel de esa función. Ojo: en Hobby la retención es corta.

---

## Rotar una credencial

El orden importa y es siempre el mismo:

1. Emitir la clave nueva en el proveedor **sin revocar la vieja**.
2. Cargarla en Vercel (y/o Railway).
3. **Redesplegar** si es `NEXT_PUBLIC_*`.
4. Verificar que funciona (ver abajo).
5. **Recién ahí** revocar la vieja.

Invertir 4 y 5 es cómo se produce una caída que nadie entiende.

Excepciones: `WHATSAPP_TOKEN_KEY` (ver arriba) y `CRON_SECRET` (dos lugares).

---

## Reconectar WhatsApp cuando se cae

**Que se caiga es normal, no es un fallo.** Evolution es WhatsApp Web: la sesión expira sola, y en
producción se midió que dura alrededor de una semana.

Desde el 2026-08-16 **el producto lo avisa**: aparece como señal "WhatsApp desconectado" en el riel
del dashboard, en la tira de móvil, en el prompt de Athos y en el briefing diario, con cuántos días
lleva. El botón del riel lleva directo a Conexiones.

Para reconectar: **Configuración → Conexiones → Conectar**, y escanear el QR con el teléfono de la
clínica.

Mientras está caído: no entran ni salen mensajes, cartera no manda recordatorios y la herramienta
`send_whatsapp_message` de Athos falla al aprobar la acción — con un mensaje que lo dice, no en
silencio.

---

## Verificar que todo está vivo

### La comprobación completa, en un comando

El workflow **`smoke`** de GitHub Actions llama a `/api/health` con el secreto y falla si falta
cualquier variable crítica. Es la verificación de configuración más rápida que hay: correlo desde la
pestaña Actions.

`/api/health` responde **sólo booleanos** — nunca un valor, ni un prefijo, ni una longitud. Se puede
consultar sin miedo a filtrar nada.

### Qué mirar después de un cambio grande

| Qué | Cómo se ve que está bien |
|---|---|
| Configuración | `smoke` en verde → `missing: []` |
| Backend de IA | `GET <NEXT_PUBLIC_ATHOS_URL>/health` responde 200 |
| Evolution | `curl -H "apikey: <EVOLUTION_API_KEY>" <EVOLUTION_BASE_URL>/instance/fetchInstances` → 200 |
| Athos de punta a punta | Abrir `/dashboard/asistente` y hacer una pregunta clínica |
| Los crons | Las últimas corridas en Actions, en verde |
| La base | Los *advisors* de Supabase sin nada nuevo en rojo |

---

## Valores escritos a mano que hay que cambiar en el traspaso

No son variables de entorno: están **en el código o en los workflows**, así que no aparecen en ningún
panel y nadie los va a encontrar buscando en Vercel.

| Dónde | Qué es | Por qué importa |
|---|---|---|
| `src/lib/landing/contact.ts:6` | `WHATSAPP_NUMBER = "573146624108"` | El número de contacto **real**. El comentario del archivo lo llama "placeholder" y no lo es |
| `src/lib/landing/contact.ts:9` | `MEET_SCHEDULING_URL` → `calendly.com/tuvetia` | Una cuenta de Calendly que también hay que traspasar |
| `.github/workflows/briefing-diario.yml:46` | `https://tuvetia.vercel.app` | Si cambia el dominio, **el briefing deja de correr** |
| `.github/workflows/cartera-sweep.yml:50` | idem | Y la cobranza también |
| `.github/workflows/smoke.yml:25,47` | idem | La verificación apuntaría al sitio viejo |

### 🟡 Y un detalle de producto que conviene arreglar de paso

El botón "escribinos" de la página de **Ayuda** usa `WA_GENERIC_MESSAGE`, que dice *"Hola, vengo de la
página de TU VET IA. Quiero agendar una demo."*

Ese es un mensaje de **ventas**, y la página de Ayuda la abre un cliente que **ya compró** y tiene un
problema. Un veterinario con la pantalla rota manda "quiero agendar una demo". Conviene un mensaje
propio para soporte.

---

## Dónde está el resto

| Documento | Para qué |
|---|---|
| `docs/traspaso/INVENTARIO.md` | Las quince cuentas, quién es titular y cómo se traspasa cada una |
| `docs/ARQUITECTURA.md` | Cómo está armado el front y **por qué** |
| `docs/API.md` | Las 22 rutas de `src/app/api/` |
| `docs/SEGURIDAD-DB.md` | RLS, `service_role` y los advisors |
| `docs/CONFIGURACION-PRODUCCION.md` | Qué variable va dónde. **Ojo: escrito el 31-jul y desactualizado** |
| `docs/AUDITORIA-COMPLETA-2026-08-16.md` | Los nueve hallazgos, cerrados, con su evidencia |
| `athos-service/CLAUDE.md` | Las reglas no negociables del RAG. Léelo antes de tocar `athos-service` |
