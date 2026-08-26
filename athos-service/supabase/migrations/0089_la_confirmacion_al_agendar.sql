-- 0089: avisarle al titular EN EL MOMENTO en que se le agenda la cita.
--
-- ── QUÉ FALTABA ─────────────────────────────────────────────────────────────────────────────────
--
-- La 0085 trajo el RECORDATORIO: un barrido diario que avisa la mañana anterior. Resuelve la mitad
-- del pedido de Santiago —«confirmaciones y recordatorios de citas por WhatsApp»— y deja la otra
-- afuera: entre que la clínica agenda y la mañana previa pueden pasar semanas, y en todo ese tiempo
-- el titular no tiene ninguna constancia de que su cita existe.
--
-- Es la mitad que más se nota, porque es la que reemplaza la llamada: hoy alguien de la clínica
-- cuelga el teléfono y vuelve a llamar para confirmar que la persona anotó bien el día.
--
-- ── POR QUÉ COLUMNAS NUEVAS Y NO REUSAR LAS DE LA 0085 ─────────────────────────────────────────
--
-- Porque son dos mensajes con dos textos y dos decisiones distintas. Una clínica puede querer
-- confirmar al agendar y NO recordar (o al revés), y el texto no puede ser el mismo: «le recordamos
-- la cita de mañana» mandado en el momento de agendar, para una cita de dentro de tres semanas, es
-- un mensaje que confunde.
--
-- Comparten los MISMOS HUECOS de plantilla ({paciente}, {fecha}, {hora}, {clinica}) y el mismo
-- puerto de salida. Lo que no comparten es el interruptor ni la redacción.
--
-- ── ARRANCA APAGADO, igual que el recordatorio ─────────────────────────────────────────────────
--
-- Por lo mismo que dejó escrito la 0085: encender mensajes automáticos hacia los clientes de una
-- clínica que no lo pidió sería hablar en su nombre, y en Colombia además tratar datos personales
-- para una finalidad que el titular no autorizó (Ley 1581). Que cada clínica lo encienda.
--
-- NO HACE FALTA SELLO en `appointments`. El recordatorio necesita `recordatorio_enviado_en` porque
-- lo dispara un cron que puede correr dos veces; esto lo dispara UNA acción de una persona —guardar
-- la cita— y el resultado se le muestra ahí mismo. Si el mensaje no sale, el vet lo ve en la ventana
-- y decide; no hay nada que reintentar a ciegas.

alter table public.clinics
  add column if not exists confirmacion_citas_activo boolean not null default false,
  add column if not exists confirmacion_citas_texto text;

comment on column public.clinics.confirmacion_citas_activo is
  'Si se le manda al titular una confirmación por WhatsApp EN EL MOMENTO de agendar la cita. '
  'Distinto del recordatorio (0085), que sale la mañana anterior. Arranca apagado a propósito.';

comment on column public.clinics.confirmacion_citas_texto is
  'La plantilla de esa confirmación. Nula = el texto por defecto del código. '
  'Mismos huecos que el recordatorio: {paciente}, {fecha}, {hora}, {clinica}.';
