// Several photos are read one after another. When the reader is busy or over its per-minute free limit, the next
// photo used to be skipped. Now a busy answer waits a little and tries that photo once more (owner, 2026-11-04).
export const RETRY_STATUSES = [429, 502, 503, 504]
export const RETRY_WAIT_MS = 15_000

export async function postPhotoRead(
  url: string,
  body: unknown,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Response> {
  const send = () => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const first = await send()
  if (!RETRY_STATUSES.includes(first.status)) return first
  await wait(RETRY_WAIT_MS)
  return send()
}

/** "2" / "2, 3" — the photo numbers (1-based) that could not be read. */
export const photoNumbers = (failed: number[]) => failed.map((i) => String(i + 1)).join(", ")
