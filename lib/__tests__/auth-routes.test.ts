// Login routes (security build, Task 4): login, logout, me, forgot, change password, and the email-link callback.
// Supabase's login service is replaced by a small fake attached to the FakeDb (the harness hands the FakeDb to routes
// as both the cookie client and the admin client).
import "./route-harness"
import test from "node:test"
import assert from "node:assert/strict"
import { FakeDb } from "./fake-db"
import { call, useDb } from "./route-harness"
import * as login from "../../app/api/auth/login/route"
import * as logout from "../../app/api/auth/logout/route"
import * as me from "../../app/api/auth/me/route"
import * as forgot from "../../app/api/auth/forgot/route"
import * as changePassword from "../../app/api/auth/change-password/route"
import * as callback from "../../app/auth/callback/route"

type Calls = Record<string, any[]>
function fakeAuth(opts: { password?: string; authUserId?: string; loggedIn?: boolean } = {}) {
  const calls: Calls = { signIn: [], signOut: [], updateUser: [], reset: [], exchange: [] }
  const auth = {
    signInWithPassword: async (args: { email: string; password: string }) => {
      calls.signIn.push(args)
      if (args.password !== (opts.password ?? "right-password")) return { data: { user: null }, error: { message: "Invalid login credentials" } }
      return { data: { user: { id: opts.authUserId ?? "auth-1" } }, error: null }
    },
    getUser: async () => ({ data: { user: opts.loggedIn ? { id: opts.authUserId ?? "auth-1" } : null }, error: null }),
    signOut: async () => {
      calls.signOut.push(true)
      return { error: null }
    },
    updateUser: async (args: unknown) => {
      calls.updateUser.push(args)
      return { data: {}, error: null }
    },
    resetPasswordForEmail: async (email: string, o: unknown) => {
      calls.reset.push({ email, o })
      return { data: {}, error: null }
    },
    exchangeCodeForSession: async (code: string) => {
      calls.exchange.push(code)
      return { data: {}, error: null }
    },
  }
  return { auth, calls }
}
const row = (over: Record<string, unknown> = {}) => ({
  user_id: 7,
  full_name: "Mona Accountant",
  email: "mona@example.com",
  login_method: "email",
  roles: ["accountant", "not-a-role"],
  is_active: true,
  must_change_password: true,
  auth_user_id: "auth-1",
  ...over,
})
function setup(seedRow: Record<string, unknown> | null, authOpts?: Parameters<typeof fakeAuth>[0]) {
  const db: any = new FakeDb({ users: seedRow ? [seedRow] : [] })
  const { auth, calls } = fakeAuth(authOpts)
  db.auth = auth
  useDb(db)
  return { db, calls }
}

test("login: wrong password → 401 BAD_LOGIN", async () => {
  setup(row())
  const r = await call(login.POST, "POST", { identifier: "mona@example.com", password: "nope" })
  assert.equal(r.status, 401)
  assert.equal(r.body.code, "BAD_LOGIN")
})

test("login: right password → user with known roles only, last login saved, idle cookie set", async () => {
  const { db } = setup(row())
  const res = await login.POST(new Request("http://t/api/auth/login", { method: "POST", body: JSON.stringify({ identifier: "mona@example.com", password: "right-password" }) }))
  assert.equal(res.status, 200)
  const body: any = await res.json()
  assert.deepEqual(body.user, { userId: 7, name: "Mona Accountant", roles: ["accountant"], mustChangePassword: true })
  assert.match(res.headers.get("set-cookie") || "", /mm_seen=\d+; Path=\/; HttpOnly; Secure; SameSite=Lax/)
  const saved = db.snapshot().users[0]
  assert.ok(saved.last_login_at, "last_login_at is set")
})

