// Desmonta el árbol entre pruebas y completa lo que jsdom no trae.
//
// La limpieza automática de Testing Library se engancha sola sólo cuando el runner expone
// `afterEach` como global. Este repo corre con `globals: false` —los tests importan `describe`,
// `it` y `expect` de `vitest` a mano— así que hay que registrarla acá. Sin esto, un componente
// montado en una prueba sigue vivo en la siguiente y `getBy*` encuentra dos.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom no implementa ninguna de estas dos, y los primitivos de `@base-ui/react` (drawer, diálogo,
// popover) las usan para medir. Sin los reemplazos, montar cualquier cosa con un portal revienta
// con `ResizeObserver is not defined` — que no es el defecto que se está probando.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
});
