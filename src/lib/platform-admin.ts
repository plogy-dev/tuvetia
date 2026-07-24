// Gate del panel de plataforma (/admin) — SOLO servidor.
// Allowlist de emails en PLATFORM_ADMIN_EMAILS (separados por coma). Sin la env, nadie entra
// (seguro por defecto). El panel es ajeno al producto: no usa roles de clínica.

export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false
  const raw = process.env.PLATFORM_ADMIN_EMAILS
  if (!raw) return false
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase())
}
