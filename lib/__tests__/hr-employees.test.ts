// Employees: edit, switch off (Suspended / Terminated / Resigned also switches off a linked login), and delete only
// when there is no history. Owner request 2026-10-31.
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { FakeDb } from "./fake-db"
import { useDb } from "./route-harness"
import * as employees from "../../app/api/hr/employees/route"
import { cleanEmployeeUpdate, deleteBlocker, isInactiveStatus, statusDates } from "../hr/employee-rules"

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, "..", "..", "..", "..")
const read = (f: string) => fs.readFileSync(path.join(REPO, f), "utf8")

test("cleanEmployeeUpdate keeps only form fields and checks them", () => {
  const r = cleanEmployeeUpdate({
    employee_id: 4, employee_number: "EMP-9", department: { x: 1 }, created_at: "x",
    full_name: "  Ahmed  ", email: "", phone: " 010 ", department_id: "3", position_id: "",
    hire_date: "2026-01-05", employment_type: "full_time", employment_status: "resigned",
  })
  assert.ok(r.ok)
  assert.deepEqual(r.ok && r.value, {
    full_name: "Ahmed", email: null, phone: "010", hire_date: "2026-01-05",
    department_id: 3, position_id: null, employment_type: "full_time", employment_status: "resigned",
  })
  assert.equal(cleanEmployeeUpdate({ full_name: " " }).ok, false)
  assert.equal(cleanEmployeeUpdate({ employment_status: "fired" }).ok, false)
  assert.equal(cleanEmployeeUpdate({ department_id: "abc" }).ok, false)
  assert.equal(cleanEmployeeUpdate({ hire_date: "" }).ok, false)
  assert.equal(cleanEmployeeUpdate(null).ok, false)
})

test("inactive statuses and leaving date", () => {
  assert.deepEqual(["active", "on_leave", "suspended", "terminated", "resigned"].map(isInactiveStatus), [false, false, true, true, true])
  assert.deepEqual(statusDates("active", "terminated", "2026-10-31"), { termination_date: "2026-10-31" })
  assert.deepEqual(statusDates("terminated", "resigned", "2026-10-31"), {})
  assert.deepEqual(statusDates("resigned", "active", "2026-10-31"), { termination_date: null })
  assert.deepEqual(statusDates("active", "suspended", "2026-10-31"), {})
})

test("deleteBlocker: only a clean record may be deleted", () => {
  assert.equal(deleteBlocker({ salaryPayments: 0, payRecords: 0, documents: 0, logins: 0 }), null)
  assert.match(deleteBlocker({ salaryPayments: 2, payRecords: 0, documents: 0, logins: 1 })!, /2 salary payment.*login.*Inactive/)
})

