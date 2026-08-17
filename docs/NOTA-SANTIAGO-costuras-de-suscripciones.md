# Nota para Santiago — lo que el código ya asume sobre suscripciones

Corta y sin recomendaciones de arquitectura: es tu área. Sólo el estado real, medido contra el
principal el 2026-08-16, para que no te lleves sorpresas.

---

## La buena noticia: el mecanismo de corte ya existe

No hace falta construir la aplicación del cobro. Ya está hecha y probada, sólo que hoy se acciona a
mano en vez de por pago.

- `src/lib/api/clinica-de-la-sesion.ts` resuelve la clínica **y** comprueba `is_active` en el mismo
  select, con `MENSAJE_DESACTIVADA` cuando no lo está.
- Hay **9 rutas de API** que ya pasan por esa guarda, y 21 referencias en total.
- La migración 0059 metió `is_active` dentro de `private.my_clinic_id()`, así que la RLS también
  corta.
- El panel admin tiene el interruptor: `src/app/admin/usuarios/actions.ts :: cambiarActivacion`.

**En la práctica:** el webhook de Wompi tiene que terminar moviendo esa palanca. La cañería de
"cortarle el acceso a una clínica" no hay que inventarla.

## El estado de las columnas

| columna | tipo | default | estado hoy |
|---|---|---|---|
| `clinics.subscription_status` | `text` | `'trial'` | **15 de 15** clínicas ahí |
| `clinics.wompi_subscription_id` | `text` | `null` | **0** poblados |

- `subscription_status` se **lee en un solo lugar de todo el repo**: `src/lib/admin/metrics.ts:70`,
  y sólo para mostrarlo en el panel admin. **Nada lo escribe. Nada lo usa como puerta.** Está libre.
- `wompi_subscription_id` **no aparece en `src/`**. Cero referencias. También libre.

## El trial de 3 días no existe

`src/lib/athos-agent/presupuesto.ts:6` lo documenta: *"cobra lo que consume IA, y hay un free trial
de 3 días"*.

**No hay columna `trial_ends_at` ni código que lo aplique.** La clínica más vieja lleva **32 días**
en un trial de 3. Si el trial es parte del plan comercial, hoy no tiene reloj.

## El tope de IA es la costura del límite del plan

`src/lib/athos-agent/presupuesto.ts` ya mide y corta consumo por clínica:

- `TOPE_DE_SEGURIDAD = 1000` llamadas — un techo de contención, no un límite comercial.
- Se configura por variable de entorno; el valor `"ninguno"` lo apaga como decisión explícita.
- Cuenta **llamadas y no tokens**, a propósito y con el razonamiento escrito: *"Te quedan 120
  consultas" se entiende; "te quedan 1.400.000 tokens" no*.

**La UI ya está construida y esperándote.** `CupoDeIA` en `src/components/athos/riel-clinica.tsx:75`
pinta el medidor con barra y aviso de "quedan N". Hoy **no se renderiza a propósito** cuando no hay
tope, con este comentario:

> *"Un medidor de un límite que no existe es ruido permanente... y encima insinuaría un plan que
> todavía no se vende."*

En cuanto haya planes con tope, esa pantalla se enciende sola.

## Un dato de contexto que puede afectar el pricing

Ninguna de las 15 clínicas tiene un solo servicio activo en el catálogo, así que **ninguna puede
emitir una factura hoy** (hallazgo 1 de la auditoría). Si el plan se piensa alrededor de
facturación, el embudo se traba antes de llegar al cobro.
