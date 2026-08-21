-- Qué CIFRAS elige cada quien para la tira de arriba del tablero.
--
-- LO QUE SE PIDIÓ: que el veterinario pueda escoger métricas adicionales a las que ya están. La
-- 0072 hizo modular el tablero a nivel de BLOQUES; esto abre el bloque de las cifras, que hasta
-- ahora eran cuatro fijas escritas a mano en la página.
--
-- ── POR QUÉ UNA COLUMNA Y NO UNA TABLA NUEVA ────────────────────────────────────────────────────
--
-- Es la MISMA preferencia, de la misma persona, para la misma pantalla, y se guarda y se lee en el
-- mismo momento que `widgets`. Una tabla aparte obligaría a dos upserts que tienen que salir o
-- fallar juntos —y no hay transacción del lado del navegador— así que la primera vez que uno de los
-- dos fallara, el tablero quedaría con los bloques de hoy y las cifras de ayer.
--
-- Va al lado, en la misma fila, con la misma clave `(user_id, clinic_id)`: un vet puede estar en
-- varias clínicas y querer cosas distintas en cada una.
--
-- ── EL DEFAULT ES `[]`, Y SIGNIFICA "NUNCA ELIGIÓ" ─────────────────────────────────────────────
--
-- No significa "ninguna cifra". Una lista vacía la resuelve `lib/tablero/metricas.ts` encendiendo
-- las de fábrica, que es lo mismo que ve hoy quien no tiene fila. O sea que **esta migración no le
-- cambia el tablero a nadie**: las 15 clínicas siguen viendo exactamente las cuatro cifras de
-- siempre hasta que alguien entre a elegir.
--
-- ── LA BASE NO VALIDA LOS IDS, IGUAL QUE EN LA 0072 ────────────────────────────────────────────
--
-- Un `check` contra la lista de métricas convertiría cada cifra nueva en una migración, y cada
-- cifra retirada en filas que nadie puede actualizar. La reconciliación vive en el código
-- (`metricasEfectivas`), que ignora lo que no reconoce y agrega lo que falta. El precio de esa
-- decisión es que una preferencia puede nombrar algo que ya no existe; el precio de la contraria
-- sería una migración por cada ajuste de producto.

alter table public.tablero_preferencias
  add column if not exists metricas jsonb not null default '[]'::jsonb;

comment on column public.tablero_preferencias.metricas is
  'Qué cifras ve esta persona en la tira del tablero y en qué orden: [{id, visible}]. '
  'Lista vacía = nunca eligió, y el código enciende las de fábrica. Los ids NO se validan acá a '
  'propósito: la reconciliación vive en lib/tablero/metricas.ts.';

-- Las policies de la 0072 son por fila (`user_id = auth.uid()`), así que cubren la columna nueva
-- sin tocar nada: quien puede escribir su fila puede escribir esta columna, y sólo la suya.
