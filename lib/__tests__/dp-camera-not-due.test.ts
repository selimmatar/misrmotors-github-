// Owner requests 2026-11-26: (1) the signed delivery permit upload offers "Take photo" (the phone camera directly,
// several photos one after another, thumbnails with a remove "×") and "Upload file"; (3) in Accounts Receivable /
// Payable an unpaid invoice that is not overdue reads "Not due yet" / "لم يحن موعدها" (label only).
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { computeArStatus, paymentStatusLabelKey } from "../ar-status"

const REPO = process.env.REPO_ROOT || process.cwd()
const read = (f: string) => readFileSync(join(REPO, f), "utf8")
const i18n = read("lib/i18n-context.tsx")
const arAt = i18n.indexOf("\n  ar: {")
const en = (k: string) => new RegExp(`"${k.replace(/\./g, "\\.")}": "([^"]*)"`).exec(i18n.slice(0, arAt))?.[1]
const ar = (k: string) => new RegExp(`"${k.replace(/\./g, "\\.")}": "([^"]*)"`).exec(i18n.slice(arAt))?.[1]

test("C1. the picker: a camera input (accept image/*, capture environment) and a file input (photos / PDF, several)", () => {
  const src = read("components/delivery-permit/signed-files-picker.tsx")
  assert.match(src, /export const CAMERA_ACCEPT = "image\/\*"/)
  assert.match(src, /export const CAMERA_CAPTURE = "environment"/)
  assert.match(src, /export const FILE_ACCEPT = "image\/\*,\.pdf"/)
  // the camera input
  const inputs = [...src.matchAll(/<input\b[\s\S]*?\/>/g)].map((m) => m[0])
  assert.equal(inputs.length, 2)
  const camera = inputs.find((i) => i.includes("capture="))!
  assert.ok(camera.includes('type="file"') && camera.includes("accept={CAMERA_ACCEPT}") && camera.includes("capture={CAMERA_CAPTURE}") && camera.includes("onChange={onCamera}"))
  assert.ok(!camera.includes("multiple"), "one photo per shot; the next shot adds to the list")
  const file = inputs.find((i) => !i.includes("capture="))!
  assert.ok(file.includes('type="file"') && file.includes("accept={FILE_ACCEPT}") && file.includes("multiple"))
  // two clear buttons that open them
  assert.match(src, /onClick=\{\(\) => cameraRef\.current\?\.click\(\)\}/)
  assert.match(src, /onClick=\{\(\) => fileRef\.current\?\.click\(\)\}/)
  assert.ok(src.includes('t("permit.take-photo")') && src.includes('t("permit.upload-file")'))
  // each photo is shrunk (lib/shrink-photo.ts) and ADDED to the list; the input is cleared for the next shot
  assert.match(src, /import \{ shrinkPhoto \} from "@\/lib\/shrink-photo"/)
  assert.match(src, /onChange\(\[\.\.\.latest\.current, \.\.\.added\]\)/)
  assert.match(src, /onChange\(\[\.\.\.latest\.current, \.\.\.picked\]\)/)
  assert.equal((src.match(/e\.target\.value = ""/g) || []).length, 2)
  // a thumbnail per file and a remove ×
  assert.match(src, /URL\.createObjectURL\(f\)/)
  assert.match(src, /URL\.revokeObjectURL/)
  assert.match(src, /onClick=\{\(\) => remove\(i\)\}/)
  assert.match(src, /files\.filter\(\(_, i\) => i !== index\)/)
})

test("C2. used wherever shipping uploads the signed permit; the files go on to the reader and the confirmation", () => {
  const ship = read("components/modules/shipping-module.tsx")
  assert.match(ship, /<SignedFilesPicker id=\{`signed-\$\{permit\.id\}`\}\s+files=\{signedFiles\}\s+onChange=\{setSignedFiles\}/)
  assert.ok(!/type="file"/.test(ship), "the old bare file input is gone")
  assert.match(ship, /<NotReceivedDialog[\s\S]*?files=\{filesToSend\}/)
  const widget = read("components/delivery-permit/signed-upload-widget.tsx")
  assert.match(widget, /<SignedFilesPicker /)
  assert.match(widget, /for \(const file of selectedFiles\)/)
  assert.match(widget, /onUploadComplete\(lastUrl, files, sentIds\)/)
  const card = read("components/delivery-permit/delivery-permit-card.tsx")
  assert.match(card, /if \(files && files\.length > 0\) setCheckFiles\(files\)/)
  // the reader still shrinks every photo
  assert.match(read("components/delivery-permit/not-received-dialog.tsx"), /shrinkPhoto\(file, "signed-permit"\)/)
})

test("C3. the picker's texts in both languages, before eta.go-live-started", () => {
  const keys = ["permit.take-photo", "permit.take-another-photo", "permit.upload-file", "permit.photos-to-upload", "permit.photo-hint", "ar.not-due-yet"]
  for (const k of keys) {
    assert.ok(en(k) && ar(k), k)
    assert.ok(i18n.indexOf(`"${k}"`) < i18n.indexOf('"eta.go-live-started"'), `${k} (en)`)
    assert.ok(i18n.indexOf(`"${k}"`, arAt) < i18n.indexOf('"eta.go-live-started"', arAt), `${k} (ar)`)
  }
  assert.equal(en("permit.take-photo"), "Take photo")
  assert.equal(ar("permit.take-photo"), "التقاط صورة")
  assert.equal(en("permit.upload-file"), "Upload file")
  assert.equal(ar("permit.upload-file"), "رفع ملف")
})

test("C4. AR / AP: an unpaid invoice that is not overdue reads 'Not due yet' / 'لم يحن موعدها' (label only)", () => {
  assert.equal(paymentStatusLabelKey("pending"), "ar.not-due-yet")
  for (const s of ["paid", "overdue", "partially_paid", "due-soon", "partial"]) assert.equal(paymentStatusLabelKey(s), `status.${s}`)
  assert.equal(en("ar.not-due-yet"), "Not due yet")
  assert.equal(ar("ar.not-due-yet"), "لم يحن موعدها")
  assert.equal(en("ap.pending-invoices"), "Not due yet")
  assert.equal(ar("ap.pending-invoices"), "لم يحن موعدها")
  // the stored value is unchanged, and other "pending" meanings keep their label
  assert.equal(computeArStatus({ amount: 100, collectedAmount: 0, dueDate: "2999-01-01" }), "pending")
  assert.equal(en("status.pending"), "Pending")
  assert.equal(ar("status.pending"), "قيد الانتظار")
  const arMod = read("components/modules/accounts-receivable-module.tsx")
  assert.ok(!arMod.includes('t("status.pending")'))
  assert.ok(!/t\(`status\.\$\{/.test(arMod), "every AR status label goes through paymentStatusLabelKey")
  assert.match(arMod, /\{t\("ar\.not-due-yet"\)\} \(\{formatNumber\(tabInvoices\.filter\(\(i\) => getInvoiceStatus\(i\) === "pending"\)/)
  assert.ok((arMod.match(/t\(paymentStatusLabelKey\(/g) || []).length >= 4)
  const apMod = read("components/modules/accounts-payable-module.tsx")
  assert.ok(!/t\(`status\.\$\{/.test(apMod))
  assert.ok((apMod.match(/t\(paymentStatusLabelKey\(/g) || []).length >= 3)
  // filters still use the stored value
  assert.match(arMod, /getInvoiceStatus\(inv\) === "pending"/)
})
