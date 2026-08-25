-- El nombre de perfil de quien escribe por WhatsApp, para dejar de mostrar números pelados.
--
-- ── EL DEFECTO ────────────────────────────────────────────────────────────────────────────────
--
-- Reportado el 24-ago: «cuando escribe un número, aparece sin nombre, solo número». Es exacto — la
-- bandeja resuelve el nombre contra los titulares registrados y, si no encuentra, pinta `+57300…`.
-- No hay plan B.
--
-- ── Y EL PLAN B YA LO ESTAMOS RECIBIENDO ──────────────────────────────────────────────────────
--
-- Baileys manda `pushName` —el nombre que la persona puso en SU perfil de WhatsApp— en cada mensaje
-- entrante. Está declarado en nuestro propio tipo `EvoMessage` desde siempre… y no se usa en
-- ninguna parte: el webhook lo recibe y lo tira.
--
-- No hace falta sincronizar la agenda del teléfono del vet: el nombre viaja EN EL MENSAJE.
--
-- ── POR QUÉ EN EL MENSAJE Y NO EN UNA TABLA DE CONTACTOS ──────────────────────────────────────
--
-- Porque es un dato DEL MENSAJE, no del contacto: la gente cambia su nombre de perfil, y guardarlo
-- por mensaje conserva cómo se llamaba cuando escribió. La bandeja se queda con el más reciente,
-- que es lo que se quiere mostrar, y no hace falta ninguna consulta extra — ya carga los mensajes.
--
-- Una tabla `whatsapp_contacts` sería el diseño para una libreta de direcciones de verdad. Eso es
-- otra cosa, y para ella ya existe el camino bueno: guardar a la persona como TITULAR.
--
-- ── SÓLO ENTRANTES ────────────────────────────────────────────────────────────────────────────
--
-- En un saliente, `pushName` es el nombre de perfil de la CLÍNICA. Guardarlo sería llenar la tabla
-- con nuestro propio nombre repetido y arriesgar que algún día se pinte como si fuera del titular.
--
-- ⚠️ NO ES IDENTIDAD VERIFICADA. Lo elige quien escribe: puede decir «Servicio Técnico», un emoji o
-- el nombre de otra persona. Sirve para reconocer una conversación, NO para afirmar quién es
-- alguien. Por eso la bandeja lo pinta distinto de un titular, y por eso NUNCA debe usarse para
-- resolver a qué titular pertenece un mensaje — eso se hace por teléfono y sigue igual.
--
-- Aplicar en el principal (`auxlnexhkmtoedrzfsnz`). Reversible: se borra la columna.

alter table public.whatsapp_messages
  add column if not exists push_name text;

comment on column public.whatsapp_messages.push_name is
  'Nombre de perfil de WhatsApp de quien envió el mensaje (pushName de Baileys), sólo en entrantes. NO es identidad verificada: lo elige el remitente. Se usa para mostrar la conversación cuando el número no es titular; nunca para resolver a qué titular pertenece.';
