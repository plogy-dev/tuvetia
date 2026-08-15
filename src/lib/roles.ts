/**
 * Los nombres con los que se muestra `profiles.role`. UN solo vocabulario para los tres valores.
 *
 * Vivía suelto en `dashboard/settings/page.tsx`. Sale de ahí porque el pie de la barra lateral pasó
 * a mostrar el rol también, y dos mapas para el mismo enum es la forma más barata de terminar con
 * "Veterinario" en una pantalla y "Vet" en la otra.
 *
 * NO importa nada de `lib/supabase/*`: lo consume `nav-user.tsx`, que es un componente de cliente.
 * Meter acá el `createClient()` de servidor arrastraría ese árbol al bundle del navegador — por eso
 * esto es un archivo aparte y no un export más de `lib/clinic-role.ts`, que sí es de servidor.
 */
export const ROLES_LEGIBLES: Record<string, string> = {
  admin: "Administrador",
  vet: "Veterinario",
  assistant: "Asistente",
}

/**
 * El rol en palabras, o `null` si no se reconoce.
 *
 * Devuelve `null` y no el valor crudo a propósito: un rol nuevo agregado en la base saldría en
 * pantalla como `"tech_support"` hasta que alguien lo note. Mejor que la línea desaparezca.
 */
export function rolLegible(role: string | null | undefined): string | null {
  return role ? (ROLES_LEGIBLES[role] ?? null) : null
}
