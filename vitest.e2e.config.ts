import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

// Config APARTE para los E2E. NO corre con `npm test` a propósito: los unitarios tienen que poder
// correr en cualquier máquina, sin red y en segundos, mientras estos dependen de un entorno vivo.
//
// Misma separación que el repo del cliente (`vitest.e2e.config.ts` + `e2e/**/*.e2e.ts`), incluido el
// alias de `server-only`/`client-only` a un stub vacío: sin eso no se pueden importar los módulos
// server-side fuera del runtime de Next.
//
// Dos capas de E2E, con dependencias distintas:
//   · e2e/smoke.e2e.ts       → HTTP contra el despliegue. No necesita nada instalado.
//   · e2e/*-flow.e2e.ts      → flujo full-stack contra Supabase LOCAL (requiere Docker).
export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.ts"],
    // Los E2E hablan con servicios reales: los timeouts de los unitarios no alcanzan.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // En serie: comparten estado externo (base de datos, rate limits del despliegue).
    fileParallelism: false,
    // Un fallo de red no debería teñir de rojo un PR entero al primer intento.
    retry: 1,
  },
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./e2e/_stub-empty.js", import.meta.url)),
      "client-only": fileURLToPath(new URL("./e2e/_stub-empty.js", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
})
