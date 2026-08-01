# Seguridad de la base — funciones `SECURITY DEFINER` y avisos del linter

> **Para qué existe este documento.** Los *advisors* de Supabase levantan 20 avisos sobre funciones
> `SECURITY DEFINER` en `public`. El 2026-07-30 se revisaron **una por una, leyendo el cuerpo real
> en producción**, y el resultado es que **ninguna es un defecto**: todas re-implementan el control
> de acceso por dentro. Este archivo deja constancia de esa revisión para que la próxima auditoría
> no las vuelva a presentar como deuda pendiente — y para que quien agregue una función nueva sepa
> cuál es el patrón que tiene que cumplir.
>
> Última revisión: **2026-07-30**, contra el proyecto principal `auxlnexhkmtoedrzfsnz`.

## Por qué el linter avisa (y por qué no basta con revocar)

Una función `SECURITY DEFINER` corre con los privilegios de quien la creó, no de quien la llama:
**se salta la RLS**. Supabase avisa de todas las que un usuario autenticado puede invocar, porque
*si alguna confiara en sus argumentos sin verificar nada*, sería una puerta trasera a los datos de
otra clínica.

El linter no puede leer la lógica interna, así que avisa de todas por igual. Y revocarlas **rompería
la aplicación sin ganar seguridad**: son `SECURITY DEFINER` justamente porque necesitan saltarse la
RLS para hacer su trabajo (crear una invitación, mover a alguien de clínica, sembrar un feed de
calendario). Lo correcto no es quitarles el permiso, es que cada una vuelva a preguntar *"¿quién
eres y puedes hacer esto?"* antes de actuar. Eso es exactamente lo que hacen.

## La raíz de confianza

Todo el esquema de autorización cuelga de dos funciones que viven en el esquema `private` (**no
expuesto por PostgREST**, así que nadie las llama desde fuera):

```sql
private.my_clinic_id()  -- select clinic_id from public.profiles where id = auth.uid()
private.my_role()       -- select role      from public.profiles where id = auth.uid()
```

Ambas derivan de `auth.uid()`, que sale del JWT ya verificado por Supabase — **no de un argumento
que el llamador controle**. Ambas son `STABLE`, `SECURITY DEFINER` y con `SET search_path = public`.
Ese es el eslabón que hay que cuidar: si alguien cambiara estas dos para aceptar un parámetro, todo
lo de abajo dejaría de valer.

## Las 17 funciones invocables por `authenticated`

| Función | Qué la protege |
|---|---|
| `create_invitation(email, role)` | Exige clínica **y** rol admin: `raise exception 'Solo un administrador puede invitar miembros'` |
| `remove_clinic_member(member_id)` | Exige rol admin; además impide auto-eliminarse y protege al último admin |
| `switch_active_clinic(clinic_id)` | Busca en `memberships` por `user_id = auth.uid()`; si no está: `raise exception 'No perteneces a esa clinica'` |
| `delete_transcript(id)` | `raise exception 'Transcript does not belong to your clinic'` si el id no es de la clínica del llamador |
| `update_appointment(id, …)` | Verifica que la cita pertenezca a `private.my_clinic_id()` antes de tocarla |
| `create_appointment(…)` | Exige clínica asignada; valida que paciente/dueño referenciados sean de esa clínica |
| `create_patient(owner_id, …)` | Verifica que el `owner_id` pertenezca a la clínica del llamador antes de insertar |
| `create_owner(…)` | Inserta con `clinic_id := private.my_clinic_id()` — el llamador no puede elegir la clínica |
| `revoke_owner_consent(owner_id)` | El `update` incluye `c.clinic_id = private.my_clinic_id()` en el `where` |
| `has_owner_consent(owner_id)` | El `select` filtra por `c.clinic_id = private.my_clinic_id()` |
| `get_clinic_members()` | `where p.clinic_id = private.my_clinic_id()` — sin argumentos que manipular |
| `ensure_calendar_feed()` | Siembra el feed de la clínica del llamador; sin argumentos |
| `has_pending_invitation()` | Compara contra `auth.jwt() ->> 'email'`, no contra un parámetro |
| `mark_onboarded()` | `where id = auth.uid()` — solo su propia fila |
| `mark_setup_completed()` | `where id = auth.uid()` — solo su propia fila |
| `create_clinic(name)` | Delega en `private.provision_new_clinic(auth.uid(), name)`: el usuario provisto es **siempre** el llamador, no un argumento |
| `accept_invitation(token)` | El token es la credencial: debe existir, no estar aceptado y no haber expirado (ver nota abajo) |

