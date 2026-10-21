// A print/PDF window opened on the user's click, before any await, so popup blockers allow it; it is pointed at the real
// URL once the data is ready. Browsers block window.open calls made after a network request returns.
type PopupLike = { closed: boolean; location: { href: string }; document?: { title: string; body?: { textContent: string | null } | null }; close(): void }
type HostLike = { open(url?: string, target?: string): PopupLike | null }

export interface PendingWindow {
  /** Sends the window to `url`. False when the popup was blocked or already closed — show an on-page link instead. */
  go(url: string): boolean
  close(): void
}

export function openPendingWindow(host: HostLike = window as unknown as HostLike, message = ""): PendingWindow {
  let popup: PopupLike | null = null
  try {
    popup = host.open("", "_blank")
    if (popup?.document && message) {
      popup.document.title = message
      if (popup.document.body) popup.document.body.textContent = message
    }
  } catch {
    popup = null
  }
  return {
    go(url) {
      if (!popup || popup.closed) return false
      popup.location.href = url
      return true
    },
    close() {
      try {
        if (popup && !popup.closed) popup.close()
      } catch {}
    },
  }
}
