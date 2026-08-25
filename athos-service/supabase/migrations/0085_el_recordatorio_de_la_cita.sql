-- Recordatorio de cita al titular: la decisión de la clínica, y la marca de que ya salió.
--
-- ── DE DÓNDE SALE ─────────────────────────────────────────────────────────────────────────────
--
-- Del documento de cambios (24-ago), punto de Santiago: «confirmaciones y recordatorios de citas
-- por WhatsApp (no solo correo) — es la vía principal en Colombia». No existía NADA: la máquina de
-- envío está entera desde hace semanas, pero cableada sólo a facturas.
--
-- El cuándo lo decidió Felipe el 25-ago: **24 horas antes**, y configurable.
--
-- ── ARRANCA APAGADO, Y ES DELIBERADO ──────────────────────────────────────────────────────────
--
-- `false` por defecto. Encender mensajes automáticos hacia los clientes de una clínica que no lo
-- pidió sería hablar en su nombre — y en Colombia, además, tratar datos personales para una
-- finalidad que el titular no autorizó (Ley 1581). Que cada clínica lo encienda es la única forma
-- honesta.
--
-- ── LA GRANULARIDAD ES EL DÍA, Y HAY QUE DECIRLO ──────────────────────────────────────────────
--
-- `recordatorio_citas_horas` se guarda en HORAS porque así se piensa y así se pidió, pero el
-- barrido corre UNA VEZ AL DÍA (cuelga del cron de cartera de las 9 a. m. — el plan de Vercel da
-- dos crons diarios y los dos están usados). O sea que 24 se cumple como «la mañana anterior», no
-- como 24 horas exactas: para una cita de mañana a las 10, el mensaje sale hoy a las 9.
--
-- Se guarda en horas igual, y no en días, porque el día que haya un barrido más frecuente el dato
-- ya está en la unidad correcta y no hay que migrar nada. La pantalla dice cuándo sale de verdad.
--
-- ── POR QUÉ LA MARCA VA EN LA CITA ────────────────────────────────────────────────────────────
--
-- `recordatorio_enviado_en` en `appointments` es lo que hace el envío EXACTAMENTE UNA VEZ. Un cron
-- se reintenta —Vercel reintenta, y alguien puede correrlo a mano— y sin esta marca el titular
-- recibiría el mismo recordatorio dos o tres veces. Molesto siempre; y con la Ley 2300 encima, un
-- problema.
--
-- Va como columna y no como tabla de envíos porque la pregunta que hay que responder es «¿a esta
-- cita ya se le avisó?», que es un dato DE LA CITA. La traza de qué se mandó ya vive en
-- `whatsapp_messages`.
--
-- Aplicar en el principal (`auxlnexhkmtoedrzfsnz`). Reversible: se borran las tres columnas.

alter table public.clinics
  add column if not exists recordatorio_citas_activo boolean not null default false,
  add column if not exists recordatorio_citas_horas integer not null default 24,
  add column if not exists recordatorio_citas_texto text;

-- Un recordatorio que sale con 0 horas de anticipación llega cuando el titular ya está en la
-- puerta, y uno con 500 llega tres semanas antes de la cita: las dos cosas son errores de tecleo,
-- no configuraciones.
alter table public.clinics
  drop constraint if exists clinics_recordatorio_horas_razonables;

alter table public.clinics
  add constraint clinics_recordatorio_horas_razonables
  check (recordatorio_citas_horas between 1 and 168);

alter table public.appointments
  add column if not exists recordatorio_enviado_en timestamp with time zone;

-- El barrido busca citas del día objetivo que todavía no tienen aviso. Sin el índice, cada corrida
-- recorre la tabla entera de citas de la clínica.
create index if not exists appointments_recordatorio_pendiente_idx
  on public.appointments (clinic_id, starts_at)
  where recordatorio_enviado_en is null;

comment on column public.clinics.recordatorio_citas_activo is
  'Si la clínica manda recordatorio de cita al titular. Arranca APAGADO: encender mensajes automáticos hacia clientes que no lo pidieron sería hablar en nombre de la clínica.';
comment on column public.clinics.recordatorio_citas_horas is
  'Con cuánta anticipación se avisa, en horas. El barrido corre una vez al día, así que 24 se cumple como «la mañana anterior», no como 24 horas exactas.';
comment on column public.clinics.recordatorio_citas_texto is
  'Texto del recordatorio de esta clínica. NULL = el de por defecto de lib/citas/recordatorio.ts. Se guarda NULL y no una copia: así, mejorar la redacción base no deja congelada a la clínica que nunca lo tocó. Huecos: {paciente}, {fecha}, {hora}, {clinica}.';
comment on column public.appointments.recordatorio_enviado_en is
  'Cuándo salió el recordatorio de esta cita. Es lo que hace el envío exactamente una vez: el cron se reintenta.';
