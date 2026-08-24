-- El texto de los recordatorios de cobranza deja de ser el mismo para todo el país.
--
-- ── DE DÓNDE SALE ─────────────────────────────────────────────────────────────────────────────
--
-- Del documento de cambios del cliente (24-ago): «plantillas de WhatsApp predeterminadas
-- configurables por veterinario (no genéricas para todos)». Hasta hoy el texto vivía escrito a mano
-- en `src/lib/cartera/scheduler.ts`, así que todas las clínicas mandaban exactamente el mismo
-- mensaje, con el mismo tono y sin el nombre de nadie.
--
-- ── POR QUÉ UNA COLUMNA jsonb Y NO UNA TABLA ──────────────────────────────────────────────────
--
-- Son CINCO textos —uno por paso de la política de recordatorios—, de la misma clínica, que se leen
-- todos juntos en el mismo momento (el barrido diario arma el mensaje) y se guardan todos juntos
-- desde la misma pantalla. Una tabla `reminder_templates(clinic_id, step_kind, body)` obligaría a
-- cinco filas, a un upsert por fila y a preguntarse qué pasa cuando tres entran y dos no.
--
-- Y ya hay precedente en esta misma tabla: `reminder_policy` es jsonb por la misma razón.
--
-- ── NULL ES «LOS DE POR DEFECTO», Y ESO IMPORTA ───────────────────────────────────────────────
--
-- La columna arranca en NULL y NO se rellena con los textos actuales. Si se copiaran, el día que se
-- mejore la redacción por defecto —una corrección de estilo, un cambio que pida la Ley 2300— las
-- clínicas que nunca tocaron nada se quedarían congeladas en la versión vieja, sin saberlo.
--
-- Con NULL, «no elegí» y «elegí exactamente esto» son estados distintos, que es lo que son.
--
-- El objeto guarda sólo los pasos que la clínica cambió: `{"RECORDATORIO_1": "…"}` es válido y los
-- otros cuatro siguen cayendo al de por defecto.
--
-- ── LA FORMA NO SE VALIDA ACÁ, Y ES DELIBERADO ────────────────────────────────────────────────
--
-- Un CHECK sobre jsonb podría exigir que las claves sean pasos conocidos, pero NO puede exigir lo
-- que de verdad importa: que el texto conserve `{number}` y `{link}`, sin los cuales el mensaje se
-- envía pero no sirve. Esa revisión vive en `lib/cartera/plantillas.ts` con sus pruebas, y la
-- lectura es defensiva —lo que no se entiende se ignora y ese paso usa su texto por defecto—
-- porque un recordatorio que no sale por un json raro es plata que no se cobra.
--
-- Aplicar en el principal (`auxlnexhkmtoedrzfsnz`). Reversible: se borra la columna.

alter table public.billing_settings
  add column if not exists reminder_templates jsonb;

comment on column public.billing_settings.reminder_templates is
  'Texto de los recordatorios de cobranza de esta clínica, por paso: {"RECORDATORIO_1": "…"}. NULL o paso ausente = el texto por defecto de lib/cartera/plantillas.ts. Los huecos válidos son {number}, {balance} y {link}.';
