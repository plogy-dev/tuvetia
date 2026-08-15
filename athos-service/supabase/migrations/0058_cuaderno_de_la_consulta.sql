-- El cuaderno del veterinario: dónde escribe MIENTRAS atiende.
--
-- EL HUECO QUE CIERRA. Hoy, durante la consulta, el vet no puede escribir absolutamente nada. El
-- panel del Modo Fantasma es de sólo lectura —pinta la transcripción en vivo— y los únicos campos
-- de texto de todo el flujo son `chief_complaint`, que se llena al CREAR la consulta, y el SOAP,
-- que sólo existe DESPUÉS de que el modelo lo generó.
--
-- O sea que la ventana entera en la que el veterinario está pensando no tiene superficie de
-- escritura. Un peso, una observación, "pedir hemograma", el nombre de un fármaco que el titular no
-- recuerda bien: todo eso hoy va a papel — que es exactamente lo que este producto existe para
-- reemplazar. El cliente lo pidió con esas palabras: que el Modo Fantasma funcione como un cuaderno.
--
-- POR QUÉ UNA COLUMNA Y NO UNA TABLA. Un cuaderno de consulta es UNA página por consulta, y se
-- reescribe entera mientras se escribe. Una tabla de entradas con marca de tiempo sería el diseño
-- correcto si quisiéramos correlacionar cada anotación con el minuto del audio, pero eso es otra
-- función (marcadores sobre la grabación) y no es lo que se pidió. Una columna se lee y se escribe
-- con el mismo UPDATE que ya usa la pantalla, y no agrega una segunda fuente de verdad sobre la
-- consulta.
--
-- QUÉ **NO** ES. No es la nota clínica. La nota vive en `clinical_notes`, pasa por el gate de
-- alergia, por el guard de dosis y por la aprobación del vet. Esto es material de trabajo: lo que
-- el veterinario escribió para sí mismo. Alimenta la redacción de la nota como insumo —igual que la
-- transcripción— pero nunca la reemplaza ni entra solo a la historia.
--
-- SEGURIDAD. `consultations` ya tiene RLS por clínica con sus tres policies (select/insert/update
-- contra `private.my_clinic_id()`), así que una columna nueva queda cubierta sin tocar nada. Y es
-- nullable sin default: una consulta sin cuaderno es lo normal, no un caso de error.
--
-- COMPATIBILIDAD. `add column if not exists` sobre una tabla existente y sin default no reescribe
-- filas ni toma un lock largo. Nada que ya funcione deja de funcionar: quien no sepa de esta
-- columna sigue igual.

alter table public.consultations
  add column if not exists notebook text;

comment on column public.consultations.notebook is
  'Cuaderno del veterinario: texto libre escrito DURANTE la consulta. Material de trabajo, no la '
  'nota clínica — alimenta la redacción del SOAP como insumo junto con la transcripción, pero no '
  'entra a la historia por sí solo.';
