import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest para los tests que MONTAN un componente de React.
//
// POR QUÉ EXISTE ESTA CUARTA CONFIG. `vitest.config.mts` corre en `environment: "node"` e incluye
// sólo `src/**/*.test.ts`: los `.tsx` quedaban fuera por partida doble, y varios módulos del repo
// documentan esa carencia como criterio de diseño («lo que quiera cobertura tiene que ser un
// `.ts`», `lib/consulta-viva/sesion.ts`). Esa regla sirvió para sacar lógica de los componentes,
// pero deja sin red justo lo que el cliente reporta: BOTONES que dejan de responder.
//
// El defecto del 28-ago —una bandera de «cargando» que no vuelve a `false` cuando la promesa
// rechaza, con el botón `disabled` colgado de ella— no se puede probar sin montar: no hay función
// pura que extraer, porque el defecto ESTÁ en el ciclo de vida.
//
// Se deja aparte y no se fusiona con la config de siempre a propósito: jsdom es más lento y más
// frágil que Node, y los 2.283 tests existentes no tienen por qué pagar eso. `npm test` sigue
// siendo exactamente lo que era.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    setupFiles: ["./vitest.componentes.setup.ts"],
  },
  resolve: {
    alias: [
      // Mismos stubs y alias que las otras tres configs: `server-only`/`client-only` no hacen nada
      // en Node pero ROMPEN el import, y sin los alias no resuelve ni un `@/` del repo.
      { find: /^server-only$/, replacement: fileURLToPath(new URL("./e2e/_stub-empty.js", import.meta.url)) },
      { find: /^client-only$/, replacement: fileURLToPath(new URL("./e2e/_stub-empty.js", import.meta.url)) },
      { find: /^@\/public\//, replacement: fileURLToPath(new URL("./public/", import.meta.url)) },
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
    ],
  },
});
