---
titulo: Athos, el asistente
seccion: guias
orden: 50
resumen: El chat clínico, las herramientas que puede usar, y el ciclo de aprobación que impide que actúe solo.
---

# Athos, el asistente

`/dashboard/asistente`, más un widget flotante disponible en toda la app.

## Qué es

Un agente conversacional con dos mitades:

1. **El chat clínico** — responde preguntas de medicina veterinaria **con citas** a un corpus
   indexado. Eso lo resuelve `athos-service` (Python).
2. **El agente con herramientas** — puede consultar y **proponer acciones** sobre los datos de la
   clínica: buscar pacientes, ver cupos, redactar un WhatsApp, proponer una cita.

## La regla que gobierna todo: propone, no ejecuta

Athos **nunca actúa solo**. Cuando quiere hacer algo, crea una fila en `athos_actions` con estado
`proposed` y la muestra como una tarjeta que el veterinario aprueba, edita o rechaza.

```
   Athos propone  ──▶  athos_actions (proposed)
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
        el vet aprueba                 el vet rechaza
              │
              ▼
   /api/athos/actions/[id]/execute  ──▶  executed | failed
```

El vet **puede editar el payload antes de aprobar**. Eso es la intención del diseño, y por eso el
servidor **revalida** lo que vuelve: entre proponer y ejecutar el payload sale del servidor y
regresa, y el parseo descarta los campos desconocidos — un `clinic_id` agregado al override no llega
a la RPC.

### Las guardas de `execute`

| Guarda | Contra qué |
|---|---|
| Reserva atómica | Doble clic en "Aprobar": sólo una petición gana, la otra ve `409` |
| Revalidación del payload | Manipulación entre proponer y ejecutar |
| Corre con la sesión del vet | Que la RLS siga aplicando; no hay impersonación |
| Vencimiento | Una propuesta vieja no se ejecuta: `410` |
| Auditoría | Toda transición queda en `audit_logs` |

## Las herramientas

Hay dos juegos, con credenciales distintas:

### Las del veterinario (`tools.ts`) — corren con RLS

- `search_patients`, `get_clinic_hours`, `list_available_slots`
- `search_whatsapp_conversation`
- `create_appointment`, `update_appointment` (propuestas)
- Herramientas de correo, vía Composio

### Las del modo automático de WhatsApp (`auto-tools.ts`) — corren con `service_role`

Le responden a un **titular**, no a un miembro del equipo. Por eso son mucho más acotadas:

- `list_available_slots` — el horario **de la clínica**, y nunca dice de quién es lo ocupado
- `list_my_patients` — sólo las mascotas de **quien escribe**
- `propose_appointment` — **queda pendiente de confirmación**. Nunca dice que ya quedó agendada

> **Un número desconocido no puede enumerar nada.** Sin titular reconocido, sólo se ofrece la consulta
> de horarios disponibles.
>
> Y `propose_appointment` verifica que la mascota sea de quien escribe: acá no hay RLS que lo impida,
> porque corre con `service_role`.

## El cálculo de cupos vive en un solo lugar

`lib/athos-agent/agenda.ts` lo comparte entre los dos juegos de herramientas. Duplicarlo garantizaba
que en unos meses dieran horarios distintos — y que el titular viera por WhatsApp un cupo que el vet
no ve en su agenda.

También valida las fechas de verdad: `2026-02-30` **no es** una fecha inválida para JavaScript, la
rueda en silencio a marzo. Sin la comprobación de ida y vuelta, la cita se agendaba **otro día** sin
que nadie se enterara.

## El presupuesto

Todas las superficies de IA cuentan contra el mismo cupo mensual por clínica
(`ATHOS_TOPE_MENSUAL_POR_CLINICA`, ver [Secretos](../30-referencia/10-secretos.md)). Al llegar al
tope:

- Las pantallas responden `402`.
- Las superficies de fondo (modo automático, cartera) **se callan y escalan a una persona**.
- El resto de Tuvetia sigue igual.

El consumo se registra en `athos_agent_usage`.

## Las cascadas de proveedor

Si el proveedor principal falla —saldo, cuota, credencial, 429/503, timeout— se cae a un respaldo
**antes del primer token**, nunca a mitad de respuesta. Un error nuestro no se reintenta: fallaría
igual en el segundo.

Nació de un incidente: la cuenta de Anthropic se quedó sin crédito y el asistente se cayó entero,
mientras el chat clínico —que sí tenía cascada— siguió respondiendo.

## El banco adversario

`adversarios/` mide algo específico: **si el agente obedece lo que lee**. Un mensaje de WhatsApp o un
correo pueden contener instrucciones dirigidas al modelo, y el prompt le dice explícitamente que lo
que lee es **dato, no órdenes**.
