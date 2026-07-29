// Freno simple por clave en memoria (por instancia serverless — suficiente como primer freno
// contra loops/doble-click; el presupuesto duro por clínica es fase posterior).

const buckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(key: string, max: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterSeconds: 0 }
  }
  b.count += 1
  if (b.count > max) return { allowed: false, retryAfterSeconds: Math.ceil((b.resetAt - now) / 1000) }
  return { allowed: true, retryAfterSeconds: 0 }
}
