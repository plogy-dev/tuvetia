# Correo masivo de una clínica a sus clientes

**Estado:** evaluado el 2026-08-22. **Paso 1 (la baja) construido**; el resto, sin construir. Decisión de Felipe: es lo que se quiere.
**Recomendación de tiempo:** arrancarlo **después de la entrega del lunes 24**. Abajo, por qué.

---

## Lo que YA está resuelto (no hay que volver a decidirlo)

La cartera **ya le escribe a los titulares por correo**, así que media función existe:

| Pieza | Dónde está | Qué resuelve |
|---|---|---|
| Transporte | `lib/email/resend.ts` | Resend por REST, sin SDK |
| Identidad del remitente | `lib/email/transactional.ts` + `CORREOS.md` | sale de `vet@tuvetia.com`, **firmado con el nombre de la clínica** y `Reply-To` a sus administradores |
| Fallo transitorio vs. de configuración | `sendTransactionalEmail` | un 429 se reprograma; un dominio sin verificar, no |
| Hilo de conversación | `lib/email/threading.ts` | `Message-ID` propio: la respuesta del titular entra a la conversación |
| Ritmo, tope y reintento | `app/admin/usuarios/actions.ts` | el molde del masivo de plataforma, ya medido contra el reloj de la función serverless |
| Plantillas + vista previa | `lib/email/plantillas.ts` (PR #186) | y el candado de que el preview no mienta |

**La pregunta más grande —qué dominio remite— ya tiene respuesta**, y es la correcta: el dominio es de
Tuvetia, verificado una vez, y la clínica aparece en el nombre y en el `Reply-To`. Pedirle a cada
clínica que verifique su propio dominio (SPF/DKIM) sería la alternativa "más pro" y es la forma más
segura de que la función no se use nunca.

---

## Las tres decisiones que faltan

### 1. Base legal — la que manda sobre todo lo demás

`consents` **no sirve para esto**: es el consentimiento de **grabación** de la consulta
(`owner_scope`, `revoked_at`, `text_version`). Mezclarle un alcance de comunicaciones rompería el
consentimiento clínico, que es el que sostiene el Modo Fantasma. **No tocarla.**

Lo que sí distingue el tamaño del problema:

- **Operativo** (vacuna que vence, control post-quirúrgico, recordatorio de cita, cambio de horario
  de la clínica): se apoya en la relación que el titular ya tiene con la clínica. Es lo mismo que la
  cartera hace hoy.
- **Comercial** (promoción, descuento, "volvé a visitarnos"): exige base legal bajo la **Ley 1581**,
  registro de consentimiento y su prueba.

**Recomendación: lanzar sólo con lo operativo**, igual que se acotó el masivo de plataforma. Es el
80% del valor —la clínica quiere avisar de vacunas— con el 10% del riesgo. Lo comercial queda como
una segunda fase con su propio registro de consentimiento.

### 2. La baja (`unsubscribe`)

Hace falta **aunque el contenido sea operativo**: la Ley 1581 le da al titular el derecho a revocar,
y sin enlace de baja el correo entra en carpeta de promociones o en spam, que es peor que no
mandarlo.

Es lo único que necesita **esquema nuevo**. Propuesta mínima:

```sql
create table public.owner_email_optout (
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  owner_id   uuid not null references public.owners(id) on delete cascade,
  -- El correo, además del owner_id: si la ficha cambia de correo, la baja del anterior no debe
  -- migrar sola al nuevo — es otra dirección y otra persona posible.
  email      text not null,
  motivo     text,
  created_at timestamptz not null default now(),
  primary key (clinic_id, owner_id, email)
);
```

Y una ruta **pública** `/baja/[token]` — sin sesión, porque quien se da de baja no tiene cuenta. El
token va firmado (`lib/crypto.ts` ya existe), no es el `owner_id` en la URL.

**La baja se respeta en el envío, no en la interfaz**: la consulta que arma la audiencia excluye por
`owner_email_optout`, y el envío vuelve a comprobar. Una lista armada hace diez minutos puede tener
adentro a alguien que se dio de baja hace cinco.

### 3. Rebotes

Un masivo sin manejo de rebotes quema la reputación del dominio — y el dominio es **uno solo para
todas las clínicas**, así que una clínica con una lista sucia le arruina la entregabilidad a las
demás. Esto no es teórico: es la razón por la que este punto no puede quedar "para después".

Resend manda webhooks de `bounced` y `complained`. Mínimo: marcar la dirección y dejar de mandarle.

---

## Orden sugerido

1. ~~**La baja primero.**~~ **HECHO el 22-ago** (migración 0077, `lib/email/baja.ts`,
   `/baja/[token]`). Falta una sola cosa cuando exista el envío: **poner el enlace en el pie**, y
   que el envío llame a `sinLosDeBaja`. La función ya está escrita y probada; nadie la usa todavía
   porque todavía no hay masivo a clientes.
2. **La audiencia acotada.** "Titulares con paciente activo", "con vacuna vencida", "sin visita en
   N meses". Que la clínica NO pueda escribir "todos" sin ver a cuántos le va a llegar.
3. **El envío**, reusando el molde del masivo de plataforma: tope, ritmo, reintento, traza por
   destinatario.
4. **Los rebotes**, con el webhook de Resend.

## Por qué después del lunes

No es que sea difícil: es que **el punto 1 y el 3 tienen consecuencias que no se deshacen**. Una baja
que no se respeta o un rebote que no se atiende no se arreglan con un PR al día siguiente —se
arreglan pidiéndole perdón a un cliente, o esperando semanas a que el dominio recupere reputación.

Y el dominio es compartido entre todas las clínicas.

Dos días antes de una entrega, con la agenda ocupada por otras cosas, es exactamente el peor momento
para tocar la reputación del único dominio que le manda correo a todos los clientes de todos.

## Fuera de alcance

- **Métricas de apertura y clics.** Exigen píxel de rastreo y reescritura de enlaces: más datos
  personales, más superficie legal. No hacen falta para avisar de una vacuna.
- **Editor visual de plantillas.** Las cuatro plantillas con huecos de #186 cubren el caso; un
  editor es producto, no infraestructura.
- **Programar envíos a futuro.** Necesita una cola de verdad, y los dos cupos de cron del plan Hobby
  de Vercel ya están usados.
