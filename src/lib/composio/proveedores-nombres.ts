// Lo mínimo de los proveedores de correo que también necesita el navegador: el tipo y cómo se
// llaman en pantalla.
//
// Vive aparte de `proveedores.ts` porque ese archivo es `server-only` — tiene los slugs de las
// tools y lee variables de entorno, nada de lo cual puede cruzar al cliente. Los botones de
// "Conectar Gmail / Conectar Outlook" solo necesitan esto.

export type Proveedor = "gmail" | "outlook"

/** Cómo lo ve el veterinario. */
export const NOMBRE_PROVEEDOR: Record<Proveedor, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
}
