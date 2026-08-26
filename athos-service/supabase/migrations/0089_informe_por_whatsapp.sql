-- 0089 — El informe al titular también sale por WhatsApp.
--
-- ── DE DÓNDE SALE ─────────────────────────────────────────────────────────────────────────────
--
-- Pregunta de David del 25-ago («¿va a poder enviar la historia clínica el paciente si la pide?»),
-- decidida por Felipe el 26-ago: se hace, David asume la responsabilidad del canal. La forma es la
-- SEGURA que se acordó: el vet abre el informe, LO LEE Y LO EDITA, y lo manda con un clic — nunca
-- una respuesta automática. Lo clínico no se responde solo (es la promesa que el aviso de
-- Conexiones le hace al vet en la cara).
--
-- Técnicamente es sólo ensanchar el CHECK de `client_reports.channel`: la tabla, el trigger de
-- nota-aprobada (0071) y la auditoría por fila ya existen y valen igual para este canal.
--
-- Mismo patrón que 0057/0068/0086: el check se recrea completo con el valor nuevo.
--
-- Aplicar en el principal (`auxlnexhkmtoedrzfsnz`). Reversible: recrear el check sin 'whatsapp'
-- (si no hay filas con ese canal).

alter table public.client_reports
  drop constraint if exists client_reports_channel_check;

alter table public.client_reports
  add constraint client_reports_channel_check
  check (channel in ('pdf', 'clipboard', 'email', 'whatsapp'));

comment on column public.client_reports.channel is
  'Por dónde se entregó: pdf, clipboard, email o whatsapp. Una fila por entrega — la auditoría vale por lo que no se puede olvidar de anotar.';
