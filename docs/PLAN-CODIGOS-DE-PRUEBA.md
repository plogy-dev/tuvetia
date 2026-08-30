# Códigos de prueba gratis — diseño para implementar

**Fecha:** 30 de agosto de 2026
**Origen:** reunión del 28-ago (26:09). David: «que la gente se pueda registrar gratis solo con
un link». Luciano: «un link especial + código promocional — una o dos semanas gratis».
**Encargado:** Santiago («armaste la estructura del billing… está breve, se hace»).
**Este documento:** el diseño completo con lo ya explorado, para ejecutar sin re-derivar.

---

## Lo que YA existe (y te ahorra la mitad del trabajo)

1. **El trial automático ya está.** Toda clínica nueva nace `pro` + `subscription_status='trial'`
   + `plan_renueva_en = now() + 3 días` — trigger de la migración
   `0078_la_prueba_de_tres_dias.sql:58-86`. Y tiene una guarda deliberada: un insert que llegue
   con `plan` o `plan_renueva_en` ya puestos **no se pisa** («una migración, un traspaso, el
   panel de admin»). Es el punto de extensión previsto.
2. **`cortesia` ya existe en el vocabulario** (`0065`): Pro sin cobrar, para «las clínicas
   anteriores a los planes, y las del equipo». Lo que falta es la forma de asignarla desde el
   producto — `BILLING.md:462` lo deja pendiente como «el update de una línea».
3. **El barrido ya baja las pruebas vencidas** (`src/lib/suscripcion/barrido.ts:107-117`):
   `free` + `inactive` al vencer `plan_renueva_en`. Un código que sólo estira esa fecha no
   necesita NINGÚN cambio en el ciclo de vida.
4. **El precedente de mutación en admin** es `cambiarActivacion`
   (`src/app/admin/usuarios/actions.ts:49`): server action con `service_role`, porque el trigger
   de columnas sensibles bloquea a la sesión y deja pasar a service_role.
5. **La UI del trial ya existe**: `gestion-del-plan.tsx:121-138` muestra «Te quedan N días de
   prueba» leyendo `plan_renueva_en`. Un código de 14 días la reutiliza sin tocarla.

**Lo que NO existe:** nada de códigos/referidos/cupones (grep exhaustivo: cero en `src/` y en
migraciones). El signup no acepta parámetros. `/f/` es la factura pública (no tocar). `/invitar`
une a una clínica existente (no crea).

---

## El diseño

### 1 · Tabla `promo_codes` (migración nueva)

```sql
create table public.promo_codes (
  code        text primary key,           -- en MAYÚSCULAS, p.ej. 'VETS2026'
  dias        int  not null check (dias between 1 and 60),
  max_usos    int  not null default 100,
  usos        int  not null default 0,
  expires_at  timestamptz,                -- null = no expira
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
alter table public.promo_codes enable row level security;
-- SIN policies: sólo service_role la toca. Ni anon ni authenticated pueden enumerar códigos.
```

Y una tabla de canjes para poder auditar y limitar (un canje por clínica):

```sql
create table public.promo_redemptions (
  clinic_id  uuid primary key references public.clinics(id) on delete cascade,
  code       text not null references public.promo_codes(code),
  created_at timestamptz not null default now()
);
```

`clinic_id` como PK = una clínica no puede canjear dos códigos. `on delete cascade` para que la
baja de una clínica no choque (lección del hallazgo 1 de la auditoría del 27-ago).

### 2 · La ruta del link: `/probar/[codigo]`

Server component. Valida contra `promo_codes` con service_role (existe, no vencido,
`usos < max_usos`). Si vale: cookie `promo_code` (httpOnly, `maxAge: 3600`, path `/`) y
`redirect("/signup")`. Si no vale: redirect a `/signup` igual, **sin el cookie y sin error
visible** — quien llegó con un link viejo se registra normal con sus 3 días; no se le castiga.

El link que David comparte es `https://tuvetia.vercel.app/probar/VETS2026`. El signup no cambia
de forma — cero fricción nueva en el registro, que es lo que pidió («solo con un link»).

### 3 · El canje, al crear la clínica

En `src/components/onboarding/sin-clinica.tsx` después del `rpc("create_clinic")` exitoso:
llamar una server action `canjearCodigoPromo()` (nueva, en `src/lib/suscripcion/`):

1. Lee el cookie `promo_code`. Sin cookie → no-op.
2. Con service_role, en este orden: verifica el código otra vez (existe/vigente/con cupo),
   inserta el canje en `promo_redemptions` (el PK frena el doble canje), incrementa `usos`, y
   `update clinics set plan_renueva_en = now() + (dias || ' days')::interval` — **sólo estira la
   fecha**; el trigger 0078 ya puso `pro`+`trial`. Borra el cookie.
3. `audit_logs`: `promo_code.redeemed` con code y clinic_id.
4. **Falla ABIERTO**: cualquier error → la clínica queda con sus 3 días normales y un
   `console.error`. Un código roto no puede frenar un registro — criterio de la casa
   (`presupuesto.ts` hace lo mismo).

Idempotencia: el PK de `promo_redemptions` + el incremento de `usos` en la misma action. Si
quieres atomicidad total, mételo en una función SQL `security definer` (patrón
`accept_invitation` de la 0053).

### 4 · Admin: crear códigos y la cortesía

- **`/admin/codigos`** (página nueva): listar códigos con usos, crear uno (form + server
  action). `await requerirAdminDePlataforma()` **en la primera línea de la página** — no sólo
  el layout: en App Router layout y página corren en paralelo, y la página sin gate ya filtró
  datos una vez (el 404-con-66KB del 24-ago, documentado en `platform-admin.ts:20-43`).
- **`/admin/clinicas`**: acción «pasar a cortesía» por clínica
  (`update clinics set plan='pro', subscription_status='cortesia', plan_renueva_en=null`) +
  su inversa. Mismo patrón service_role de `cambiarActivacion`. Con esto David puede regalar
  acceso indefinido a un veterinario puntual sin código.

### 5 · Tests que valen la pena

- El canje estira `plan_renueva_en` y no pisa `plan`/`status` (la guarda de 0078 sigue intacta).
- Un segundo canje de la misma clínica no hace nada (el PK).
- Código vencido/agotado → la clínica queda con sus 3 días (fallar abierto).
- `usos` no pasa `max_usos` bajo carrera (si va por función SQL, probar el `where usos < max_usos`).

---

## Lo que NO hace falta construir

- Cambios en el signup ni en el flujo OTP (el cookie viaja solo).
- Cambios en Wompi ni en el motor de cobro (al vencer la prueba extendida, el ciclo normal
  aplica: el barrido baja a `free` y `gestion-del-plan` ofrece pagar).
- Un cron nuevo (no hay cupo en Vercel Hobby: los 2 diarios están usados — y no se necesita).

## Una decisión abierta (de producto, no técnica)

¿Los 7-14 días del código REEMPLAZAN los 3 del trial o se SUMAN? El diseño de arriba reemplaza
(pone `now() + dias`, no `plan_renueva_en + dias`). Da igual técnicamente; que lo diga David.
