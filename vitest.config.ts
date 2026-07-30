import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest para los tests de lógica pura (sin DB ni runtime de Next).
// Resuelve los alias `@/public/*` y `@/*` igual que tsconfig.json para que
// los imports internos funcionen dentro de los tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: [
      // `server-only` y `client-only` existen sólo para que el bundler falle si un módulo cruza la
      // frontera servidor/cliente. En Node puro no hacen nada y ROMPEN el import, así que sin este
      // alias no se puede probar ni un solo módulo de servidor. Mismo stub que usa la config e2e.
      { find: /^server-only$/, replacement: fileURLToPath(new URL("./e2e/_stub-empty.js", import.meta.url)) },
      { find: /^client-only$/, replacement: fileURLToPath(new URL("./e2e/_stub-empty.js", import.meta.url)) },
      { find: /^@\/public\//, replacement: fileURLToPath(new URL("./public/", import.meta.url)) },
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
    ],
  },
});
