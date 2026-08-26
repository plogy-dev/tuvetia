-- 0094: la meta de ventas del mes.
--
-- ── PARA QUÉ ────────────────────────────────────────────────────────────────────────────────────
--
-- El tablero ya dice cuánto se vendió y si eso es más o menos que el mes pasado. Lo que no podía
-- decir es si alcanza: «+30%» contra un mes pésimo se lee como una buena noticia y puede estar
-- lejísimos de donde la clínica se propuso llegar. El anillo de cumplimiento contesta esa otra
-- pregunta, y para eso hace falta guardar contra qué se mide.
--
-- ── UNA COLUMNA Y NO UNA TABLA POR MES ──────────────────────────────────────────────────────────
--
-- Lo correcto el día que las metas tengan historia —comparar contra la meta que regía en marzo, no
-- contra la de hoy— es una tabla `clinic_goals(clinic_id, mes, meta_cents)`. Hoy no hay ninguna
-- pantalla que mire hacia atrás: el bloque es del MES EN CURSO, así que una tabla sería una junta
-- más por carga del tablero para responder siempre por la fila de este mes.
--
-- Cuando haga falta la historia, esta columna pasa a ser el valor por defecto de la tabla nueva y
-- no se pierde nada. Migrar una columna a una tabla es barato; mantener una tabla que nadie
-- consulta por más de una fila, no.
--
-- ── EN CENTAVOS, COMO TODO EL DINERO DE LA APP ──────────────────────────────────────────────────
--
-- `invoice_lines.total_cents`, `*_cents` en todos lados. Guardar la meta en pesos obligaría a
-- multiplicar por 100 en cada lectura, y el día que alguien se olvide la meta queda cien veces más
-- chica y el anillo dice 10.000% sin que nada falle.
--
-- ── QUIÉN LA PUEDE PONER ────────────────────────────────────────────────────────────────────────
--
-- Nadie nuevo. La policy `clinics_update` del esquema base ya exige `private.my_role() = 'admin'`,
-- así que esta columna hereda esa regla sin tocar nada: un vet que mande el update recibe el
-- rechazo de la base, no de la interfaz.

alter table public.clinics
  add column if not exists meta_ventas_mensual_cents bigint;

comment on column public.clinics.meta_ventas_mensual_cents is
  'Meta de ventas del mes en centavos, para el anillo de cumplimiento del tablero. NULL = sin meta '
  'puesta, que NO es lo mismo que cero: sin meta el bloque no se pinta, con meta en cero sí.';

-- NULL Y NO CERO POR DEFECTO, y el CHECK lo acompaña.
--
-- «Sin meta» y «meta de cero» son estados distintos y el tablero los trata distinto: sin meta no
-- hay anillo —no hay nada que cumplir— y con meta en cero sí lo hay. Un default de 0 le pondría a
-- todas las clínicas existentes un anillo que nadie pidió, cumplido al 100% desde el primer peso.
--
-- El CHECK deja pasar el 0 (es una meta válida, aunque rara) y frena el negativo, que sólo puede
-- venir de un error de carga y haría que el anillo diga porcentajes negativos.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clinics_meta_ventas_no_negativa'
  ) then
    alter table public.clinics
      add constraint clinics_meta_ventas_no_negativa
      check (meta_ventas_mensual_cents is null or meta_ventas_mensual_cents >= 0);
  end if;
end
$$;