function setup(extra: Record<string, any[]> = {}) {
  const calls: any[] = []
  const db: any = new FakeDb({
    hr_employees: [
      { employee_id: 1, employee_number: "EMP-1", full_name: "Ahmed", employment_status: "active", hire_date: "2025-01-01" },
      { employee_id: 2, employee_number: "EMP-2", full_name: "Mona", employment_status: "active", hire_date: "2025-01-01" },
    ],
    users: [
      { user_id: 10, full_name: "Ahmed", roles: ["sales-rep"], employee_id: 1, is_active: true, auth_user_id: "auth-10" },
      { user_id: 11, full_name: "Owner", roles: ["admin"], employee_id: 2, is_active: true, auth_user_id: "auth-11" },
    ],
    salary_payments: [],
    employee_compensation: [],
    employee_documents: [],
    ...extra,
  })
  db.auth = { admin: { updateUserById: async (id: string, attrs: any) => { calls.push({ id, attrs }); return { data: {}, error: null } } } }
  useDb(db)
  return { db, calls }
}
const send = async (method: string, body: unknown, actor?: number) => {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (actor) headers["x-mm-user-id"] = String(actor)
  const handler = (employees as any)[method]
  const res: Response = await handler(new Request("http://t/api/hr/employees", { method, headers, body: JSON.stringify(body) }))
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

test("PUT edits the details and ignores fields the form does not own", async () => {
  const { db, calls } = setup()
  const r = await send("PUT", { employee_id: 1, full_name: "Ahmed Ali", phone: "0100", employee_number: "HACK", department: { a: 1 } })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const row = db.snapshot().hr_employees.find((e: any) => e.employee_id === 1)
  assert.equal(row.full_name, "Ahmed Ali")
  assert.equal(row.phone, "0100")
  assert.equal(row.employee_number, "EMP-1")
  assert.equal(r.body.loginsTurnedOff, 0)
  assert.equal(calls.length, 0)
})

test("PUT to Terminated sets the leaving date and switches off the linked login", async () => {
  const { db, calls } = setup()
  const r = await send("PUT", { employee_id: 1, employment_status: "terminated" }, 11)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.loginsTurnedOff, 1)
  const emp = db.snapshot().hr_employees.find((e: any) => e.employee_id === 1)
  assert.equal(emp.employment_status, "terminated")
  assert.match(emp.termination_date, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(db.snapshot().users.find((u: any) => u.user_id === 10).is_active, false)
  assert.equal(calls[0].id, "auth-10")
  assert.equal(calls[0].attrs.ban_duration, "876000h")
  assert.equal(calls[0].attrs.app_metadata.active, false)

  // Back to Active: leaving date cleared, login left off (turned on again by hand in User Management).
  const back = await send("PUT", { employee_id: 1, employment_status: "active" }, 11)
  assert.equal(back.status, 200)
  assert.equal(db.snapshot().hr_employees.find((e: any) => e.employee_id === 1).termination_date, null)
  assert.equal(db.snapshot().users.find((u: any) => u.user_id === 10).is_active, false)
  assert.equal(calls.length, 1)
})

test("PUT never switches off the login of the person doing the edit", async () => {
  const { db, calls } = setup()
  const r = await send("PUT", { employee_id: 2, employment_status: "suspended" }, 11)
  assert.equal(r.status, 200)
  assert.equal(r.body.loginsTurnedOff, 0)
  assert.equal(db.snapshot().users.find((u: any) => u.user_id === 11).is_active, true)
  assert.equal(calls.length, 0)
})

test("PUT: bad input → 400, unknown employee → 404", async () => {
  setup()
  assert.equal((await send("PUT", { full_name: "x" })).status, 400)
  assert.equal((await send("PUT", { employee_id: 1, employment_status: "fired" })).status, 400)
  assert.equal((await send("PUT", { employee_id: 99, full_name: "x" })).status, 404)
})

test("DELETE removes a clean record for good", async () => {
  const { db } = setup({ users: [] })
  const r = await send("DELETE", { employee_id: 2 })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(db.snapshot().hr_employees.some((e: any) => e.employee_id === 2), false)
})

test("DELETE refuses when there is history or a linked login, and keeps the record", async () => {
  const { db } = setup({ salary_payments: [{ payment_id: 1, employee_id: 2 }] })
  let r = await send("DELETE", { employee_id: 2 })
  assert.equal(r.status, 409)
  assert.equal(r.body.keep, true)
  r = await send("DELETE", { employee_id: 1 }) // has a login
  assert.equal(r.status, 409)
  assert.equal(db.snapshot().hr_employees.length, 2)
  assert.equal((await send("DELETE", { employee_id: 99 })).status, 404)
  assert.equal((await send("DELETE", {})).status, 400)
})

test("HR screen: Edit and Delete buttons, edit form saves with PUT, Resigned offered, texts in EN and AR", () => {
  const src = read("components/modules/hr-management-module.tsx")
  assert.match(src, /setEditingEmployee\(selectedEmployee\)/)
  assert.match(src, /deleteEmployee\(selectedEmployee\)/)
  assert.match(src, /method: editing \? "PUT" : "POST"/)
  assert.match(src, /<SelectItem value="resigned">/)
  const i18n = read("lib/i18n-context.tsx")
  for (const k of ["hr.edit-employee-desc", "hr.inactive-login-note", "hr.saved", "hr.save-failed", "hr.logins-turned-off",
    "hr.delete-confirm", "hr.delete-blocked", "hr.delete-blocked-desc", "hr.delete-failed", "hr.employee-deleted"]) {
    assert.equal(i18n.split(`"${k}":`).length - 1, 2, k)
  }
})