test("login: turned-off account → 403 ACCOUNT_OFF and signed out", async () => {
  const { calls } = setup(row({ is_active: false }))
  const r = await call(login.POST, "POST", { identifier: "mona@example.com", password: "right-password" })
  assert.equal(r.status, 403)
  assert.equal(r.body.code, "ACCOUNT_OFF")
  assert.equal(calls.signOut.length, 1)
})

test("login: a login with no users row → 403 and signed out", async () => {
  const { calls } = setup(null)
  const r = await call(login.POST, "POST", { identifier: "ghost@example.com", password: "right-password" })
  assert.equal(r.status, 403)
  assert.equal(calls.signOut.length, 1)
})

test("login: a username signs in with the hidden staff address", async () => {
  const { calls } = setup(row({ login_method: "username", username: "ahmed" }))
  await call(login.POST, "POST", { identifier: "Ahmed", password: "right-password" })
  assert.equal(calls.signIn[0].email, "ahmed@staff.misrmotors.app")
})

test("logout: signs out and clears the idle cookie", async () => {
  const { calls } = setup(row(), { loggedIn: true })
  const res = await logout.POST()
  assert.equal(res.status, 200)
  assert.equal(calls.signOut.length, 1)
  assert.match(res.headers.get("set-cookie") || "", /mm_seen=; .*Max-Age=0/)
})

test("me: mode always present; user null when logged out or turned off", async () => {
  setup(row(), { loggedIn: false })
  let r = await call(me.GET as any, "GET")
  assert.equal(r.body.mode, "off")
  assert.equal(r.body.user, null)
  setup(row({ is_active: false }), { loggedIn: true })
  r = await call(me.GET as any, "GET")
  assert.equal(r.body.user, null)
  setup(row(), { loggedIn: true })
  r = await call(me.GET as any, "GET")
  assert.equal(r.body.user.userId, 7)
  assert.deepEqual(r.body.user.roles, ["accountant"])
})

test("forgot: always 200; real address gets the link, staff address and junk get nothing", async () => {
  const { calls } = setup(null)
  let r = await call(forgot.POST, "POST", { email: "Unknown@Example.com" }, "https://misrmotors.app/api/auth/forgot")
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { ok: true })
  assert.equal(calls.reset.length, 1)
  assert.equal(calls.reset[0].email, "unknown@example.com")
  assert.deepEqual(calls.reset[0].o, { redirectTo: "https://misrmotors.app/auth/callback?next=/auth/reset" })
  r = await call(forgot.POST, "POST", { email: "ahmed@staff.misrmotors.app" })
  assert.equal(r.status, 200)
  r = await call(forgot.POST, "POST", { email: "not an email" })
  assert.equal(r.status, 200)
  assert.equal(calls.reset.length, 1)
})

test("change-password: needs a login, at least 8 characters, then clears the must-change flag", async () => {
  setup(row(), { loggedIn: false })
  let r = await call(changePassword.POST, "POST", { password: "long-enough" })
  assert.equal(r.status, 401)
  const { db, calls } = setup(row(), { loggedIn: true })
  r = await call(changePassword.POST, "POST", { password: "short" })
  assert.equal(r.status, 400)
  assert.equal(calls.updateUser.length, 0)
  r = await call(changePassword.POST, "POST", { password: "long-enough" })
  assert.equal(r.status, 200)
  assert.deepEqual(calls.updateUser[0], { password: "long-enough" })
  assert.equal(db.snapshot().users[0].must_change_password, false)
})

test("callback: exchanges the code and only redirects to same-site paths", async () => {
  const { calls } = setup(null)
  const go = async (q: string) => (await callback.GET(new Request(`https://misrmotors.app/auth/callback${q}`))).headers.get("location")
  assert.equal(await go("?code=abc&next=/auth/reset"), "https://misrmotors.app/auth/reset")
  assert.deepEqual(calls.exchange, ["abc"])
  assert.equal(await go("?code=abc&next=https://evil.com"), "https://misrmotors.app/")
  assert.equal(await go("?next=//evil.com"), "https://misrmotors.app/")
  assert.equal(await go("?next=/\\evil.com"), "https://misrmotors.app/")
})

