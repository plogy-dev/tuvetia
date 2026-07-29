import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Convención del repo cliente (port de facturación/cartera): vars/args/
    // catch con prefijo `_` son intencionalmente no usados (stubs que
    // preservan la interfaz, firmas de Server Actions, etc.).
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Landing de marketing portada 1:1 del repo landing-tuvetia (la que está
    // online). Usa <a> nativos y estilo propio a propósito — no se refactoriza
    // para mantener fidelidad con lo publicado. (Mismo override que el repo
    // del cliente.)
    files: [
      "src/app/(marketing)/**",
      "src/components/landing/**",
      "src/components/subpages/**",
      "src/lib/landing/**",
    ],
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "prefer-const": "warn",
    },
  },
]);

export default eslintConfig;
