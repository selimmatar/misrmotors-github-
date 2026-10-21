// "Save & Generate PDF" on a new quotation: browsers block a window opened after the save request returns (Chrome after
// ~5 s, Safari after any await), so the PDF never appeared although the quotation was saved. The window is now opened on
// the click itself and pointed at the PDF once the save succeeds.
import test from "node:test"
import assert from "node:assert/strict"
import { openPendingWindow } from "../print/pending-window"

function fakeHost(blocked = false) {
  const calls: string[] = []
  const popup = { closed: false, location: { href: "" }, document: { title: "", body: { textContent: "" } }, close() { this.closed = true } }
  return {
    calls,
    popup,
    host: { open: (url?: string) => { calls.push(url ?? ""); return blocked ? null : (popup as any) } },
  }
}

test("W1. Opens a blank window right away, then sends it to the PDF", () => {
  const { host, popup, calls } = fakeHost()
  const pending = openPendingWindow(host, "Preparing PDF…")
  assert.deepEqual(calls, [""])
  assert.equal(popup.document.body.textContent, "Preparing PDF…")
  assert.equal(pending.go("/api/quotations/generate?qn=QT-1"), true)
  assert.equal(popup.location.href, "/api/quotations/generate?qn=QT-1")
  assert.equal(calls.length, 1, "no second, blockable window.open")
})

test("W2. A failed save closes the blank window", () => {
  const { host, popup } = fakeHost()
  openPendingWindow(host).close()
  assert.equal(popup.closed, true)
})

test("W3. Blocked popup: go() reports false so the page can show its own link", () => {
  const { host } = fakeHost(true)
  const pending = openPendingWindow(host)
  assert.equal(pending.go("/x"), false)
  assert.doesNotThrow(() => pending.close())
})

test("W4. The user closed the blank window before the save finished: go() reports false", () => {
  const { host, popup } = fakeHost()
  const pending = openPendingWindow(host)
  popup.closed = true
  assert.equal(pending.go("/x"), false)
})
