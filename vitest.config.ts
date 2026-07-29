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
      { find: /^@\/public\//, replacement: fileURLToPath(new URL("./public/", import.meta.url)) },
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
    ],
  },
});
