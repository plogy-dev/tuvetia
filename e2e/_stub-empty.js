// Stub vacío para aliasar `server-only` / `client-only` fuera del runtime de Next.
// Esos paquetes existen solo para que el bundler falle si un módulo cruza la frontera
// servidor/cliente; en Node puro no hacen nada y romperían el import.
export {}
