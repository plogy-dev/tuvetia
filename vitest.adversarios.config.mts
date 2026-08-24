import { defineConfig } from "vitest/config"
import { loadEnv } from "vite"
import { fileURLToPath } from "node:url"

// Config APARTE para el BANCO ADVERSARIO, por el mismo motivo que la de los E2E: no puede correr
// con `npm test`. Llama a un modelo real, cuesta tokens y tarda minutos, mientras los unitarios
// tienen que correr sin red y en segundos.
//
// Tres configs, tres instrumentos distintos:
//   · vitest.config.mts             → unitarios puros. CI, cada push.
//   · vitest.e2e.config.mts         → HTTP contra el despliegue. Cada 6 h.
//   · vitest.adversarios.config.mts → el agente contra ataques por inyección. A mano, cuando se
//                                     toca el prompt o se cambia de modelo.
//
// `loadEnv` está para que la credencial salga de `.env.local` como en `next dev`: vitest no lee los
// .env por su cuenta, y sin esto habría que exportar la key a mano en cada corrida. El tercer
// argumento vacío carga TODAS las variables, no sólo las `VITE_`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["adversarios/**/*.adversario.ts"],
    env: loadEnv("", process.cwd(), ""),
    // Un caso son varias llamadas al modelo encadenadas; el timeout real lo pone el propio test.
    testTimeout: 30 * 60_000,
    hookTimeout: 60_000,
    // En serie: se comparte el límite de tasa del proveedor.
    fileParallelism: false,
    // NO reintentar. Un reintento acá esconde justamente lo que se quiere ver.
    retry: 0,
  },
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: fileURLToPath(new URL("./e2e/_stub-empty.js", import.meta.url)) },
      { find: /^client-only$/, replacement: fileURLToPath(new URL("./e2e/_stub-empty.js", import.meta.url)) },
      { find: /^@\/public\//, replacement: fileURLToPath(new URL("./public/", import.meta.url)) },
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
    ],
  },
})
