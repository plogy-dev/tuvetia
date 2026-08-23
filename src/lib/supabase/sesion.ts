import "server-only"

import { cache } from "react"

import { createClient } from "./server"

// La sesión del request, validada UNA sola vez.
//
// ── EL PROBLEMA QUE RESUELVE, MEDIDO ──────────────────────────────────────────────────────────
//
// `supabase.auth.getUser()` no lee la cookie: sale a la red a verificar el JWT contra Supabase
// Auth. Cada llamada es un viaje Vercel→Supabase. Y en una navegación del dashboard se hacía TRES
// veces: el middleware, el layout, y otra vez la página (8 de ellas lo repetían).
//
// La medición del 23-ago contra el despliegue dejó el diagnóstico sin lugar a dudas:
//
//     /dashboard/ayuda   (NINGUNA consulta propia)  → 1.061 ms
//     /dashboard/tablero (muchas consultas)         →   930 ms
//     /producto          (estática, sin sesión)     →   289 ms
//
// Una página sin datos tardaba lo mismo que la más pesada del sistema. El costo no eran los datos:
// era un piso fijo de ~700 ms que pagaba toda navegación, hecho de viajes de red encadenados.
//
// ── POR QUÉ `cache()` Y NO UNA VARIABLE MODULAR ───────────────────────────────────────────────
//
// Un módulo con estado en el servidor se comparte entre REQUESTS de usuarios distintos: sería
// servirle a alguien la sesión de otro. `cache()` de React memoiza por pasada de render — el mismo
// request comparte el resultado, y dos requests no comparten nada. Es el patrón que recomiendan los
// docs de Next para el DAL de autenticación, con `server-only` incluido.
//
// NO reemplaza al `getUser()` del middleware, que es la puerta de seguridad y corre en otro runtime.
// Lo que se elimina es la repetición DENTRO del render.

/**
 * El cliente de Supabase del request y el usuario ya validado.
 *
 * Devuelve los dos juntos porque siempre se usan juntos: quien necesita el usuario necesita después
 * el cliente para consultar con su sesión. Pedirlos por separado era lo que hacía que cada página
 * creara su propio cliente y volviera a validar por su cuenta.
 *
 * `user` es `null` si no hay sesión. No redirige: quién decide qué hacer con eso es cada pantalla
 * —el layout manda a `/bienvenida`, una API devuelve 401— y meter un `redirect()` acá les quitaría
 * esa decisión.
 */
export const sesionDelServidor = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user }
})
