-- «Grupo» en los productos y servicios: el único campo del inventario de OkVet que no teníamos.
--
-- ── DE DÓNDE SALE ─────────────────────────────────────────────────────────────────────────────
--
-- Del documento de cambios del cliente (24-ago): «Módulo de inventarios (productos/servicios)
-- igual: referencia, grupo, categoría, nombre, tipo». Mirado el inventario de OkVet con la cuenta
-- del cliente, sus columnas son, exactas y en este orden:
--
--   Opciones · Ref. · Grupo · Categoría · Nombre · Tipo · Inv. · Disponibles · Pick. · P.V. ·
--   Impuestos · Creado
--
-- De los cinco que pidió el cliente ya teníamos cuatro con otro nombre: `sku` es «Ref.»,
-- `category_id` es «Categoría», `name` es «Nombre» e `item_type` es «Tipo». Faltaba «Grupo».
--
-- ── POR QUÉ TEXTO LIBRE Y NO UNA TABLA ────────────────────────────────────────────────────────
--
-- Se miró si en OkVet «Grupo» es una entidad gestionada, como sí lo es «Categoría» —que tiene su
-- propia pantalla en Ventas ▸ Inventario ▸ Categorías, con columnas Nombre · Productos/Servicios ·
-- Creado · Actualizado—. NO la tiene: no hay pantalla de grupos en ninguna parte de su menú, y su
-- pantalla de categorías no tiene columna de grupo, así que tampoco es el padre de la categoría.
-- Son dos ejes sueltos.
--
-- Con eso, lo más probable es que sea una etiqueta que la clínica escribe. Se implementa así:
-- `text` libre, opcional, sin catálogo.
--
-- QUEDA DICHO QUE ES UNA INFERENCIA, no algo verificado: el formulario de registro de OkVet carga
-- por AJAX y no llegó a abrir en la sesión donde se miró esto. Si resulta ser una lista gestionada,
-- el cambio es una tabla `catalog_groups` y cambiar esta columna por una FK — nada de lo que se
-- escriba mientras tanto se pierde, porque el texto migra a nombre de grupo.
--
-- Aplicar en el principal (`auxlnexhkmtoedrzfsnz`). Reversible: se borra la columna.

alter table public.catalog_items
  add column if not exists item_group text;

-- Se busca y se filtra por grupo en una lista que puede tener miles de ítems.
create index if not exists catalog_items_clinic_group_idx
  on public.catalog_items (clinic_id, item_group)
  where item_group is not null;

comment on column public.catalog_items.item_group is
  'Campo «Grupo» del inventario de OkVet. Etiqueta libre de la clínica, distinta de category_id: en OkVet son dos ejes sueltos (no hay pantalla de grupos, y las categorías no tienen grupo padre).';
