---
titulo: Tareas programadas
seccion: referencia
orden: 60
resumen: Los crons de Vercel, por qué sólo hay dos, y cuál de ellos tiene consecuencias legales si no corre.
---

# Tareas programadas

## Lo que está programado

`vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/purge-audio", "schedule": "0 3 * * *" },
    { "path": "/api/cron/cartera",     "schedule": "0 14 * * *" }
  ]
}
```

**Sólo dos.** El plan Hobby de Vercel permite dos crons, y los dos están usados. Esa restricción
explica una decisión que de otro modo parecería rara: el **barrido de renovación de suscripciones
corre dentro del cron de cartera**, no en el suyo.

## Autenticación

Los cuatro endpoints exigen `CRON_SECRET`. **Si la variable no está, devuelven `503`** — no corren a
ciegas.

Generarlo con:

```bash
openssl rand -base64 32
```

---

## `/api/cron/purge-audio` — 03:00 diario

**Qué hace.** Borra el audio de las consultas a los **4 días**.

**Por qué importa más que los otros.** Es una obligación de retención de datos: la **Ley 1581**
(protección de datos personales, Colombia). Si este cron no corre, se incumple **en silencio** — no
hay ningún síntoma visible en el producto. Nadie se entera hasta una auditoría.

Es el motivo por el que `CRON_SECRET` no es opcional y por el que su ausencia produce un `503`
ruidoso en vez de un no-op.

> Al revisar un despliegue nuevo, éste es el primero que hay que confirmar que corre.

---

## `/api/cron/cartera` — 14:00 diario

**Qué hace.** Dos cosas:

1. **Cobranza.** Recorre las facturas vencidas, manda recordatorios por los canales autorizados y
   clasifica las respuestas del cliente.
2. **Renovación de suscripciones.** Cobra las que vencen, vía Wompi.

**Kill-switch.** `CARTERA_MESSAGING_SIMULATED=1` hace que el motor **no envíe nada real**. Sirve para
probar el módulo sin escribirle a un cliente.

**Si no corre.** No salen recordatorios y no se renuevan las suscripciones. Se nota, a diferencia de
la purga.

---

## `/api/cron/briefing`

**Existe como ruta, pero no está en `vercel.json`.** Genera el resumen diario redactado de la clínica
(`clinic_briefings`), que es una de las capacidades de plan Pro.

Si se quiere que corra automáticamente, hay que **liberar un espacio de cron** (subir de plan en
Vercel, o meterlo dentro de otro como se hizo con suscripciones).

---

## `/api/cron/suscripciones`

**Existe como ruta, pero no tiene programación propia**: lo invoca el de cartera. Está separado para
poder ejecutarlo a mano y para que su lógica sea testeable por su cuenta.

---

## Resumen

| Ruta | Programado | Consecuencia de que no corra |
|---|---|---|
| `purge-audio` | ✅ 03:00 | **Incumplimiento legal, en silencio** |
| `cartera` | ✅ 14:00 | No sale cobranza ni se renuevan suscripciones |
| `briefing` | ❌ | No hay resumen diario |
| `suscripciones` | ❌ (dentro de cartera) | — |

## Cómo probar uno a mano

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
     https://<dominio>/api/cron/purge-audio
```

Sin la cabecera correcta la ruta rechaza. Contra producción, tener en cuenta que **hacen cosas
reales**: la purga borra audio de verdad y cartera manda mensajes de verdad, salvo que
`CARTERA_MESSAGING_SIMULATED` esté puesta.
