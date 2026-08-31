import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ── POR QUÉ DAVID VEÍA LA APP DE HACE HORAS (26-ago) ───────────────────────────────────────
  //
  // Pasamos el día desplegando —ocho veces— y él seguía viendo la versión vieja por más que
  // navegara. No era un preview ni la caché del navegador: era **version skew**, y la causa está
  // documentada en `next/dist/docs/.../deploymentId.md`.
  //
  // Sin `deploymentId`, Next no puede DARSE CUENTA de que el servidor cambió. La app es un SPA:
  // una vez cargada, moverse entre pantallas es navegación de cliente contra el bundle que ya
  // está en memoria. Con un id de despliegue, Next manda `x-deployment-id` en cada navegación,
  // el servidor responde con el suyo, y al no coincidir el cliente fuerza una recarga completa.
  // Sin él no hay nada que comparar: la pestaña abierta se queda en la versión con la que entró,
  // para siempre, y sólo un Ctrl+Shift+R la saca de ahí — que es exactamente lo que le sirvió.
  //
  // Se usa el SHA del commit y no un valor inventado: Vercel lo expone en el build, cambia con
  // cada despliegue y es el MISMO en todas las instancias de ese despliegue, que es justo lo que
  // pide la protección de skew. En local queda `undefined` y Next simplemente no la activa.
  //
  // La alternativa era Skew Protection de Vercel, que es de los planes pagos; esto vale igual y
  // funciona en Hobby.
  //
  // ── RECORTADO A 16, Y ESO TUMBÓ TRES DESPLIEGUES ──────────────────────────────────────────
  //
  // **Vercel exige que el `deploymentId` mida 32 caracteres o menos**, y un SHA de git mide 40.
  // El build entero pasa —compila, typechequea, genera las páginas— y recién al final Vercel lo
  // rechaza: «The deploymentId "…" must be 32 characters or less». O sea que el error no aparece
  // en `next build` local, sólo allá, y por eso se subió roto.
  //
  // ── Y DESPUÉS TUMBÓ UNO MÁS, POR LA RAZÓN CONTRARIA (31-ago) ──────────────────────────────
  //
  // El id salía del SHA del commit y de nada más, así que **dos despliegues del MISMO commit
  // producían el mismo id** — y Vercel los rechaza: «A deployment with the user-configured
  // deploymentId "…" already exists in this project. User-configured deployment IDs must be
  // unique per project». El build entero pasa y revienta recién al desplegar, igual que la vez
  // del largo.
  //
  // No es un caso raro. Se dispara con:
  //   · el botón **Redeploy** del panel (mismo commit, segundo despliegue),
  //   · promover un preview a producción,
  //   · empujar el mismo commit a dos ramas —así apareció: `consolidacion` y `master` a la vez—.
  //
  // El comentario de arriba decía «64 bits, de sobra para que dos despliegues no colisionen», y
  // ahí estaba el error de razonamiento: el problema nunca fue que dos hashes distintos chocaran,
  // sino que el mismo commit **no cambia de hash**. Lo que Vercel pide es un id único por
  // DESPLIEGUE, y el commit identifica el código, no el despliegue.
  //
  // `VERCEL_DEPLOYMENT_ID` es exactamente eso y Vercel lo expone en el build. El SHA queda de
  // respaldo por si esa variable no estuviera: sin ella se vuelve al comportamiento anterior
  // —que funciona para todo commit nuevo— en vez de quedarse sin protección de skew, que es el
  // defecto que trajo a David mirando la app de hace horas.
  //
  // Sigue recortado por el tope de 32 de Vercel, y sigue siendo determinista dentro de un mismo
  // build: el id es idéntico en el bundle y en el servidor, que es la condición sin la cual esto
  // haría recargar en bucle.
  deploymentId: (process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA)?.slice(0, 32),

  // LOS `.md` DE LA DOCUMENTACIÓN TIENEN QUE VIAJAR AL DESPLIEGUE.
  //
  // `/admin/docs` los lee del disco en tiempo de petición (ver `lib/docs/catalogo.ts`: los
  // archivos son la fuente de verdad y se editan donde están). Pero Vercel no sube el repo entero:
  // sube lo que el rastreo de dependencias encuentra siguiendo los imports, y un `readFile` con una
  // ruta armada en tiempo de ejecución es invisible para ese rastreo.
  //
  // Sin esto la documentación saldría VACÍA en producción y sin ningún error — el modo de fallo más
  // caro, porque en desarrollo funciona perfecto.
  //
  // Si algún día se agrega documentación en una carpeta nueva, hay que sumarla acá además de en
  // `RAICES` de `catalogo.ts`.
  outputFileTracingIncludes: {
    "/admin/docs": ["./*.md", "./docs/**/*.md", "./athos-service/**/*.md"],
    "/admin/docs/**": ["./*.md", "./docs/**/*.md", "./athos-service/**/*.md"],
  },
};

export default nextConfig;