// ---- Task 5: Admin account API (/api/users) ----
import * as usersRoute from "../../app/api/users/route"

function adminAuth(opts: { failCreate?: string } = {}) {
  const calls: Calls = { create: [], update: [], del: [] }
  let n = 0
  const admin = {
    createUser: async (args: any) => {
      calls.create.push(args)
      if (opts.failCreate) return { data: { user: null }, error: { message: opts.failCreate } }
      return { data: { user: { id: `auth-new-${++n}` } }, error: null }
    },
    updateUserById: async (id: string, attrs: any) => {
      calls.update.push({ id, attrs })
      return { data: { user: { id } }, error: null }
    },
    deleteUser: async (id: string) => {
      calls.del.push(id)
      return { data: {}, error: null }
    },
  }
  return { admin, calls }
}
function setupUsers(rows: Record<string, unknown>[], opts?: { failCreate?: string }) {
  const db: any = new FakeDb({ users: rows })
  const { admin, calls } = adminAuth(opts)
  db.auth = { admin }
  useDb(db)
  return { db, calls }
}
const send = async (method: string, body: unknown, actor?: number) => {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (actor) headers["x-mm-user-id"] = String(actor)
  const handler = (usersRoute as any)[method]
  const res: Response = await handler(new Request("http://t/api/users", { method, headers, body: method === "GET" ? undefined : JSON.stringify(body) }))
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}
const newEmailUser = { fullName: "Mona", loginMethod: "email", email: "mona@example.com", roles: ["accountant", "sales-rep"], tempPassword: "temp-1234" }

test("users POST: makes the login, the row and the login's role data with the same roles", async () => {
  const { db, calls } = setupUsers([])
  const r = await send("POST", newEmailUser, 1)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(calls.create.length, 1)
  assert.equal(calls.create[0].email, "mona@example.com")
  assert.equal(calls.create[0].password, "temp-1234")
  assert.equal(calls.create[0].email_confirm, true)
  const saved = db.snapshot().users[0]
  assert.equal(saved.auth_user_id, "auth-new-1")
  assert.deepEqual(saved.roles, ["accountant", "sales-rep"])
  assert.equal(saved.role, null)
  assert.equal(saved.must_change_password, true)
  assert.equal(saved.is_active, true)
  assert.equal(calls.update.length, 1)
  assert.deepEqual(calls.update[0].attrs.app_metadata, { app_user_id: saved.user_id, roles: ["accountant", "sales-rep"], name: "Mona", active: true })
  assert.equal(r.body.user.userId, saved.user_id)
})

test("users POST: a username account logs in with the hidden address, which is never listed", async () => {
  const { calls } = setupUsers([])
  const r = await send("POST", { ...newEmailUser, loginMethod: "username", username: "ahmed", email: undefined }, 1)
  assert.equal(r.status, 200)
  assert.equal(calls.create[0].email, "ahmed@staff.misrmotors.app")
  const list = await send("GET", undefined, 1)
  assert.equal(list.body[0].username, "ahmed")
  assert.equal(list.body[0].email, null)
  assert.ok(!JSON.stringify(list.body).includes("staff.misrmotors.app"))
})

test("users POST: bad input → 400; duplicate → 409 with no login made", async () => {
  const { calls } = setupUsers([{ user_id: 1, full_name: "A", email: "mona@example.com", roles: ["admin"], is_active: true }])
  assert.equal((await send("POST", { ...newEmailUser, roles: [] }, 1)).status, 400)
  const dup = await send("POST", newEmailUser, 1)
  assert.equal(dup.status, 409)
  assert.equal(calls.create.length, 0)
})

test("users POST: if saving the row fails, the new login is deleted (no half accounts)", async () => {
  const { db, calls } = setupUsers([])
  db.failOn["users:insert"] = "boom"
  const r = await send("POST", newEmailUser, 1)
  assert.equal(r.status, 500)
  assert.deepEqual(calls.del, ["auth-new-1"])
})