## Las 3 que el linter **no** marca (y por qué)

`enforce_profile_clinic_invariant`, `handle_new_user` y `handle_user_confirmed` son `SECURITY
DEFINER` pero **no ejecutables por `authenticated`**: son funciones de *trigger*, las dispara el
motor. Aparecen en un inventario de funciones pero no en la superficie de ataque.

## Nota sobre `accept_invitation` — revisada, sin cambios

Valida que el token exista, no esté aceptado y no haya expirado, pero **no comprueba que el email
del invitado coincida con el del usuario que lo canjea**. En la práctica el token es un secreto
aleatorio que llega por correo y funciona como credencial; la consecuencia es que **quien tenga el
enlace entra a la clínica**, no solo el destinatario (si alguien reenvía el correo, el que lo abra
se une).

**Decisión 2026-07-30: se deja como está.** El flujo de invitaciones es de Santiago y estaba siendo
modificado ese mismo día (`ac8fb8d`, el invitado sin cuenta previa). Agregar una comparación contra
`auth.jwt() ->> 'email'` podría romper justamente el caso que se acababa de arreglar, porque en ese
flujo el usuario puede no tener aún el email confirmado en el JWT. Queda documentado como
característica conocida, no como defecto abierto; si algún día se endurece, hay que validarlo contra
el camino del invitado sin cuenta.

## Otros avisos del linter y su estado

| Aviso | Estado |
|---|---|
| `function_search_path_mutable` en `facturacion_assign_next_number` y `touch_updated_at` | **Riesgo real, corregido** en la migración `0045`. Una función sin `search_path` fijo resuelve nombres de tabla según el entorno del llamador; quien pueda crear objetos en un esquema anterior del path podría interceptar a qué tabla se escribe |
| `rls_enabled_no_policy` en `corpus_chunks` | **Falso positivo — no tocar.** El corpus es global y se lee solo con `service_role` desde athos-service, que se salta la RLS. "RLS activa + cero políticas" significa *nadie más puede leerla*, que es exactamente la postura deseada |
| `extension_in_public` (`vector`) | Aceptado. Moverla de esquema obligaría a reescribir todas las referencias a los tipos y a reindexar; el beneficio no lo justifica |
| `auth_leaked_password_protection` | **Pendiente** — es un toggle del dashboard (Authentication → Providers → Email), no código |
| `unindexed_foreign_keys` (21 de facturación/equipo) | Corregidos en la migración `0045` |

> ⚠️ **La `0045` sigue SIN aplicar al principal** (verificado el 2026-08-01: los advisors todavía
> reportan `function_search_path_mutable` en las dos funciones). Nació como `0042` y se renumeró dos
> veces —la tanda de calendario se llevó el `0042` y el `0043`—, así que si la buscás por el número
> viejo no la vas a encontrar.

## Regla para funciones nuevas

Si agregas una función `SECURITY DEFINER` invocable por `authenticated`, tiene que cumplir las tres:

1. **Derivar la identidad de `auth.uid()`**, nunca de un argumento.
2. **Verificar la pertenencia** de todo id que reciba (`... where id = $1 and clinic_id =
   private.my_clinic_id()`), y fallar con excepción explícita si no coincide.
3. **Fijar `SET search_path = public`** en la definición.

Y si es sobre una tabla por clínica, el PR necesita además su test cross-tenant — que desde el
2026-07-30 **sí corre en CI** (`ci.yml` monta un Postgres con pgvector; antes se auto-skipeaba).

## Cómo re-verificar esto en 30 segundos

```sql
-- Inventario de funciones SECURITY DEFINER y quién puede llamarlas
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as la_llama_authenticated
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by p.proname;

-- Y el cuerpo de una en concreto, para leer su control de acceso
select pg_get_functiondef('public.remove_clinic_member(uuid)'::regprocedure);
```

Si el conteo sube, la función nueva debe cumplir las tres reglas de arriba y sumarse a la tabla de
este documento.
