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
