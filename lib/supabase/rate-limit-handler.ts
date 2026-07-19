export async function withRetry<T>(operation: () => Promise<T>, maxRetries = 5, initialDelay = 2000): Promise<T> {
  let lastError: any

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error: any) {
      lastError = error

      const isNetworkError =
        error?.message?.includes("Load failed") ||
        error?.message?.includes("fetch failed") ||
        error?.message?.includes("network") ||
        error?.message?.includes("ECONNRESET") ||
        error?.message?.includes("ETIMEDOUT") ||
        error?.name === "TypeError"

      const isRateLimit =
        error?.message?.includes("rate limit") ||
        error?.message?.includes("Too Many") ||
        error?.status === 429 ||
        error?.code === "PGRST301" ||
        (error instanceof SyntaxError &&
          (error.message.includes("Unexpected token 'T'") ||
            error.message.includes('Unexpected identifier "Too"') ||
            error.message.includes('"Too Many R"'))) ||
        (error?.message?.includes("JSON Parse error") && error?.message?.includes("Too"))

      if ((isRateLimit || isNetworkError) && attempt < maxRetries - 1) {
        const backoff = initialDelay * Math.pow(2, attempt)
        const jitter = Math.random() * 1000
        const delay = backoff + jitter

        const reason = isRateLimit ? "Rate limit" : "Network error"
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      throw error
    }
  }

  throw lastError
}

export function isRateLimitError(error: any): boolean {
  return (
    error?.message?.includes("rate limit") ||
    error?.message?.includes("Too Many") ||
    error?.status === 429 ||
    error?.code === "PGRST301" ||
    (error instanceof SyntaxError &&
      (error.message.includes("Unexpected token 'T'") ||
        error.message.includes('Unexpected identifier "Too"') ||
        error.message.includes('"Too Many R"'))) ||
    (error?.message?.includes("JSON Parse error") && error?.message?.includes("Too"))
  )
}

export function isNetworkError(error: any): boolean {
  return (
    error?.message?.includes("Load failed") ||
    error?.message?.includes("fetch failed") ||
    error?.message?.includes("network") ||
    error?.message?.includes("ECONNRESET") ||
    error?.message?.includes("ETIMEDOUT") ||
    error?.name === "TypeError"
  )
}
