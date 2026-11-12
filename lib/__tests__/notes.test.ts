// Notes / latest updates on sales orders, quotations and purchase orders (owner request, 2026-11-12).
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FakeDb } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as notesRoute from "../../app/api/notes/route"

const src = (p: string) => readFileSync(join(process.env.REPO_ROOT || process.cwd(), p), "utf8")
const get = async (query: string) => {
  const res = await (notesRoute.GET as any)(new Request(`http://test.local/api/notes${query}`))
  return { status: res.status, body: await res.json() }
}
const del = async (query: string) => {
  const res = await (notesRoute.DELETE as any)(new Request(`http://test.local/api/notes${query}`, { method: "DELETE" }))
  return { status: res.status, body: await res.json() }
}

test("N1. add, list (newest first), edit and delete a note; each document has its own notes; counts for the badges", async () => {
  const db = new FakeDb({ workflow_events: [], users: [] })
  useDb(db)
  const a = await call(notesRoute.POST as any, "POST", { type: "so", id: 4, text: "Customer wants the 5-ton by Sunday" })
  assert.equal(a.status, 200, JSON.stringify(a.body))
  db.tables.workflow_events[0].performed_at = "2026-11-12T10:00:00"
  const b = await call(notesRoute.POST as any, "POST", { type: "so", id: 4, text: "Supplier confirmed delivery Thursday" })
  db.tables.workflow_events[1].performed_at = "2026-11-12T11:00:00"
  await call(notesRoute.POST as any, "POST", { type: "po", id: 4, text: "PO note, not an order note" })
  const list = await get("?type=so&id=4")
  assert.deepEqual(list.body.notes.map((n: any) => n.text), ["Supplier confirmed delivery Thursday", "Customer wants the 5-ton by Sunday"])
  const counts = await get("?type=so&counts=1")
  assert.deepEqual(counts.body.counts, { 4: 2 })
  const edited = await call(notesRoute.PUT as any, "PUT", { noteId: b.body.note.id, text: "Supplier confirmed delivery Friday" })
  assert.equal(edited.status, 200, JSON.stringify(edited.body))
  assert.ok(edited.body.note.editedAt)
  assert.equal((await del(`?noteId=${a.body.note.id}`)).status, 200)
  assert.deepEqual((await get("?type=so&id=4")).body.notes.map((n: any) => n.text), ["Supplier confirmed delivery Friday"])
  assert.equal((await get("?type=po&id=4")).body.notes.length, 1)
})

test("N2. empty or unknown input is refused; a note cannot be emptied (delete it instead)", async () => {
  useDb(new FakeDb({ workflow_events: [], users: [] }))
  assert.equal((await call(notesRoute.POST as any, "POST", { type: "so", id: 4, text: "   " })).status, 400)
  assert.equal((await call(notesRoute.POST as any, "POST", { type: "invoice", id: 4, text: "x" })).status, 400)
  const a = await call(notesRoute.POST as any, "POST", { type: "quotation", id: 9, text: "x" })
  assert.equal((await call(notesRoute.PUT as any, "PUT", { noteId: a.body.note.id, text: "" })).status, 400)
  assert.equal((await del("?noteId=999")).status, 404)
})

test("N3. the Notes button is on the sales orders, purchase orders and quotations lists", () => {
  assert.match(src("components/modules/sales-order-module.tsx"), /<NotesButton type="so"/)
  assert.match(src("components/modules/purchase-order-module.tsx"), /<NotesButton type="po"/)
  assert.match(src("components/modules/approve-sales-quotations-module.tsx"), /<NotesButton type="quotation"/)
})
