import "server-only"

type RateLimitBucket = {
  count: number
  resetAt: number
}

type RateLimitOptions = {
  max: number
  windowMs: number
}

type RateLimitResult = {
  allowed: boolean
  retryAfterSeconds?: number
}

const buckets = new Map<string, RateLimitBucket>()

export function checkRateLimit(
  key: string,
  { max, windowMs }: RateLimitOptions,
): RateLimitResult {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true }
  }

  if (bucket.count >= max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    }
  }

  bucket.count += 1
  return { allowed: true }
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")
  const firstIp = forwardedFor?.split(",")[0]?.trim()
  return firstIp || request.headers.get("x-real-ip") || "unknown"
}
