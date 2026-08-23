# Configurar el correo de acceso en Supabase

**Qué resuelve.** Que el enlace de "entrar sin contraseña" funcione **al abrirlo en otro
dispositivo** — el caso que más pasa: el vet pide el enlace en el computador y lo abre desde el
teléfono.

**Dónde.** Panel de Supabase del proyecto principal → **Authentication → Emails → Templates**.
No es código y no hace falta desplegar nada.

---

## Por qué hay que tocarlo

El template que trae Supabase por defecto usa `{{ .ConfirmationURL }}`, que emite un enlace con
`?code=` — el flujo **PKCE**. Ese flujo guarda medio secreto (`code_verifier`) **en el navegador que
pidió el enlace**. Si el correo se abre en otro dispositivo, ese medio secreto no está, y el enlace
falla de la peor manera posible: **no pasa nada**. Sin error visible, sin mensaje.

El flujo correcto para un enlace de correo es el de `token_hash`, que no depende del navegador.
`/auth/confirm` ya está escrito para recibirlo (`verifyOtp({ type, token_hash })`).

---

## Lo que hay que pegar

Aplica a **dos** plantillas, porque `signInWithOtp` manda una u otra según el caso:

| plantilla | cuándo la usa Supabase |
|---|---|
| **Magic Link** | el correo ya tiene cuenta → es el login |
| **Confirm signup** | el correo es nuevo → es el registro |

En las dos, el `href` del botón/enlace debe ser exactamente:

```
{{ if .RedirectTo }}{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email{{ else }}{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard{{ end }}
```

### Por qué `{{ .RedirectTo }}` y no `{{ .SiteURL }}`

Porque el navegador ya manda a dónde volver. `login-form.tsx` y `signup-form.tsx` envían:

```
emailRedirectTo = {origin}/auth/confirm?next=<a-donde-volver>
```

Ese `next` **es la invitación de equipo**: quien recibe una invitación llega por
`/signup?next=/invitar/<token>`. Con `{{ .SiteURL }}` el `next` se pierde, el invitado cae en el
tablero en vez de volver a aceptar, y su invitación queda pendiente sin que nadie entienda por qué.

Como `RedirectTo` ya termina en `?next=…`, se concatena con **`&`**, no con `?`.

### Por qué la rama `{{ else }}`

Para el caso en que el correo se dispare **sin** `emailRedirectTo` — por ejemplo desde el propio
panel de Supabase ("Send magic link" a un usuario). Sin esa rama, el enlace saldría empezando por
`&token_hash=…` y no llevaría a ninguna parte.

---

## Los dos ajustes de al lado

En **Authentication → URL Configuration**:

- **Site URL**: `https://tuvetia.vercel.app`
- **Redirect URLs** (lista blanca; sin esto Supabase ignora el `emailRedirectTo` y cae al Site URL):
  ```
  https://tuvetia.vercel.app/**
  http://localhost:3000/**
  ```

El `/**` importa: la URL que manda el navegador lleva `?next=` con un valor distinto cada vez.

---

## Cómo verificar que quedó

1. **El caso que se rompía.** Pedir el enlace en el computador y abrirlo **en el teléfono**. Tiene
   que entrar. Si "no hace nada", la plantilla sigue en `{{ .ConfirmationURL }}`.
2. **Que el `next` sobreviva.** Invitar a alguien, y desde el correo de invitación crear la cuenta.
   Después de confirmar, tiene que aterrizar en `/invitar/<token>`, no en `/dashboard`.
3. **Mirar el enlace sin hacer clic.** Copiarlo del correo: debe tener `token_hash=` y `type=email`,
   y **no** `code=`.
4. **Un enlace vencido** (más de una hora) debe llevar a `/login?error=auth&reason=otp_expired` —
   con motivo, no a una pantalla en blanco.

---

## Lo que NO pasa por acá

Las **invitaciones de equipo** no usan plantillas de Supabase: salen por Resend con el enlace directo
a `/invitar/<token>` (ver `src/app/api/team/invite-email/route.ts`). Se movieron justamente para no
depender de este camino.

El contrato entre el código y esta plantilla está fijado en
`src/lib/__tests__/contrato-del-magic-link.test.ts`. Si alguien cambia el `emailRedirectTo` o la ruta
que recibe el clic, ese test se cae y trae a leer este documento.
