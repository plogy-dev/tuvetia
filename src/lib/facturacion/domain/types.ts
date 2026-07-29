// Uniones de valores para los campos text+CHECK del schema Supabase.
// La FUENTE vive en la capa base (src/lib/supabase/facturacion-enums.ts)
// porque describe el schema y la capa base también la necesita — acá se
// re-exporta completa para que el dominio de facturación y sus consumidores
// sigan importando de este módulo como siempre.

export * from '@/lib/supabase/facturacion-enums';