test("users POST: login service refuses (already registered) → 409", async () => {
  setupUsers([], { failCreate: "A user with this email address has already been registered" })
  assert.equal((await send("POST", newEmailUser, 1)).status, 409)
})

const existing = () => [
  { user_id: 1, full_name: "Owner", email: "owner@example.com", login_method: "email", roles: ["admin"], is_active: true, auth_user_id: "auth-1" },
  { user_id: 2, full_name: "Mona", email: "mona@example.com", login_method: "email", roles: ["accountant"], is_active: true, auth_user_id: "auth-2" },
]

test("users PUT update: name, roles and HR link saved and the login's role data kept in step", async () => {
  const { db, calls } = setupUsers(existing())
  const r = await send("PUT", { userId: 2, action: "update", fullName: "Mona S", roles: ["accountant", "shipment"], employeeId: 9 }, 1)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const row2 = db.snapshot().users.find((u: any) => u.user_id === 2)
  assert.equal(row2.full_name, "Mona S")
  assert.deepEqual(row2.roles, ["accountant", "shipment"])
  assert.equal(row2.employee_id, 9)
  assert.deepEqual(calls.update[0], { id: "auth-2", attrs: { app_metadata: { app_user_id: 2, roles: ["accountant", "shipment"], name: "Mona S", active: true } } })
  assert.equal((await send("PUT", { userId: 2, action: "update", roles: ["boss"] }, 1)).status, 400)
})

test("users PUT reset-password: new temporary password and must change it", async () => {
  const { db, calls } = setupUsers(existing())
  assert.equal((await send("PUT", { userId: 2, action: "reset-password", tempPassword: "short" }, 1)).status, 400)
  const r = await send("PUT", { userId: 2, action: "reset-password", tempPassword: "new-temp-99" }, 1)
  assert.equal(r.status, 200)
  assert.deepEqual(calls.update.at(-1), { id: "auth-2", attrs: { password: "new-temp-99" } })
  assert.equal(db.snapshot().users.find((u: any) => u.user_id === 2).must_change_password, true)
})

test("users PUT deactivate/reactivate: blocks the login and flags it off, then reverses", async () => {
  const { db, calls } = setupUsers(existing())
  let r = await send("PUT", { userId: 2, action: "deactivate" }, 1)
  assert.equal(r.status, 200)
  assert.equal(db.snapshot().users.find((u: any) => u.user_id === 2).is_active, false)
  assert.equal(calls.update.at(-1).attrs.ban_duration, "876000h")
  assert.equal(calls.update.at(-1).attrs.app_metadata.active, false)
  r = await send("PUT", { userId: 2, action: "reactivate" }, 1)
  assert.equal(r.status, 200)
  assert.equal(db.snapshot().users.find((u: any) => u.user_id === 2).is_active, true)
  assert.equal(calls.update.at(-1).attrs.ban_duration, "none")
  assert.equal(calls.update.at(-1).attrs.app_metadata.active, true)
})

test("users PUT: an admin cannot turn themselves off or drop their own admin role; unknown user → 404", async () => {
  const { calls } = setupUsers(existing())
  assert.equal((await send("PUT", { userId: 1, action: "deactivate" }, 1)).status, 400)
  assert.equal((await send("PUT", { userId: 1, action: "update", roles: ["ceo"] }, 1)).status, 400)
  assert.equal(calls.update.length, 0)
  assert.equal((await send("PUT", { userId: 99, action: "deactivate" }, 1)).status, 404)
  assert.equal((await send("PUT", { userId: 2, action: "explode" }, 1)).status, 400)
})

test("users: DELETE is gone (turn off instead, to keep who-did-what history)", () => {
  assert.equal((usersRoute as any).DELETE, undefined)
})
